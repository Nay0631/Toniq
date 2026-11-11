import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { voiceProgression, VOICING_RANGES } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState, ChordRhythm } from "./AppState";
import { GrowInstrument, growValues, isGrowReady } from "./Grow";

// リズムごとの刻みの長さ（16分音符の数）。whole はコードの長さいっぱいに伸ばす
const RHYTHM_STEPS: Record<ChordRhythm, number | null> = {
  whole:   null,
  half:    8,
  quarter: 4,
  eighth:  2,
};

// ===== grow の準備ができていない（wasm がない）ときの音色 =====
// コードの音色はすべて grow のプリセット（AppState.growChordPreset）。Tone.js ではソフトパッドだけを持つ。
// 少しずらした三角波2本で、やわらかく厚みを出す（音量は波形の聞こえ方の差をならす）
const FALLBACK = {
  synth:  () => new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fattriangle", count: 2, spread: 14 },
    envelope:   { attack: 0.15, decay: 0.6, sustain: 0.7, release: 1.5 },
    volume:     -9,
  }),
  cutoff: 4500,  // ローパスの周波数（Hz）
  chorus: 0.3,   // コーラス（左右の広がり）の量
};

// ストラム：和音の音を下から少しずつずらして鳴らす間隔（秒）。長い音ほどゆったり
const STRUM_SEC = { long: 0.012, short: 0.005 };

let chordPart:    Tone.Part | null = null;
let padSynth:     Tone.PolySynth<any> | GrowInstrument | null = null;
let chordVol:     Tone.Volume | null = null;
let chordEffects: Tone.ToneAudioNode[] = [];

// 音色は grow（AppState.growChordPreset。null ならジャンルの標準）。変更は次に Synth を作り直したとき（再生開始時）に反映される。
// grow は自前のエフェクトを持つのでそのまま Volume へ。リバーブはミキサーの送りでかける。
// 今のオーディオコンテキストで grow の準備ができていなければ、ソフトパッド → ローパス → コーラス（左右の広がり）→ Volume
export function initChordSynth() {
  disposeSynth();
  chordVol = createVolumeNode("chord");  // 現在のオーディオコンテキスト用のノード
  if (isGrowReady()) {
    padSynth = new GrowInstrument(growValues("chord"), getState().bpm).connect(chordVol);
    return;
  }
  const filter = new Tone.Filter({ type: "lowpass", frequency: FALLBACK.cutoff, rolloff: -12 });
  const chorus = new Tone.Chorus({ frequency: 1.2, delayTime: 3.5, depth: 0.3, spread: 180, wet: FALLBACK.chorus }).start();
  chordEffects = [filter, chorus];
  const synth = FALLBACK.synth();
  synth.chain(...chordEffects, chordVol);
  padSynth = synth;
}

// コードの1回の発音（位置と長さは16分音符の数。ループの頭から）
export interface ChordHit {
  sixteenth: number;
  length:    number;
  notes:     string[];
  velocity:  number;  // 基準の強さ（鳴らすときに少し揺らす）
  strum:     number;  // 音をずらす間隔（秒）
}

// コード進行1周分の発音（コードのリズム AppState.chordRhythm とボイシング。MIDI書き出しも同じものを使う）
export function chordEvents(progression: ChordProgression, key: string): ChordHit[] {
  const hits: ChordHit[] = [];
  const step = RHYTHM_STEPS[getState().chordRhythm];
  const voiced = voiceProgression(progression, key, VOICING_RANGES.chord);

  progression.progression.forEach((chord, i) => {
    const notes = voiced[i];
    const start = (chord.bar - 1) * 16;
    // 全音符、またはエンディングの主和音はコードの長さいっぱいに1回だけ鳴らす
    if (step === null || chord.ending) {
      hits.push({ sixteenth: start, length: chord.duration_bars * 16, notes, velocity: 0.75, strum: STRUM_SEC.long });
      return;
    }
    for (let six = 0; six < chord.duration_bars * 16; six += step) {
      hits.push({
        sixteenth: start + six,
        length:    step,
        notes,
        velocity:  six === 0 ? 0.8 : six % 4 === 0 ? 0.68 : 0.56,
        strum:     step >= 8 ? STRUM_SEC.long : STRUM_SEC.short,
      });
    }
  });
  return hits;
}

interface ChordEvent {
  time:     string;
  notes:    string[];
  dur:      string;
  velocity: number;  // 基準の強さ（鳴らすときに少し揺らす）
  strum:    number;  // 音をずらす間隔（秒）
}

// ボイシングは前のコードから一番近い転回形で決める（voiceProgression）
export function loadChordProgression(progression: ChordProgression, key: string = "A") {
  if (chordPart) { chordPart.dispose(); chordPart = null; }
  if (!padSynth) initChordSynth();

  // 全音符は小節表記の長さ（`2m` など）、刻むときは音価（`8n` など）で鳴らす
  const step   = RHYTHM_STEPS[getState().chordRhythm];
  const events: ChordEvent[] = chordEvents(progression, key).map(h => ({
    time:     `0:0:${h.sixteenth}`,
    notes:    h.notes,
    dur:      step === null || h.length !== step ? `${h.length / 16}m` : `${16 / step}n`,
    velocity: h.velocity,
    strum:    h.strum,
  }));

  const arranged = arrangementGate("chord");
  chordPart = new Tone.Part((time, event: ChordEvent) => {
    if (!arranged(time)) return;
    const velocity = humanize(event.velocity);
    event.notes.forEach((note, i) => {
      padSynth?.triggerAttackRelease(note, event.dur, time + i * event.strum, velocity);
    });
  }, events);

  chordPart.loop    = true;
  chordPart.loopEnd = `${progression.length_bars}m`;
  chordPart.start(0);
}

// 強さを ±0.05 の範囲で揺らす
function humanize(velocity: number): number {
  return Math.min(1, Math.max(0.1, velocity + (Math.random() - 0.5) * 0.1));
}

function disposeSynth() {
  padSynth?.dispose();
  chordEffects.forEach((n) => n.dispose());
  padSynth     = null;
  chordEffects = [];
}

export function disposeChord() {
  chordPart?.dispose();
  chordPart = null;
  disposeSynth();
}