import * as Tone from "tone";
import { MelodyNote } from "./MelodyGenerator";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState, MelodyInstrument } from "./AppState";
import melodyParams from "../data/melody_params.json";
import { GrowInstrument, currentGrowValues, isGrowReady, prepareGrowContext } from "./Grow";


let melodyPart:  Tone.Part | null = null;
let melodySynth: MelodySynth | GrowInstrument | null = null;
let melodyFx:    Tone.ToneAudioNode[] = [];  // Synth の後ろにつなぐエフェクト（Synth と一緒に破棄する）
let melodyVol:   Tone.Volume | null = null;

// ジャンルごとの音色（grow は INSTRUMENTS ではなく Grow.ts で鳴らす）
type SoundName = Exclude<MelodyInstrument, "auto" | "grow">;

// メロディは単音なので、単音の Synth のどれか
type MelodySynth = Tone.Synth | Tone.MonoSynth | Tone.FMSynth;

// 音色ごとの設定。synth は単音の Synth、fx は Synth → 出力の間に順につなぐエフェクト
// （音量は波形の聞こえ方の差をならす。reverb は 0〜1 のかかり具合）
interface MelodySound {
  synth:  () => MelodySynth;
  fx:     () => Tone.ToneAudioNode[];
  reverb: { decay: number; wet: number };
}

const INSTRUMENTS: Record<SoundName, MelodySound> = {
  // ソフトサイン：サインに少しだけ倍音を足し、ゆるいビブラートで歌わせる
  soft: {
    synth: () => new Tone.Synth({
      oscillator: { type: "custom", partials: [1, 0.15, 0.05] },
      envelope:   { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.6 },
      volume:     -8,
    }),
    fx:     () => [new Tone.Vibrato({ frequency: 5, depth: 0.06 })],
    reverb: { decay: 2.0, wet: 0.25 },
  },
  // シンセリード：ノコギリ波2枚をローパスで整え、音のつながりはポルタメントで滑らせる
  lead: {
    synth: () => new Tone.MonoSynth({
      oscillator:     { type: "fatsawtooth", count: 2, spread: 12 },
      filter:         { type: "lowpass", Q: 1, rolloff: -24 },
      envelope:       { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
      filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3, baseFrequency: 800, octaves: 3 },
      portamento:     0.02,
      volume:         -15,
    }),
    fx: () => [
      new Tone.Vibrato({ frequency: 5.5, depth: 0.05 }),
      new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 0.18 }),
    ],
    reverb: { decay: 1.8, wet: 0.2 },
  },
  // スクエア（8bit）：デューティ比 25% のパルス波。ファミコン風に浅いビブラートをかける
  square: {
    synth: () => new Tone.Synth({
      oscillator: { type: "pulse", width: 0.5 },  // width 0 が矩形波（50%）。0.5 でデューティ比 25% 相当の細い音
      envelope:   { attack: 0.002, decay: 0.1, sustain: 0.6, release: 0.05 },
      volume:     -18,
    }),
    fx: () => [
      new Tone.Vibrato({ frequency: 6, depth: 0.08 }),
      new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.2, wet: 0.12 }),
    ],
    reverb: { decay: 0.8, wet: 0.08 },
  },
  // プラック：フィルターが素早く閉じる、弦をはじいたような音
  pluck: {
    synth: () => new Tone.MonoSynth({
      oscillator:     { type: "sawtooth" },
      filter:         { type: "lowpass", Q: 2, rolloff: -24 },
      envelope:       { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.3 },
      filterEnvelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.2, baseFrequency: 300, octaves: 4 },
      volume:         -10,
    }),
    fx:     () => [new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.3, wet: 0.22 })],
    reverb: { decay: 1.6, wet: 0.22 },
  },
  // SuperSaw リード：ずらしたノコギリ波を重ねた厚い音（EDM 向け）。ディレイで広がりを出す
  supersaw: {
    synth: () => new Tone.MonoSynth({
      oscillator:     { type: "fatsawtooth", count: 5, spread: 35 },
      filter:         { type: "lowpass", Q: 0.7, rolloff: -12 },
      envelope:       { attack: 0.01, decay: 0.25, sustain: 0.75, release: 0.35 },
      filterEnvelope: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.3, baseFrequency: 1200, octaves: 2.5 },
      portamento:     0.015,
      volume:         -19,
    }),
    fx: () => [
      new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.3, wet: 0.2 }),
      new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5, wet: 0.3 }).start(),
    ],
    reverb: { decay: 2.5, wet: 0.25 },
  },
  // エレピ：FM で鍵盤らしい倍音を作り、高域を落としてテープのような揺れを足す（ローファイ向け）
  epiano: {
    synth: () => new Tone.FMSynth({
      harmonicity:        3,
      modulationIndex:    2.5,
      oscillator:         { type: "sine" },
      envelope:           { attack: 0.005, decay: 1.4, sustain: 0.25, release: 0.8 },
      modulation:         { type: "sine" },
      modulationEnvelope: { attack: 0.005, decay: 0.35, sustain: 0.05, release: 0.4 },
      volume:             -9,
    }),
    fx: () => [
      new Tone.Filter({ type: "lowpass", frequency: 2800, rolloff: -12 }),
      new Tone.Vibrato({ frequency: 0.6, depth: 0.08 }),  // テープの回転ムラ（ワウ）
      new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.4, wet: 0.35 }).start(),
    ],
    reverb: { decay: 2.2, wet: 0.28 },
  },
  // ベル：非整数倍の FM で鐘のような響きにする（ゲームBGM 向け）
  bell: {
    synth: () => new Tone.FMSynth({
      harmonicity:        3.5,
      modulationIndex:    6,
      oscillator:         { type: "sine" },
      envelope:           { attack: 0.002, decay: 1.2, sustain: 0.15, release: 1.2 },
      modulation:         { type: "sine" },
      modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.8 },
      volume:             -12,
    }),
    fx:     () => [new Tone.FeedbackDelay({ delayTime: "4n", feedback: 0.2, wet: 0.15 })],
    reverb: { decay: 2.8, wet: 0.3 },
  },
  // アシッド：レゾナンスの強いフィルターを短く開閉させる（テクノ向け）
  acid: {
    synth: () => new Tone.MonoSynth({
      oscillator:     { type: "sawtooth" },
      filter:         { type: "lowpass", Q: 8, rolloff: -24 },
      envelope:       { attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.08 },
      filterEnvelope: { attack: 0.003, decay: 0.15, sustain: 0.15, release: 0.1, baseFrequency: 250, octaves: 3.5 },
      portamento:     0.04,
      volume:         -14,
    }),
    fx: () => [
      new Tone.Distortion({ distortion: 0.25, wet: 0.35 }),
      new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.35, wet: 0.2 }),
    ],
    reverb: { decay: 1.2, wet: 0.12 },
  },
};

// 実際に鳴らす音色。"auto" はジャンルの標準（melody_params.json の instrument）。
// "grow" は今のオーディオコンテキストで grow の準備ができていれば grow、できていなければジャンルの標準
export function resolveMelodySound(): SoundName | "grow" {
  const s = getState();
  if (s.melodyInstrument === "grow") {
    if (isGrowReady()) return "grow";
  } else if (s.melodyInstrument !== "auto" && s.melodyInstrument in INSTRUMENTS) {
    return s.melodyInstrument;
  }
  const params = melodyParams as unknown as Record<string, { instrument?: SoundName }>;
  const name = (params[s.genre] ?? params["ローファイ"]).instrument;
  return name && name in INSTRUMENTS ? name : "soft";
}

// 音色は AppState.melodyInstrument（"auto" ならジャンル）から決める。変更は次に Synth を作り直したとき（再生開始時）に反映される
export function initMelodySynth() {
  disposeMelodySynth();
  melodyVol = createVolumeNode("melody");  // 現在のオーディオコンテキスト用のノード
  const sound = resolveMelodySound();
  if (sound === "grow") {
    // grow は自前のエフェクト（リバーブを含む）を持つので、そのままメロディの Volume へ
    melodySynth = new GrowInstrument(currentGrowValues()!, getState().bpm).connect(melodyVol);
    return;
  }
  const inst   = INSTRUMENTS[sound];
  const reverb = new Tone.Reverb(inst.reverb).connect(melodyVol);
  melodyFx    = [...inst.fx(), reverb];
  const synth = inst.synth();
  synth.chain(...melodyFx);
  melodySynth = synth;
}

// 強拍ほど強く鳴らす（小節頭 > 拍頭 > それ以外）
function velocityAt(time: string): number {
  const ticks = Tone.Time(time).toTicks();
  const ppq   = Tone.getTransport().PPQ;
  if (ticks % (ppq * 4) === 0) return 0.95;
  if (ticks % ppq === 0)       return 0.85;
  return 0.72;
}

export function loadMelody(notes: MelodyNote[], loopEnd: string) {
  if (melodyPart) { melodyPart.dispose(); melodyPart = null; }
  if (!melodySynth) initMelodySynth();

  const events = notes
    .filter(n => n.note !== null)
    .map(n => ({ time: n.time, note: n.note!, dur: n.duration, vel: velocityAt(n.time) }));

  const arranged = arrangementGate("melody");
  melodyPart = new Tone.Part((time, event: any) => {
    if (!arranged(time)) return;
    melodySynth?.triggerAttackRelease(event.note, event.dur, time, event.vel);
  }, events);

  melodyPart.loop    = true;
  melodyPart.loopEnd = loopEnd;
  melodyPart.start(0);
}

// ピアノロールで置いた音を試聴する（Synth がなければ作る。再生中は鳴っているメロディの Synth で鳴らす）
export async function previewMelodyNote(note: string) {
  await Tone.start();
  if (getState().melodyInstrument === "grow") await prepareGrowContext();
  if (!melodySynth) initMelodySynth();
  melodySynth?.triggerAttackRelease(note, "8n", undefined, 0.8);
}

// grow の音作りの値と BPM（テンポ同期の LFO・ディレイ）を、鳴っているメロディにすぐ当てる（作り直さない）
export function applyGrowLive(): void {
  if (!(melodySynth instanceof GrowInstrument)) return;
  const values = currentGrowValues();
  if (values) melodySynth.setValues(values);
  melodySynth.setBpm(getState().bpm);
}

// メロディの Synth を今の設定で作り直す（再生中なら鳴っている Part はそのまま新しい Synth で鳴る）
export function refreshMelodySynth(): void {
  if (melodySynth) initMelodySynth();
}

function disposeMelodySynth() {
  melodySynth?.dispose();
  melodyFx.forEach(n => n.dispose());
  melodySynth = null;
  melodyFx    = [];
}

export function disposeMelody() {
  melodyPart?.dispose();
  melodyPart = null;
  disposeMelodySynth();
}
