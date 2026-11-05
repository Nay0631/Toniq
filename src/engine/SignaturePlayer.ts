import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState } from "./AppState";

// シグネチャー：ジャンルの特徴を出す追加パート（パッド・アルペジオと同じく任意で ON/OFF）
// 鳴り方はジャンルごとに SIGNATURES で定義する。音色・鳴り方は Synth を作り直したとき（再生開始時）に反映される

interface SignatureEvent {
  time:   string;    // 小節:拍:16分
  notes?: string[];  // 鳴らす音（ノイズ系は持たない）
  dur?:   Tone.Unit.Time;
  accent?: boolean;
}

interface SignatureVoice {
  trigger: (event: SignatureEvent, time: number) => void;
  nodes:   Tone.ToneAudioNode[];  // 破棄するノード（Synth・エフェクト）
}

interface SignatureDef {
  label:  string;  // アレンジャーなどの表示名
  create: (out: Tone.ToneAudioNode) => SignatureVoice;
  // コードごとに呼ばれる。notes はオクターブ4のコード構成音、bar はコードの先頭小節（0始まり）
  events: (notes: string[], bar: number, bars: number) => SignatureEvent[];
}

const t = (bar: number, step: number) => `${bar}:${Math.floor(step / 4)}:${step % 4}`;

// 音名のオクターブをずらす（"C#4" → "C#5"）
function shiftOctave(note: string, by: number): string {
  const m = note.match(/^([A-G]#?b?)(-?\d+)$/);
  return m ? `${m[1]}${parseInt(m[2]) + by}` : note;
}

// ===== ジャンル別の定義 =====

// EDM：オフビート（裏拍）のコードスタブ
const edmStab: SignatureDef = {
  label: "オフビートスタブ",
  create: out => {
    const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.25 }).connect(out);
    const filter = new Tone.Filter({ type: "lowpass", frequency: 3500, Q: 1 }).connect(reverb);
    const synth  = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 25 } as any,
      envelope:   { attack: 0.003, decay: 0.12, sustain: 0.1, release: 0.08 },
      volume:     -20,
    }).connect(filter);
    return {
      trigger: (e, time) => synth.triggerAttackRelease(e.notes!, e.dur!, time),
      nodes:   [synth, filter, reverb],
    };
  },
  events: (notes, bar, bars) => {
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      for (const step of [2, 6, 10, 14]) ev.push({ time: t(bar + b, step), notes, dur: "16n" });
    }
    return ev;
  },
};

// テクノ：アシッドベース風のうねるシンセ（R = ルート、O = 1オクターブ上、F = 5度、大文字はアクセント）
const ACID_PATTERNS = ["RrOr.rFrRr.oRrOf", "Rr.oRrOr.rFrR.Or"];
const technoAcid: SignatureDef = {
  label: "アシッド",
  create: out => {
    const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 0.2 }).connect(out);
    const dist  = new Tone.Distortion({ distortion: 0.3, wet: 0.4 }).connect(delay);
    const synth = new Tone.MonoSynth({
      oscillator:     { type: "sawtooth" },
      envelope:       { attack: 0.002, decay: 0.15, sustain: 0.2, release: 0.05 },
      filter:         { type: "lowpass", Q: 12, rolloff: -24 },
      filterEnvelope: { attack: 0.002, decay: 0.18, sustain: 0.1, release: 0.1, baseFrequency: 180, octaves: 3.5 },
      volume:         -18,
    }).connect(dist);
    return {
      trigger: (e, time) => {
        // アクセントはフィルターを大きく開ける
        synth.filterEnvelope.octaves = e.accent ? 4.5 : 2.8;
        synth.triggerAttackRelease(e.notes![0], e.dur!, time, e.accent ? 1 : 0.6);
      },
      nodes: [synth, dist, delay],
    };
  },
  events: (notes, bar, bars) => {
    const root  = shiftOctave(notes[0], -1);
    const fifth = shiftOctave(notes[Math.min(2, notes.length - 1)], -1);
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      const pattern = ACID_PATTERNS[(bar + b) % ACID_PATTERNS.length];
      [...pattern].forEach((c, step) => {
        if (c === ".") return;
        const note = c.toUpperCase() === "O" ? shiftOctave(root, 1) : c.toUpperCase() === "F" ? fifth : root;
        ev.push({ time: t(bar + b, step), notes: [note], dur: "16n", accent: c === c.toUpperCase() });
      });
    }
    return ev;
  },
};

// 8bit：和音を細かく切り替える高速アルペジオ（チップチューンの和音表現）
const chipArp: SignatureDef = {
  label: "高速アルペジオ",
  create: out => {
    const synth = new Tone.Synth({
      oscillator: { type: "pulse", width: 0.25 } as any,
      envelope:   { attack: 0.001, decay: 0.05, sustain: 0.6, release: 0.01 },
      volume:     -22,
    }).connect(out);
    return {
      trigger: (e, time) => synth.triggerAttackRelease(e.notes![0], e.dur!, time),
      nodes:   [synth],
    };
  },
  events: (notes, bar, bars) => {
    const tones = [...notes, shiftOctave(notes[0], 1)].map(n => shiftOctave(n, 1));
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      // 1拍目と3拍目から1拍ずつ、32分音符で構成音を回す
      for (const beat of [0, 2]) {
        for (let i = 0; i < 8; i++) {
          const sixteenth = Math.floor(i / 2);
          const time = `${bar + b}:${beat}:${sixteenth + (i % 2) * 0.5}`;
          ev.push({ time, notes: [tones[i % tones.length]], dur: "32n" });
        }
      }
    }
    return ev;
  },
};

// ローファイ：レコードのノイズ（サーッというヒスとプチプチ音）
const vinylNoise: SignatureDef = {
  label: "レコードノイズ",
  create: out => {
    const hissFilter = new Tone.Filter({ type: "lowpass", frequency: 5000 }).connect(out);
    const hiss = new Tone.NoiseSynth({
      noise:    { type: "pink" },
      envelope: { attack: 0.05, decay: 0, sustain: 1, release: 0.05 },
      volume:   -40,
    }).connect(hissFilter);
    const crackleFilter = new Tone.Filter({ type: "highpass", frequency: 1800 }).connect(out);
    const crackle = new Tone.NoiseSynth({
      noise:    { type: "white" },
      envelope: { attack: 0.001, decay: 0.008, sustain: 0, release: 0.005 },
      volume:   -18,
    }).connect(crackleFilter);
    return {
      trigger: (e, time) => {
        if (e.dur) {
          hiss.triggerAttackRelease(e.dur, time);
          return;
        }
        // プチプチ音は毎回ランダムに鳴らす（同じ周回でも同じにならない）
        if (Math.random() < 0.35) {
          const jitter = Math.random() * Tone.Time("32n").toSeconds();
          crackle.triggerAttackRelease(0.01, time + jitter, 0.3 + Math.random() * 0.7);
        }
      },
      nodes: [hiss, hissFilter, crackle, crackleFilter],
    };
  },
  events: (_notes, bar, bars) => {
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      ev.push({ time: t(bar + b, 0), dur: "1m" });
      for (let step = 0; step < 16; step++) ev.push({ time: t(bar + b, step) });
    }
    return ev;
  },
};

// ゲームBGM：キラキラしたベル（コード構成音を上から下りる）
const gameBell: SignatureDef = {
  label: "ベル",
  create: out => {
    const reverb = new Tone.Reverb({ decay: 3, wet: 0.4 }).connect(out);
    const synth  = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity:     3.01,
      modulationIndex: 12,
      oscillator:      { type: "sine" },
      envelope:        { attack: 0.001, decay: 1.2, sustain: 0, release: 1.2 },
      modulation:      { type: "sine" },
      modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.4 },
      volume:          -20,
    }).connect(reverb);
    return {
      trigger: (e, time) => synth.triggerAttackRelease(e.notes!, e.dur!, time),
      nodes:   [synth, reverb],
    };
  },
  events: (notes, bar, bars) => {
    const high = [...notes].reverse().map(n => shiftOctave(n, 1));
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      [0, 6, 12].forEach((step, i) =>
        ev.push({ time: t(bar + b, step), notes: [high[i % high.length]], dur: "4n" }));
    }
    return ev;
  },
};

// ハウス：シンコペーションのピアノ（オルガン）スタブ
const housePiano: SignatureDef = {
  label: "ピアノスタブ",
  create: out => {
    const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.25 }).connect(out);
    const synth  = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity:     2,
      modulationIndex: 3,
      oscillator:      { type: "sine" },
      envelope:        { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.2 },
      modulation:      { type: "triangle" },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
      volume:          -20,
    }).connect(reverb);
    return {
      trigger: (e, time) => synth.triggerAttackRelease(e.notes!, e.dur!, time),
      nodes:   [synth, reverb],
    };
  },
  events: (notes, bar, bars) => {
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      for (const step of [0, 3, 6, 10, 12]) ev.push({ time: t(bar + b, step), notes, dur: "16n" });
    }
    return ev;
  },
};

// トランス：厚いのこぎり波（スーパーソウ）のコードを16分で刻むトランスゲート（x = 発音、. = 休み）
const GATE_PATTERNS = ["xx.xx.x.xx.xx.x.", "xx.xx.x.xxx.x.xx"];
const tranceGate: SignatureDef = {
  label: "トランスゲート",
  create: out => {
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 }).connect(out);
    const delay  = new Tone.PingPongDelay({ delayTime: "8n.", feedback: 0.2, wet: 0.15 }).connect(reverb);
    const filter = new Tone.Filter({ type: "lowpass", frequency: 4500, Q: 0.7 }).connect(delay);
    const synth  = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 30 } as any,
      envelope:   { attack: 0.003, decay: 0.08, sustain: 0.5, release: 0.04 },
      volume:     -26,
    }).connect(filter);
    return {
      trigger: (e, time) => synth.triggerAttackRelease(e.notes!, e.dur!, time),
      nodes:   [synth, filter, delay, reverb],
    };
  },
  events: (notes, bar, bars) => {
    const chord = [...notes, shiftOctave(notes[0], 1)];
    const ev: SignatureEvent[] = [];
    for (let b = 0; b < bars; b++) {
      const pattern = GATE_PATTERNS[(bar + b) % GATE_PATTERNS.length];
      [...pattern].forEach((c, step) => {
        if (c === "x") ev.push({ time: t(bar + b, step), notes: chord, dur: "32n" });
      });
    }
    return ev;
  },
};

// アンビエント：ゆっくりうねる風のようなノイズ
const ambientWind: SignatureDef = {
  label: "ウィンド",
  create: out => {
    const filter = new Tone.AutoFilter({
      frequency:     0.07,
      baseFrequency: 250,
      octaves:       3.5,
      filter:        { type: "bandpass", rolloff: -12, Q: 3 },
    }).connect(out).start();
    const noise = new Tone.NoiseSynth({
      noise:    { type: "pink" },
      envelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.5 },
      volume:   -24,
    }).connect(filter);
    return {
      trigger: (e, time) => noise.triggerAttackRelease(e.dur!, time),
      nodes:   [noise, filter],
    };
  },
  // コードの長さぶん鳴らし続ける（区切りでフェードが重なる）
  events: (_notes, bar, bars) => [{ time: t(bar, 0), dur: `${bars}m` }],
};

const SIGNATURES: Record<string, SignatureDef> = {
  "EDM":      edmStab,
  "8bit":     chipArp,
  "ローファイ": vinylNoise,
  "ゲームBGM": gameBell,
  "テクノ":    technoAcid,
  "ハウス":    housePiano,
  "トランス":  tranceGate,
  "アンビエント": ambientWind,
};

export function signatureDef(genre: string = getState().genre): SignatureDef {
  return SIGNATURES[genre] ?? SIGNATURES["ローファイ"];
}

// 表示名（アレンジャー用）
export function signatureLabel(genre?: string): string {
  return signatureDef(genre).label;
}

// ===== パート =====

let sigPart:  Tone.Part | null = null;
let sigVoice: SignatureVoice | null = null;

// 音色は AppState.genre から決める
export function initSignatureSynth() {
  const vol = createVolumeNode("signature");  // 現在のオーディオコンテキスト用のノード
  sigVoice = signatureDef().create(vol);
}

export function loadSignature(progression: ChordProgression, key: string = "A") {
  if (sigPart) { sigPart.dispose(); sigPart = null; }
  if (!sigVoice) initSignatureSynth();

  const def = signatureDef();
  const events: SignatureEvent[] = [];
  progression.progression.forEach(chord => {
    const resolved = resolveChord(chord.degree, chord.type, chord.inversion, key, progression.base_scale, 4);
    events.push(...def.events(resolved.notes, chord.bar - 1, chord.duration_bars));
  });

  const arranged = arrangementGate("signature");
  sigPart = new Tone.Part((time, event: SignatureEvent) => {
    if (!arranged(time)) return;
    sigVoice?.trigger(event, time);
  }, events);

  sigPart.loop    = true;
  sigPart.loopEnd = `${progression.length_bars}m`;
  sigPart.start(0);
}

export function disposeSignature() {
  sigPart?.dispose();
  sigVoice?.nodes.forEach(n => n.dispose());
  sigPart  = null;
  sigVoice = null;
}
