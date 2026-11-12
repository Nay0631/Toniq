import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { NOTE_INDEX, SCALE_TONES, resolveChord, scaleSemitones } from "../data/degree_resolver";
import { MelodyNote, noteToMidi, midiToNote, timeToUnits, durationToUnits } from "./MelodyGenerator";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { GrowInstrument, growValues, isGrowReady } from "./Grow";

// カウンターメロディ：メロディに寄り添うもう1本の旋律。メロディとコード進行から毎回同じ形に決まる（AppState には持たない。
// メロディを編集すれば自動で追従する）。
//   - サビ（セクション B）：ハモり。メロディの各音の3度下（なければ6度下・4度下）のスケール音。強拍はコード構成音
//   - Aメロ（セクション A）：合いの手（オブリガート）。メロディの音が半小節以上続く・休む所に、メロディより上の音域で
//     8分音符の短いフレーズ（2〜4音。ペンタトニックを順に進み、コード構成音で終わる）を入れる。1小節に1つまでで、続く小節には入れない。
//     メロディが細かく詰まっている（8bit・テクノなど）と入る所がないので、Aメロではほとんど鳴らない
// 試聴・サンプル中（コードにセクションが付いていない）は Aメロとして扱う

// ===== 生成 =====

export interface CounterNote {
  sixteenth: number;  // 曲（ループ）の頭からの位置（16分音符）
  length:    number;  // 16分音符の数
  midi:      number;
  velocity:  number;
}

// ハモりに使うメロディからの音程（半音。下へ）。3度 → 6度 → 4度の順に好む。2度・増4度・5度・7度は使わない
const HARMONY_INTERVALS: Record<number, number> = { 3: 0, 4: 0, 8: 1, 9: 1, 5: 2 };
const HARMONY_FLOOR = 55;  // G3。これより下になる音は休む（コード・パッドの音域に潜らない）

// 合いの手の音域（MIDI。メロディの Aメロの音域（C4〜A4 あたり）より上）
const FILL_LOW  = 67;  // G4
const FILL_HIGH = 84;  // C6
const FILL_MIN_GAP = 8;  // メロディの次の発音までがこれ以上（16分音符。半小節）空く所に入れる

interface Placed { start: number; length: number; midi: number }

function placedMelody(melody: MelodyNote[]): Placed[] {
  return melody
    .filter((n): n is MelodyNote & { note: string } => n.note !== null)
    .map(n => ({ start: timeToUnits(n.time), length: durationToUnits(n.duration), midi: noteToMidi(n.note) }))
    .sort((a, b) => a.start - b.start);
}

// 16分音符の位置ごとのコード（構成音のピッチクラスとセクション）
interface ChordAt { tones: number[]; section: "A" | "B" }

function chordTimeline(progression: ChordProgression, key: string): (unit: number) => ChordAt {
  const spans = progression.progression.map(c => ({
    start:   (c.bar - 1) * 16,
    end:     (c.bar - 1 + c.duration_bars) * 16,
    tones:   resolveChord(c.degree, c.type, 0, key, progression.base_scale, 4).notes.map(n => noteToMidi(n) % 12),
    section: c.section ?? "A",
  }));
  return unit => {
    const found = spans.find(s => unit >= s.start && unit < s.end) ?? spans[spans.length - 1];
    return { tones: found.tones, section: found.section };
  };
}

// ハモりの1音：メロディの音 melody の下で、スケールの中のもの。強拍はコード構成音を強く好み、前の音から近いものを選ぶ
function harmonyNote(melody: number, chordTones: number[], scale: Set<number>, strong: boolean, prev: number | null): number | null {
  let best: number | null = null;
  let bestCost = Infinity;
  for (const [interval, rank] of Object.entries(HARMONY_INTERVALS)) {
    const midi = melody - Number(interval);
    if (midi < HARMONY_FLOOR || !scale.has(midi % 12)) continue;
    const chordTone = chordTones.includes(midi % 12);
    const cost = rank * 2 + (chordTone ? 0 : strong ? 8 : 1.5) + (prev === null ? 0 : Math.abs(midi - prev) * 0.15);
    if (cost < bestCost) { best = midi; bestCost = cost; }
  }
  return best;
}

// 合いの手の1フレーズ（2〜4音の8分音符。window = [start, end) の16分音符）。
// held は鳴っているメロディの音（短2度・長7度でぶつからないようにする）、up は上がるか下がるか
function fillFigure(
  start: number, end: number, chordAt: (unit: number) => ChordAt, penta: number[], held: number, up: boolean,
): CounterNote[] {
  const first = Math.ceil(start / 2) * 2;  // 8分音符の位置にそろえる
  const count = Math.min(4, Math.floor((end - first) / 2));
  if (count < 2) return [];

  const clashes = (midi: number) => [1, 11].includes(((midi - held) % 12 + 12) % 12);
  // 最初の音：コード構成音で、メロディより上（短3度以上）・音域の中ほどに近いもの
  const startChord = chordAt(first).tones;
  const center     = up ? 71 : 77;
  const candidates = penta
    .map((midi, i) => ({ midi, i }))
    .filter(c => startChord.includes(c.midi % 12) && c.midi >= held + 3 && !clashes(c.midi));
  if (candidates.length === 0) return [];
  let index = candidates.reduce((a, b) => Math.abs(b.midi - center) < Math.abs(a.midi - center) ? b : a).i;

  const notes: CounterNote[] = [];
  const inRange = (i: number) => i >= 0 && i < penta.length;
  let dir = up ? 1 : -1;
  for (let k = 0; k < count; k++) {
    const pos  = first + k * 2;
    const last = k === count - 1;
    if (k > 0) {
      const prev = index;
      // 音域の端に着いたら向きを変える（同じ音を続けない）
      if (!inRange(index + dir)) dir = -dir;
      index += dir;
      if (last) {
        // 最後の音はその時のコードの構成音へ（そのまま・同じ向きにもう1つ・戻る の順に探す。直前の音と同じ高さは避ける）
        const tones = chordAt(pos).tones;
        const options = [index, index + dir, index - dir]
          .filter(i => inRange(i) && i !== prev && tones.includes(penta[i] % 12) && !clashes(penta[i]));
        if (options.length > 0) index = options[0];
      } else if (clashes(penta[index]) && inRange(index + dir)) {
        index += dir;
      }
    }
    // 最後の音は次のメロディの発音まで（最大1拍）伸ばす
    const length = last ? Math.max(2, Math.min(4, end - pos)) : 2;
    notes.push({ sixteenth: pos, length, midi: penta[index], velocity: k === 0 ? 0.75 : 0.68 });
  }
  return notes;
}

// カウンターメロディの音の並び（再生と MIDI 書き出しで共通）。
// progression・melody はどちらも同じ長さの並び（曲全体なら songProgression / songMelody、試聴ならコード進行1周）
export function counterNotes(progression: ChordProgression, melody: MelodyNote[], key: string): CounterNote[] {
  const notes = placedMelody(melody);
  if (notes.length === 0 || progression.progression.length === 0) return [];

  const root   = NOTE_INDEX[key] ?? 0;
  const scale  = new Set(scaleSemitones(progression.base_scale).map(t => (root + t) % 12));
  const core   = (SCALE_TONES[progression.base_scale] ?? SCALE_TONES.minor).core.map(t => (root + t) % 12);
  const penta  = Array.from({ length: FILL_HIGH - FILL_LOW + 1 }, (_, i) => FILL_LOW + i).filter(m => core.includes(m % 12));
  const chordAt = chordTimeline(progression, key);
  const total   = progression.length_bars * 16;

  const out: CounterNote[] = [];
  let prevHarmony: number | null = null;
  const filledBars = new Set<number>();

  notes.forEach((n, i) => {
    const chord = chordAt(n.start);
    if (chord.section === "B") {
      const midi = harmonyNote(n.midi, chord.tones, scale, n.start % 8 === 0, prevHarmony);
      prevHarmony = midi;
      if (midi !== null) out.push({ sixteenth: n.start, length: n.length, midi, velocity: n.start % 4 === 0 ? 0.82 : 0.74 });
      return;
    }
    prevHarmony = null;

    // 合いの手：次の発音（最後の音はループの頭の音）までが半小節以上空く所。発音から1拍あとに入れる
    const next = notes[i + 1]?.start ?? notes[0].start + total;
    const end  = Math.min(next, total);
    const bar  = Math.floor(n.start / 16);
    // 1小節に1つまで。続けて入れるとうるさいので、前の小節に入れたら休む（呼びかけと応答の間を空ける）
    if (end - n.start < FILL_MIN_GAP || filledBars.has(bar) || filledBars.has(bar - 1)) return;
    // 合いの手を入れる所もセクション A（次がサビの頭なら、サビに食い込まない）
    const from = n.start + 4;
    if (chordAt(Math.min(end - 1, total - 1)).section === "B") return;
    const figure = fillFigure(from, end, chordAt, penta, n.midi, bar % 2 === 0);
    if (figure.length === 0) return;
    filledBars.add(bar);
    out.push(...figure);
  });
  return out;
}

// ===== 再生 =====

let counterPart:  Tone.Part | null = null;
let counterSynth: Tone.MonoSynth | GrowInstrument | null = null;
let counterVol:   Tone.Volume | null = null;

// grow（AppState.growSounds.counter。標準はジャンルに合わせたプリセット。Grow.ts の COUNTER_STANDARD）で鳴らす。
// grow の準備ができていない（wasm がない）ときは Tone.js の三角波の MonoSynth
export function initCounterSynth() {
  disposeSynth();
  counterVol = createVolumeNode("counter");  // 現在のオーディオコンテキスト用のノード
  if (isGrowReady()) {
    counterSynth = new GrowInstrument(growValues("counter")).connect(counterVol);
    return;
  }
  counterSynth = new Tone.MonoSynth({
    oscillator:     { type: "triangle" },
    filter:         { type: "lowpass", Q: 0.5, rolloff: -12 },
    envelope:       { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4, baseFrequency: 1200, octaves: 2 },
    volume:         -12,
  }).connect(counterVol);
}

export function loadCounter(progression: ChordProgression, melody: MelodyNote[], key: string = "A") {
  if (counterPart) { counterPart.dispose(); counterPart = null; }
  if (!counterSynth) initCounterSynth();

  const events = counterNotes(progression, melody, key).map(n => ({
    time: `0:0:${n.sixteenth}`,
    note: midiToNote(n.midi),
    dur:  `0:0:${n.length}`,
    vel:  n.velocity,
  }));

  const arranged = arrangementGate("counter");
  counterPart = new Tone.Part((time, event: { note: string; dur: string; vel: number }) => {
    if (!arranged(time)) return;
    counterSynth?.triggerAttackRelease(event.note, event.dur, time, event.vel);
  }, events);

  counterPart.loop    = true;
  counterPart.loopEnd = `${progression.length_bars}m`;
  counterPart.start(0);
}

function disposeSynth() {
  counterSynth?.dispose();
  counterSynth = null;
}

export function disposeCounter() {
  counterPart?.dispose();
  counterPart = null;
  disposeSynth();
}
