import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { voiceProgression, VOICING_RANGES } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState, ChordRhythm, ChordInstrument } from "./AppState";

// リズムごとの刻みの長さ（16分音符の数）。whole はコードの長さいっぱいに伸ばす
const RHYTHM_STEPS: Record<ChordRhythm, number | null> = {
  whole:   null,
  half:    8,
  quarter: 4,
  eighth:  2,
};

// ===== 音色の定義 =====
// synth:   PolySynth（音量は波形の聞こえ方の差をならす）
// effects: 音色専用のエフェクト（Synth のすぐ後ろに順につなぐ。LFO は作るときに開始する）
// cutoff:  共通のローパスの周波数（Hz）。ノコギリ波・矩形波の耳に痛い高域を丸める
// chorus:  共通のコーラス（左右の広がり）の量。0 ならコーラスを通さない
interface ChordVoice {
  synth:   Tone.PolySynth<any>;
  effects: Tone.ToneAudioNode[];
  cutoff:  number;
  chorus:  number;
}

const INSTRUMENTS: Record<ChordInstrument, () => ChordVoice> = {
  // ソフトパッド：少しずらした三角波2本で、やわらかく厚みを出す
  soft: () => ({
    synth: new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fattriangle", count: 2, spread: 14 },
      envelope:   { attack: 0.15, decay: 0.6, sustain: 0.7, release: 1.5 },
      volume:     -9,
    }),
    effects: [],
    cutoff:  4500,
    chorus:  0.3,
  }),
  // エレピ：1:1 の FM で弾いた瞬間だけ倍音が強く、すぐ丸くなる。左右に揺れるトレモロ
  epiano: () => ({
    synth: new Tone.PolySynth(Tone.FMSynth, {
      harmonicity:        1,
      modulationIndex:    6,
      oscillator:         { type: "sine" },
      envelope:           { attack: 0.002, decay: 2.0, sustain: 0.25, release: 0.8 },
      modulation:         { type: "sine" },
      modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.15, release: 0.5 },
      volume:             -13,
    }),
    effects: [new Tone.Tremolo({ frequency: 4, depth: 0.35, spread: 180 }).start()],
    cutoff:  5000,
    chorus:  0.15,
  }),
  // ストリングス：ずらしたノコギリ波3本をフィルターでゆっくり開き、ゆっくり立ち上げる
  strings: () => ({
    synth: new Tone.PolySynth(Tone.MonoSynth, {
      oscillator:     { type: "fatsawtooth", count: 3, spread: 25 },
      filter:         { type: "lowpass", Q: 0.7, rolloff: -24 },
      envelope:       { attack: 0.5, decay: 0.3, sustain: 0.85, release: 2.0 },
      filterEnvelope: { attack: 0.8, decay: 1.0, sustain: 0.7, release: 1.5, baseFrequency: 400, octaves: 2.5 },
      volume:         -13,
    }),
    effects: [],
    cutoff:  7000,
    chorus:  0.4,
  }),
  // オルガン：ドローバー風の整数倍音。ビブラート＋トレモロで回転スピーカーの揺れを出す
  organ: () => ({
    synth: new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "custom", partials: [1, 0.8, 0.6, 0, 0.4, 0, 0, 0.3] },
      envelope:   { attack: 0.005, decay: 0.05, sustain: 1, release: 0.08 },
      volume:     -17,
    }),
    effects: [
      new Tone.Vibrato({ frequency: 6, depth: 0.06 }),
      new Tone.Tremolo({ frequency: 6, depth: 0.25, spread: 120 }).start(),
    ],
    cutoff:  5000,
    chorus:  0.1,
  }),
  // 8bit：デューティ比 25% のパルス波（ファミコン風）。広げずに乾いた音のまま
  square: () => ({
    synth: new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "pulse", width: 0.25 },
      envelope:   { attack: 0.003, decay: 0.15, sustain: 0.4, release: 0.08 },
      volume:     -21,
    }),
    effects: [],
    cutoff:  6000,
    chorus:  0,
  }),
  // SuperSaw：ずらしたノコギリ波5本。弾いた瞬間にフィルターが開いて少し閉じる（EDM・トランス向け）
  supersaw: () => ({
    synth: new Tone.PolySynth(Tone.MonoSynth, {
      oscillator:     { type: "fatsawtooth", count: 5, spread: 40 },
      filter:         { type: "lowpass", Q: 1, rolloff: -24 },
      envelope:       { attack: 0.01, decay: 0.4, sustain: 0.75, release: 0.8 },
      filterEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.5, release: 0.8, baseFrequency: 800, octaves: 2.5 },
      volume:         -20,
    }),
    effects: [],
    cutoff:  8000,
    chorus:  0.4,
  }),
};

// ストラム：和音の音を下から少しずつずらして鳴らす間隔（秒）。長い音ほどゆったり
const STRUM_SEC = { long: 0.012, short: 0.005 };

let chordPart:    Tone.Part | null = null;
let padSynth:     Tone.PolySynth<any> | null = null;
let chordVol:     Tone.Volume | null = null;
let chordEffects: Tone.ToneAudioNode[] = [];

// 音色は AppState.chordInstrument から決める。変更は次に Synth を作り直したとき（再生開始時）に反映される
// 音の流れ：Synth → 音色専用のエフェクト → ローパス → コーラス（左右の広がり）→ Volume
// リバーブはミキサーの送りでかける
export function initChordSynth() {
  disposeSynth();
  chordVol = createVolumeNode("chord");  // 現在のオーディオコンテキスト用のノード
  const voice  = (INSTRUMENTS[getState().chordInstrument] ?? INSTRUMENTS.soft)();
  const filter = new Tone.Filter({ type: "lowpass", frequency: voice.cutoff, rolloff: -12 });
  const chorus = voice.chorus > 0
    ? new Tone.Chorus({ frequency: 1.2, delayTime: 3.5, depth: 0.3, spread: 180, wet: voice.chorus }).start()
    : null;
  chordEffects = [...voice.effects, filter, ...(chorus ? [chorus] : [])];
  padSynth = voice.synth;
  padSynth.chain(...chordEffects, chordVol);
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

  const events: ChordEvent[] = [];
  const step = RHYTHM_STEPS[getState().chordRhythm];
  const voiced = voiceProgression(progression, key, VOICING_RANGES.chord);

  progression.progression.forEach((chord, i) => {
    const notes = voiced[i];
    if (step === null) {
      events.push({
        time:     `${chord.bar - 1}:0:0`,
        notes,
        dur:      `${chord.duration_bars}m`,
        velocity: 0.75,
        strum:    STRUM_SEC.long,
      });
      return;
    }
    // コードの長さの中で一定の間隔で刻む。コードの頭を強く、拍の頭を中くらい、裏を弱く
    const start = (chord.bar - 1) * 16;
    for (let six = 0; six < chord.duration_bars * 16; six += step) {
      events.push({
        time:     `0:0:${start + six}`,
        notes,
        dur:      `${16 / step}n`,
        velocity: six === 0 ? 0.8 : six % 4 === 0 ? 0.68 : 0.56,
        strum:    step >= 8 ? STRUM_SEC.long : STRUM_SEC.short,
      });
    }
  });

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