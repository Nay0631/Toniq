import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { voiceProgression, VOICING_RANGES, noteToMidi, midiToNote } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState } from "./AppState";
import arpParams from "../data/arp_params.json";

// ===== ジャンル別のアルペジオ設定（arp_params.json） =====
type ArpInstrument = "pluck" | "square" | "keys" | "bell" | "blip";
type ArpPatternName = "up" | "down" | "updown" | "pedal";

export interface ArpParam {
  instrument: ArpInstrument;
  step:       "16n" | "8n" | "4n";   // 刻みの細かさ
  pattern:    ArpPatternName;        // 構成音を鳴らす順番
  octaves:    1 | 2;                 // 2 なら構成音を1オクターブ上にも重ねる
  gate:       number;                // 音の長さ（刻みに対する割合）
  cutoff:     number;                // ローパスの周波数（Hz）
  delay:      { time: string; feedback: number; wet: number };
}

export function arpParam(): ArpParam {
  const params = arpParams as unknown as Record<string, ArpParam>;
  return params[getState().genre] ?? params["ローファイ"];
}

// 音色ごとの Synth（音量は波形の聞こえ方の差をならす）
const INSTRUMENTS: Record<ArpInstrument, () => Tone.PolySynth<any>> = {
  // プラック：ノコギリ波にすばやく閉じるフィルターをかけた、はじくような音（EDM・トランス）
  pluck: () => new Tone.PolySynth(Tone.MonoSynth, {
    oscillator:     { type: "sawtooth" },
    filter:         { type: "lowpass", Q: 2, rolloff: -24 },
    envelope:       { attack: 0.002, decay: 0.25, sustain: 0.1, release: 0.2 },
    filterEnvelope: { attack: 0.002, decay: 0.15, sustain: 0.1, release: 0.2, baseFrequency: 300, octaves: 4 },
    volume:         -14,
  }),
  // 8bit：デューティ比 25% のパルス波（ファミコン風）
  square: () => new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "pulse", width: 0.25 },
    envelope:   { attack: 0.002, decay: 0.1, sustain: 0.5, release: 0.05 },
    volume:     -22,
  }),
  // キーズ：やわらかい FM のエレピ風（ローファイ・ハウス）
  keys: () => new Tone.PolySynth(Tone.FMSynth, {
    harmonicity:        2,
    modulationIndex:    1.5,
    oscillator:         { type: "sine" },
    envelope:           { attack: 0.005, decay: 0.8, sustain: 0.2, release: 0.6 },
    modulation:         { type: "sine" },
    modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.4 },
    volume:             -10,
  }),
  // ベル：非整数倍の FM で金属的な倍音、長い減衰（ゲームBGM・アンビエント）
  bell: () => new Tone.PolySynth(Tone.FMSynth, {
    harmonicity:        3.5,
    modulationIndex:    8,
    oscillator:         { type: "sine" },
    envelope:           { attack: 0.001, decay: 1.5, sustain: 0, release: 1.5 },
    modulation:         { type: "sine" },
    modulationEnvelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.6 },
    volume:             -16,
  }),
  // ブリップ：短く切れる矩形波にクセのあるフィルター（テクノ）
  blip: () => new Tone.PolySynth(Tone.MonoSynth, {
    oscillator:     { type: "square" },
    filter:         { type: "lowpass", Q: 6, rolloff: -24 },
    envelope:       { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
    filterEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05, baseFrequency: 250, octaves: 3.5 },
    volume:         -14,
  }),
};

// 構成音（低い順に n 個）を鳴らす順番。1周したら頭に戻る
const PATTERNS: Record<ArpPatternName, (n: number) => number[]> = {
  up:     (n) => [...Array(n).keys()],
  down:   (n) => [...Array(n).keys()].reverse(),
  // 上って下りる（両端は繰り返さない）
  updown: (n) => n < 3 ? [...Array(n).keys()] : [...Array(n).keys(), ...[...Array(n - 2).keys()].map((i) => n - 2 - i)],
  // 一番下の音と交互に鳴らす
  pedal:  (n) => n < 2 ? [0] : [...Array(n - 1).keys()].flatMap((i) => [0, i + 1]),
};

const SIXTEENTHS: Record<ArpParam["step"], number> = { "16n": 1, "8n": 2, "4n": 4 };

export interface ArpNote {
  sixteenth: number;  // ループの頭からの位置（16分音符の数）
  note:      string;
  velocity:  number;  // 基準の強さ（再生時は少し揺らす）
}

// アルペジオの音の並び（再生と MIDI 書き出しで共通）。
// ボイシングは前のコードから一番近い転回形で決める（voiceProgression）。パターンはコードが変わるたびに頭から
export function arpNotes(progression: ChordProgression, key: string, param: ArpParam = arpParam()): ArpNote[] {
  const range  = param.octaves === 2 ? VOICING_RANGES.arpWide : VOICING_RANGES.arp;
  const voiced = voiceProgression(progression, key, range);
  const stepLen = SIXTEENTHS[param.step] ?? 2;
  const out: ArpNote[] = [];

  progression.progression.forEach((chord, c) => {
    if (chord.ending) return;  // エンディングの主和音では刻まない
    const notes = param.octaves === 2
      ? [...voiced[c], ...voiced[c].map((n) => midiToNote(noteToMidi(n) + 12))]
      : voiced[c];
    const order = PATTERNS[param.pattern]?.(notes.length) ?? PATTERNS.up(notes.length);
    const start = (chord.bar - 1) * 16;

    for (let i = 0, six = 0; six < chord.duration_bars * 16; i++, six += stepLen) {
      // 小節の頭を一番強く、拍の頭を中くらい、裏を弱く
      const velocity = six % 16 === 0 ? 0.85 : six % 4 === 0 ? 0.7 : 0.55;
      out.push({ sixteenth: start + six, note: notes[order[i % order.length]], velocity });
    }
  });
  return out;
}

let arpPart:    Tone.Part | null = null;
let arpSynth:   Tone.PolySynth<any> | null = null;
let arpVol:     Tone.Volume | null = null;
let arpEffects: Tone.ToneAudioNode[] = [];

// 音色・ローパス・ディレイは AppState.genre から決める。変更は次に Synth を作り直したとき（再生開始時）に反映される
// 音の流れ：Synth → ローパス → ピンポンディレイ（左右に跳ねる）→ Volume。リバーブはミキサーの送りでかける
export function initArpSynth() {
  disposeSynth();
  arpVol = createVolumeNode("arp");  // 現在のオーディオコンテキスト用のノード
  const param  = arpParam();
  const delay  = new Tone.PingPongDelay({
    delayTime: param.delay.time as Tone.Unit.Time,
    feedback:  param.delay.feedback,
    wet:       param.delay.wet,
  }).connect(arpVol);
  const filter = new Tone.Filter({ type: "lowpass", frequency: param.cutoff, Q: 0.7, rolloff: -12 }).connect(delay);
  arpEffects = [filter, delay];
  arpSynth = (INSTRUMENTS[param.instrument] ?? INSTRUMENTS.square)().connect(filter);
}

// 刻み・パターン・音の長さは読み込んだ時点のジャンルで決める
export function loadArpPattern(progression: ChordProgression, key: string = "A") {
  if (arpPart) { arpPart.dispose(); arpPart = null; }
  if (!arpSynth) initArpSynth();

  const param  = arpParam();
  const events = arpNotes(progression, key, param).map((n) => ({ ...n, time: `0:0:${n.sixteenth}` }));

  const arranged = arrangementGate("arp");
  arpPart = new Tone.Part((time, event: ArpNote) => {
    if (!arranged(time)) return;
    // BPM が変わっても合うよう、長さは鳴らすときに秒にする
    const dur = Tone.Time(param.step).toSeconds() * param.gate;
    const velocity = Math.min(1, Math.max(0.1, event.velocity + (Math.random() - 0.5) * 0.1));
    arpSynth?.triggerAttackRelease(event.note, dur, time, velocity);
  }, events);

  arpPart.loop    = true;
  arpPart.loopEnd = `${progression.length_bars}m`;
  arpPart.start(0);
}

function disposeSynth() {
  arpSynth?.dispose();
  arpEffects.forEach((n) => n.dispose());
  arpSynth   = null;
  arpEffects = [];
}

export function disposeArp() {
  arpPart?.dispose();
  arpPart = null;
  disposeSynth();
}
