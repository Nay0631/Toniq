import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { voiceProgression, VOICING_RANGES, VoicingMelodyNote } from "../data/degree_resolver";
import { MelodyNote, noteToMidi, timeToUnits, durationToUnits } from "./MelodyGenerator";
import { songMelody } from "./SongForm";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { createTrack, type Track } from "./Track";
import { getState, ChordRhythm } from "./AppState";
import { GrowInstrument, growValues, isGrowReady } from "./Grow";
import { barUnits, beatsPerBar, unitTime, unitsPerBar, unitsPerBeat } from "./Meter";

// リズムごとの、1小節の中で鳴らすマス（Meter.ts。4/4 なら half = [0, 8]、quarter = 拍の頭、eighth = 8分ごと）。
// whole（null）はコードの長さいっぱいに伸ばす。3/4 の half は小節の頭に1回、3連符の拍子の eighth はシャッフル（3連符の1つ目と3つ目）
function rhythmUnits(rhythm: ChordRhythm): number[] | null {
  if (rhythm === "whole") return null;
  if (rhythm === "half") return beatsPerBar() === 4 ? [0, unitsPerBar() / 2] : [0];
  return barUnits(rhythm === "quarter" ? "4n" : "8n");
}

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

let chordTrack:   Track | null = null;
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

// コードの1回の発音（位置と長さはマスの数。ループの頭から。4/4・3/4 は16分音符、3連符は8分3連符。Meter.ts）
export interface ChordHit {
  sixteenth: number;
  length:    number;
  notes:     string[];
  velocity:  number;  // 基準の強さ（鳴らすときに少し揺らす）
  strum:     number;  // 音をずらす間隔（秒）
}

// ボイシングで避けるメロディ（曲全体の並び。メロディが OFF・未作成なら空で、コードどうしの動きだけで決める）
function melodyToAvoid(): VoicingMelodyNote[] {
  if (!getState().parts.melody) return [];
  return songMelody()
    .filter((n): n is MelodyNote & { note: string } => n.note !== null)
    .map(n => {
      const start = timeToUnits(n.time);
      return { midi: noteToMidi(n.note), start, end: start + durationToUnits(n.duration) };
    });
}

// コード進行1周分の発音（コードのリズム AppState.chordRhythm とボイシング。MIDI書き出しも同じものを使う）。
// ボイシングは、最高音がメロディより上に出ない・メロディと半音でぶつからない転回形を選ぶ
export function chordEvents(progression: ChordProgression, key: string): ChordHit[] {
  const hits: ChordHit[] = [];
  const inBar = rhythmUnits(getState().chordRhythm);
  const BAR = unitsPerBar(), BEAT = unitsPerBeat();
  const voiced = voiceProgression(progression, key, VOICING_RANGES.chord, { melody: melodyToAvoid(), unitsPerBar: BAR });

  progression.progression.forEach((chord, i) => {
    const notes = voiced[i];
    const start = (chord.bar - 1) * BAR;
    // 全音符、またはエンディングの主和音はコードの長さいっぱいに1回だけ鳴らす
    if (inBar === null || chord.ending) {
      hits.push({ sixteenth: start, length: chord.duration_bars * BAR, notes, velocity: 0.75, strum: STRUM_SEC.long });
      return;
    }
    for (let b = 0; b < chord.duration_bars; b++) {
      inBar.forEach((unit, k) => {
        const length = (inBar[k + 1] ?? BAR) - unit;  // 次に鳴らす所（なければ小節の終わり）まで
        hits.push({
          sixteenth: start + b * BAR + unit,
          length,
          notes,
          velocity:  b === 0 && unit === 0 ? 0.8 : unit % BEAT === 0 ? 0.68 : 0.56,
          strum:     length >= BEAT * 2 ? STRUM_SEC.long : STRUM_SEC.short,
        });
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

// ボイシングは進行全体で動きが最小になり、メロディとぶつからない転回形で決める（voiceProgression）。
// 今の予定と同じ音の並びなら作り直さない（再生中にメロディを1音編集しても、ボイシングが変わらないことが多い）
export function loadChordProgression(progression: ChordProgression, key: string = "A") {
  if (!padSynth) initChordSynth();

  // 小節ちょうどの長さは小節表記（`2m` など）、刻むときはマスの数の長さで鳴らす
  const BAR = unitsPerBar();
  const events: ChordEvent[] = chordEvents(progression, key).map(h => ({
    time:     unitTime(h.sixteenth),
    notes:    h.notes,
    dur:      h.length % BAR === 0 ? `${h.length / BAR}m` : unitTime(h.length),
    velocity: h.velocity,
    strum:    h.strum,
  }));

  if (chordTrack?.isSame(events, progression.length_bars)) return;
  chordTrack?.dispose();
  const arranged = arrangementGate("chord");
  chordTrack = createTrack(events, progression.length_bars, (time, event) => {
    if (!arranged(time)) return;
    const velocity = humanize(event.velocity);
    event.notes.forEach((note, i) => {
      padSynth?.triggerAttackRelease(note, event.dur, time + i * event.strum, velocity);
    });
  });
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
  chordTrack?.dispose();
  chordTrack = null;
  disposeSynth();
}