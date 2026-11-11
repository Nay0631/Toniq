import * as Tone from "tone";

// grow（Toniq の内部シンセサイザー。コード上の名前は旧名の ToniqSynth / ToniqVoice。テスト中）：
// メロディの音色「Toniq シンセ」で鳴らす単音シンセ。
// 音の流れ：レイヤー A・B（それぞれ OSC1・OSC2・サブ・ノイズ → フィルター（エンベロープ・LFO）→ アンプ（ADSR）→ レイヤーの音量）
//          → 2つを足す → 音量の LFO → ドライブ → コーラス → ディレイ → 出力
// レイヤーは音を重ねるためのもので、たとえばパッドなら「暗く厚い本体」と「明るいエアー」を別々のフィルター・エンベロープで作って重ねる。
// A は常に鳴り、B は ON のときだけ鳴る。LFO・グライド・エフェクト・出力は2つのレイヤーで共通。
// ユニゾンは重ねた音を1枚ずつ別のオシレーターで鳴らし、ずらした高さに合わせて左右に振り分ける（ステレオ幅）。
// 後ろの響き（リバーブ）は自前で持たず、マスターのリバーブ送りで付ける。
// 音作りの値は AppState.toniqSynth（曲に保存する）に置き、ノブの値はすべて 0〜100（波形などは選択肢）。
// 実際の単位（Hz・秒など）への変換はここの関数で行う

export type ToniqWave = "sawtooth" | "square" | "triangle" | "sine";
export type ToniqFilterType = "lowpass" | "highpass" | "bandpass";
export type ToniqLfoTarget = "off" | "pitch" | "filter" | "amp";

// レイヤー1つ分の音作り
export interface ToniqLayerParams {
  on:         boolean;  // B を鳴らすか（A は常に鳴らす）
  octave:     number;   // -2〜+2（レイヤー全体の高さ）
  volume:     number;   // レイヤーの音量（80 = 基準）
  // オシレーター
  osc1Wave:   ToniqWave;
  osc1Level:  number;
  osc2Wave:   ToniqWave;
  osc2Level:  number;
  osc2Octave: number;  // -2〜+2（オクターブ）
  osc2Detune: number;  // 0〜100（50 = ずらさない。±50 セント）
  subLevel:   number;  // 1オクターブ下のサイン波
  noiseLevel: number;
  // ユニゾン
  unison:     number;  // 0〜100（重ねる枚数 1〜7）
  spread:     number;  // 重ねた音の高さのずれ幅（デチューン）
  width:      number;  // 重ねた音を左右に広げる幅（0 = 真ん中だけ）
  // フィルター
  filterType: ToniqFilterType;
  cutoff:     number;
  resonance:  number;
  envAmount:  number;  // フィルターのエンベロープで開く量
  fAttack:    number;
  fDecay:     number;
  fSustain:   number;
  fRelease:   number;
  // アンプ
  attack:     number;
  decay:      number;
  sustain:    number;
  release:    number;
}

export interface ToniqSynthParams {
  layers:     [ToniqLayerParams, ToniqLayerParams];  // [A, B]
  glide:      number;  // 音のつながりを滑らせる時間
  // LFO
  lfoTarget:  ToniqLfoTarget;
  lfoRate:    number;
  lfoDepth:   number;
  // エフェクト・出力
  drive:      number;
  chorus:     number;
  delay:      number;
  level:      number;
}

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
export type ToniqLayerKnobKey  = NumericKeys<ToniqLayerParams>;
export type ToniqGlobalKnobKey = NumericKeys<ToniqSynthParams>;
export type ToniqKnobKey = ToniqLayerKnobKey | ToniqGlobalKnobKey;

// ===== 値の変換（ノブの 0〜100 → 実際の単位） =====

// 0〜100 → 1ms〜5秒（対数。時間はノブの左側ほど細かく動かせるように）
export function toSeconds(v: number): number {
  return 0.001 * Math.pow(5000, v / 100);
}
export function cutoffHz(v: number): number {
  return 40 * Math.pow(18000 / 40, v / 100);
}
export function resonanceQ(v: number): number {
  return 0.5 + Math.pow(v / 100, 2) * 17.5;
}
export function lfoHz(v: number): number {
  return 0.1 * Math.pow(200, v / 100);  // 0.1〜20Hz
}
export function unisonCount(v: number): number {
  return 1 + Math.round((v / 100) * 6);
}
export function detuneCents(v: number): number {
  return v - 50;
}
export function glideSeconds(v: number): number {
  return Math.pow(v / 100, 2) * 0.5;  // 0〜0.5秒
}
// ユニゾンの高さのずれ幅（セント。いちばん低い音〜いちばん高い音）。
// 重ねた音の高さが同じだと位相によって打ち消し合うので、重ねるときは最低 8 セントずらす
export function unisonSpreadCents(unison: number, spread: number): number {
  return unisonCount(unison) > 1 ? 8 + spread * 0.72 : 0;
}

// ノブの横に出す値
export function formatParam(key: ToniqKnobKey, v: number): string {
  const sec = (s: number) => s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(2)}s`;
  switch (key) {
    case "attack": case "decay": case "release":
    case "fAttack": case "fDecay": case "fRelease":
      return sec(toSeconds(v));
    case "cutoff": {
      const hz = cutoffHz(v);
      return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
    }
    case "resonance": return `Q${resonanceQ(v).toFixed(1)}`;
    case "lfoRate":   return `${lfoHz(v).toFixed(lfoHz(v) < 10 ? 1 : 0)}Hz`;
    case "unison":    return `×${unisonCount(v)}`;
    case "osc2Detune": {
      const c = detuneCents(v);
      return `${c > 0 ? "+" : ""}${c}c`;
    }
    case "width":     return `${Math.round(v)}%`;
    case "glide":     return v === 0 ? "OFF" : sec(glideSeconds(v));
    case "osc2Octave": case "octave": return `${v > 0 ? "+" : ""}${v}`;
    default:          return `${Math.round(v)}`;
  }
}

// ===== 初期値・プリセット =====

// レイヤー A の初期値（旧版の初期値と同じ音に、ステレオ幅を足したもの）
export const DEFAULT_TONIQ_LAYER: ToniqLayerParams = {
  on: true, octave: 0, volume: 80,
  osc1Wave: "sawtooth", osc1Level: 80,
  osc2Wave: "square",   osc2Level: 45, osc2Octave: 0, osc2Detune: 56,
  subLevel: 25, noiseLevel: 0,
  unison: 17, spread: 30, width: 50,
  filterType: "lowpass", cutoff: 52, resonance: 25, envAmount: 40,
  fAttack: 5, fDecay: 62, fSustain: 40, fRelease: 59,
  attack: 10, decay: 62, sustain: 70, release: 59,
};

// レイヤー B の初期値（OFF。ON にすると1オクターブ上の明るい音が薄く重なる）
export const DEFAULT_TONIQ_LAYER_B: ToniqLayerParams = {
  ...DEFAULT_TONIQ_LAYER,
  on: false, octave: 1, volume: 45,
  osc1Wave: "triangle", osc1Level: 75,
  osc2Wave: "sine", osc2Level: 0, osc2Detune: 50,
  subLevel: 0, noiseLevel: 10,
  unison: 50, spread: 35, width: 100,
  cutoff: 68, resonance: 5, envAmount: 10,
  attack: 30, sustain: 75, release: 70,
};

const LAYER_KEYS = Object.keys(DEFAULT_TONIQ_LAYER) as (keyof ToniqLayerParams)[];

export const DEFAULT_TONIQ_SYNTH: ToniqSynthParams = {
  layers: [DEFAULT_TONIQ_LAYER, DEFAULT_TONIQ_LAYER_B],
  glide: 20,
  lfoTarget: "pitch", lfoRate: 76, lfoDepth: 12,
  drive: 0, chorus: 20, delay: 20, level: 70,
};

const GLOBAL_KEYS = (Object.keys(DEFAULT_TONIQ_SYNTH) as (keyof ToniqSynthParams)[]).filter(k => k !== "layers");

export interface ToniqPreset {
  id:     string;
  label:  string;
  params: ToniqSynthParams;
}

const preset = (
  id: string, label: string,
  g: Partial<Omit<ToniqSynthParams, "layers">>,
  a: Partial<ToniqLayerParams> = {},
  b?: Partial<ToniqLayerParams>,
): ToniqPreset => ({
  id, label,
  params: {
    ...DEFAULT_TONIQ_SYNTH, ...g,
    layers: [
      { ...DEFAULT_TONIQ_LAYER, ...a, on: true },
      b ? { ...DEFAULT_TONIQ_LAYER_B, ...b, on: true } : { ...DEFAULT_TONIQ_LAYER_B },
    ],
  },
});

export const TONIQ_PRESETS: ToniqPreset[] = [
  preset("standard", "スタンダードリード", {}),
  preset("wide", "ワイドリード", { chorus: 35, delay: 30, level: 58 }, {
    osc1Wave: "sawtooth", osc2Wave: "sawtooth", osc2Level: 60, osc2Detune: 58,
    unison: 67, spread: 60, width: 100, cutoff: 62, envAmount: 30,
  }, {
    // 1オクターブ上のノコギリ波を薄く重ねて抜けを良くする
    octave: 1, volume: 35, osc1Wave: "sawtooth", osc1Level: 60, noiseLevel: 0,
    unison: 33, spread: 40, width: 80, cutoff: 58, envAmount: 20, attack: 10,
  }),
  preset("supersaw", "スーパーソウ", { glide: 0, lfoTarget: "off", chorus: 25, delay: 25, level: 54 }, {
    osc1Wave: "sawtooth", osc1Level: 80, osc2Wave: "sawtooth", osc2Level: 55, osc2Detune: 50,
    subLevel: 10, unison: 100, spread: 55, width: 100,
    cutoff: 68, resonance: 10, envAmount: 20, attack: 5, sustain: 80, release: 62,
  }, {
    // 1オクターブ下を真ん中寄りに重ねて、広がった音に芯を作る
    octave: -1, volume: 45, osc1Wave: "sawtooth", osc1Level: 70, noiseLevel: 0,
    unison: 17, spread: 20, width: 20, cutoff: 50, envAmount: 15, attack: 5, sustain: 80, release: 62,
  }),
  preset("glass", "ガラスベル", { glide: 0, lfoTarget: "off", chorus: 25, delay: 40, level: 86 }, {
    osc1Wave: "sine", osc1Level: 80, osc2Wave: "triangle", osc2Level: 40, osc2Octave: 2, osc2Detune: 50,
    subLevel: 0, unison: 0, spread: 0, width: 30,
    cutoff: 80, resonance: 10, envAmount: 20, fAttack: 0, fDecay: 70, fSustain: 30,
    attack: 0, decay: 80, sustain: 15, release: 78,
  }),
  preset("chip", "チップチューン", { glide: 0, lfoTarget: "pitch", lfoRate: 80, lfoDepth: 18, chorus: 0, delay: 15, level: 74 }, {
    osc1Wave: "square", osc1Level: 75, osc2Wave: "square", osc2Level: 25, osc2Octave: 1, osc2Detune: 50,
    subLevel: 0, unison: 0, spread: 0, width: 0,
    cutoff: 100, resonance: 0, envAmount: 0,
    attack: 0, decay: 40, sustain: 65, release: 20,
  }),
  preset("wah", "ワウリード", { lfoTarget: "filter", lfoRate: 50, lfoDepth: 60, chorus: 15, delay: 25, level: 58 }, {
    osc1Wave: "sawtooth", osc2Wave: "sawtooth", osc2Level: 50, osc2Detune: 54, width: 40,
    cutoff: 42, resonance: 55, envAmount: 15,
  }),
  preset("soft", "ソフトパッド", { glide: 10, lfoTarget: "amp", lfoRate: 30, lfoDepth: 15, chorus: 45, delay: 25, level: 58 }, {
    // 本体：ゆっくり立ち上がる、こもった厚いノコギリ波
    osc1Wave: "sawtooth", osc1Level: 70, osc2Wave: "triangle", osc2Level: 50, osc2Detune: 54,
    subLevel: 15, noiseLevel: 0, unison: 67, spread: 45, width: 90,
    cutoff: 40, resonance: 8, envAmount: 15, fAttack: 60, fDecay: 70, fSustain: 60, fRelease: 75,
    attack: 65, decay: 70, sustain: 85, release: 78,
  }, {
    // エアー：1オクターブ上の柔らかい音とノイズを、低い所を削って左右いっぱいに広げる。本体より遅れてふわっと出る
    octave: 1, volume: 50,
    osc1Wave: "triangle", osc1Level: 55, osc2Wave: "sine", osc2Level: 40, osc2Octave: 1, osc2Detune: 52,
    subLevel: 0, noiseLevel: 18, unison: 50, spread: 30, width: 100,
    filterType: "highpass", cutoff: 55, resonance: 5, envAmount: 0,
    attack: 75, decay: 70, sustain: 80, release: 82,
  }),
  preset("acid", "アシッド", { glide: 30, lfoTarget: "off", drive: 40, chorus: 0, delay: 30, level: 62 }, {
    osc1Wave: "sawtooth", osc1Level: 90, osc2Wave: "square", osc2Level: 0,
    subLevel: 10, unison: 0, spread: 0, width: 0,
    cutoff: 25, resonance: 78, envAmount: 62, fAttack: 0, fDecay: 58, fSustain: 15, fRelease: 40,
    attack: 0, decay: 62, sustain: 60, release: 40,
  }),
];

// 2つの音作りが同じか（B がどちらも OFF なら B の中身は比べない）
function sameParams(a: ToniqSynthParams, b: ToniqSynthParams): boolean {
  if (!GLOBAL_KEYS.every(k => a[k] === b[k])) return false;
  const sameLayer = (x: ToniqLayerParams, y: ToniqLayerParams) => LAYER_KEYS.every(k => x[k] === y[k]);
  if (!sameLayer(a.layers[0], b.layers[0])) return false;
  if (!a.layers[1].on && !b.layers[1].on) return true;
  return sameLayer(a.layers[1], b.layers[1]);
}

// 今の値と一致するプリセット（なければ null = 手で作った音）
export function matchingPreset(p: ToniqSynthParams): ToniqPreset | null {
  return TONIQ_PRESETS.find(pr => sameParams(pr.params, p)) ?? null;
}

export function cloneToniqSynth(p: ToniqSynthParams): ToniqSynthParams {
  return { ...p, layers: [{ ...p.layers[0] }, { ...p.layers[1] }] };
}

// 保存した曲などで足りない項目を初期値で補う。
// レイヤーのない旧形式（音作りの値が平らに並んだもの）は、その値をレイヤー A にする（旧版はユニゾンを左右に広げていないのでステレオ幅は 0）
export function normalizeToniqSynth(p: unknown): ToniqSynthParams {
  if (!p || typeof p !== "object") return cloneToniqSynth(DEFAULT_TONIQ_SYNTH);
  const src = p as Record<string, unknown>;
  const pickGlobal = () => Object.fromEntries(GLOBAL_KEYS.filter(k => k in src).map(k => [k, src[k]]));
  if (Array.isArray(src.layers)) {
    const [a, b] = src.layers as Partial<ToniqLayerParams>[];
    return {
      ...DEFAULT_TONIQ_SYNTH, ...pickGlobal(),
      layers: [{ ...DEFAULT_TONIQ_LAYER, ...(a ?? {}), on: true }, { ...DEFAULT_TONIQ_LAYER_B, ...(b ?? {}) }],
    };
  }
  const oldLayer = Object.fromEntries(LAYER_KEYS.filter(k => k in src).map(k => [k, src[k]]));
  return {
    ...DEFAULT_TONIQ_SYNTH, ...pickGlobal(),
    layers: [{ ...DEFAULT_TONIQ_LAYER, width: 0, ...oldLayer, on: true }, { ...DEFAULT_TONIQ_LAYER_B }],
  };
}

// ===== 音源 =====

// 出力の大きさ（level 70・レイヤー A だけで、ほかのメロディの音色と同じくらいになる）
const OUTPUT_GAIN = 0.22;
// レイヤーの音量の基準（volume がこの値で 1 倍）
const LAYER_VOLUME_REF = 80;

const levelGain = (v: number) => Math.pow(v / 100, 2);
const cents = (c: number) => Math.pow(2, c / 1200);

// ユニゾンの1枚（オシレーター → 左右の振り分け）
interface UnisonVoice {
  osc: Tone.Oscillator;
  pan: Tone.Panner;
  pos: number;  // -1〜1（重ねた中での位置。高さのずれと左右の位置を決める）
}

// レイヤー1つ分の音源
class ToniqLayer {
  readonly output: Tone.Gain;  // レイヤーの音量

  private voices1: UnisonVoice[] = [];
  private voices2: UnisonVoice[] = [];
  private sub:     Tone.Oscillator | null = null;
  private noises:  { noise: Tone.Noise; pan: Tone.Panner }[] = [];
  private count = 0;  // 鳴らしているユニゾンの枚数（0 = レイヤーを鳴らしていない）

  private g1:     Tone.Gain;
  private g2:     Tone.Gain;
  private gSub:   Tone.Gain;
  private gNoise: Tone.Gain;
  private filter: Tone.Filter;
  private filterEnv: Tone.FrequencyEnvelope;
  private lfoFilter: Tone.LFO;
  private amp:    Tone.AmplitudeEnvelope;
  private nodes:  Tone.ToneAudioNode[];

  private p: ToniqLayerParams;
  private freq = Tone.Frequency("A4").toFrequency();  // 今の音の高さ（レイヤーのオクターブをかける前）

  constructor(params: ToniqLayerParams, private lfoPitch: Tone.LFO) {
    this.p = { ...params };
    this.g1 = new Tone.Gain(0);
    this.g2 = new Tone.Gain(0);
    this.gSub = new Tone.Gain(0);
    this.gNoise = new Tone.Gain(0);
    this.filter    = new Tone.Filter({ type: params.filterType, rolloff: -24 });
    this.filterEnv = new Tone.FrequencyEnvelope({ baseFrequency: 1000, octaves: 0, exponent: 2 });
    this.lfoFilter = new Tone.LFO({ frequency: 5, min: 0, max: 0 }).start();
    this.amp       = new Tone.AmplitudeEnvelope();
    this.output    = new Tone.Gain(0);

    [this.g1, this.g2, this.gSub, this.gNoise].forEach(g => g.connect(this.filter));
    this.filter.chain(this.amp, this.output);
    // フィルターの周波数はエンベロープ＋LFO で決まる（つないだ信号の和になる）
    this.filterEnv.connect(this.filter.frequency);
    this.lfoFilter.connect(this.filter.frequency);

    this.nodes = [
      this.g1, this.g2, this.gSub, this.gNoise, this.filter, this.filterEnv, this.lfoFilter, this.amp, this.output,
    ];
  }

  // 音源（オシレーター・ノイズ）を作り直す。オシレーターは鳴らしっぱなしにして、音の出入りはアンプのエンベロープで決める
  private rebuildSources(count: number): void {
    this.disposeSources();
    this.count = count;
    if (count === 0) return;

    const now = Tone.now();
    const makeVoices = (type: ToniqWave, dest: Tone.Gain): UnisonVoice[] =>
      Array.from({ length: count }, (_, i) => {
        const pos = count === 1 ? 0 : -1 + (2 * i) / (count - 1);
        // 枚数が増えたぶん1枚ずつ小さくする（FatOscillator と同じ補正）。位相はばらばらにして重なりの打ち消し合いを防ぐ
        const osc = new Tone.Oscillator({ type, volume: -6 - count * 1.1, phase: Math.random() * 360 });
        const pan = new Tone.Panner(0).connect(dest);
        osc.connect(pan);
        this.lfoPitch.connect(osc.detune);
        osc.start(now);
        return { osc, pan, pos };
      });
    this.voices1 = makeVoices(this.p.osc1Wave, this.g1);
    this.voices2 = makeVoices(this.p.osc2Wave, this.g2);

    this.sub = new Tone.Oscillator({ type: "sine" }).connect(this.gSub);
    this.lfoPitch.connect(this.sub.detune);
    this.sub.start(now);

    // ノイズは左右別々に鳴らして、ステレオ幅に合わせて広げる
    this.noises = [0, 1].map(() => {
      const pan = new Tone.Panner(0).connect(this.gNoise);
      const noise = new Tone.Noise("white").connect(pan);
      noise.start(now);
      return { noise, pan };
    });

    this.applyPan(0);
    this.applyPitch(now, 0);
  }

  private disposeSources(): void {
    // 共通の音の高さの LFO からも切り離す（つないだままだと破棄した音源が残る）
    const unlink = (osc: Tone.Oscillator) => { try { this.lfoPitch.disconnect(osc.detune); } catch { /* つながっていない */ } };
    for (const v of [...this.voices1, ...this.voices2]) { unlink(v.osc); v.osc.dispose(); v.pan.dispose(); }
    for (const n of this.noises) { n.noise.dispose(); n.pan.dispose(); }
    if (this.sub) { unlink(this.sub); this.sub.dispose(); }
    this.voices1 = [];
    this.voices2 = [];
    this.noises = [];
    this.sub = null;
    this.count = 0;
  }

  // 重ねた音を左右に振り分ける（OSC2 は OSC1 と左右を逆にして、同じ高さの音が同じ側に寄らないようにする）
  private applyPan(ramp: number): void {
    const w = this.p.width / 100;
    const to = (pan: Tone.Panner, v: number) => ramp === 0 ? (pan.pan.value = v) : pan.pan.rampTo(v, ramp);
    this.voices1.forEach(v => to(v.pan, v.pos * w));
    this.voices2.forEach(v => to(v.pan, -v.pos * w));
    this.noises.forEach((n, i) => to(n.pan, (i === 0 ? -1 : 1) * w));
  }

  // 各オシレーターの高さ（ユニゾンのずれ・OSC2 のオクターブとずれ・レイヤーのオクターブを含む）
  private targets(): [Tone.Signal<"frequency">, number][] {
    const base   = this.freq * Math.pow(2, this.p.octave);
    const half   = unisonSpreadCents(this.p.unison, this.p.spread) / 2;
    const f2     = base * Math.pow(2, this.p.osc2Octave) * cents(detuneCents(this.p.osc2Detune));
    const list: [Tone.Signal<"frequency">, number][] = [
      ...this.voices1.map(v => [v.osc.frequency, base * cents(v.pos * half)] as [Tone.Signal<"frequency">, number]),
      ...this.voices2.map(v => [v.osc.frequency, f2 * cents(v.pos * half)] as [Tone.Signal<"frequency">, number]),
    ];
    if (this.sub) list.push([this.sub.frequency, base / 2]);
    return list;
  }

  // 今の高さを当て直す（音作りの値が変わったとき。鳴っている音にもすぐ当てる）
  private applyPitch(time: number, ramp: number): void {
    for (const [sig, value] of this.targets()) {
      if (ramp > 0) sig.rampTo(value, ramp, time);
      else sig.setValueAtTime(value, time);
    }
  }

  // 音の高さを決める（glide 秒かけて滑らせる。0 ならすぐ）
  setPitch(f: number, time: number, glide: number): void {
    this.freq = f;
    for (const [sig, value] of this.targets()) {
      sig.cancelScheduledValues(time);
      if (glide > 0) {
        sig.setValueAtTime(sig.getValueAtTime(time), time);
        sig.exponentialRampToValueAtTime(value, time + glide);
      } else {
        sig.setValueAtTime(value, time);
      }
    }
  }

  // 値を当てる（鳴らしている途中でも変えられる。active でなければ音源を止める）
  set(params: ToniqLayerParams, g: ToniqSynthParams, active: boolean, ramp: number): void {
    const prev = this.p;
    this.p = { ...params };
    const p = this.p;
    const to = (param: Tone.Param<any> | Tone.Signal<any>, v: number) =>
      ramp === 0 ? (param.value = v) : param.rampTo(v, ramp);

    const count = active ? unisonCount(p.unison) : 0;
    if (count !== this.count) {
      this.rebuildSources(count);
    } else if (count > 0) {
      this.voices1.forEach(v => { if (v.osc.type !== p.osc1Wave) v.osc.type = p.osc1Wave; });
      this.voices2.forEach(v => { if (v.osc.type !== p.osc2Wave) v.osc.type = p.osc2Wave; });
      if (p.width !== prev.width) this.applyPan(ramp);
      const pitchChanged = (["octave", "osc2Octave", "osc2Detune", "spread"] as const).some(k => p[k] !== prev[k]);
      if (pitchChanged) this.applyPitch(Tone.now(), ramp || 0.001);
    }

    // 左右に振り分けると片側あたりの音量が下がる（真ん中で -3dB）ので、そのぶん持ち上げる
    to(this.g1.gain, levelGain(p.osc1Level) * Math.SQRT2);
    to(this.g2.gain, levelGain(p.osc2Level) * Math.SQRT2);
    to(this.gSub.gain, levelGain(p.subLevel) * 0.9);
    to(this.gNoise.gain, levelGain(p.noiseLevel) * 0.5);
    to(this.output.gain, active ? Math.pow(p.volume / LAYER_VOLUME_REF, 2) : 0);

    // フィルター
    if (this.filter.type !== p.filterType) this.filter.type = p.filterType;
    const base = cutoffHz(p.cutoff);
    this.filterEnv.baseFrequency = base;
    this.filterEnv.octaves = (p.envAmount / 100) * 6;
    this.filterEnv.attack  = toSeconds(p.fAttack);
    this.filterEnv.decay   = toSeconds(p.fDecay);
    this.filterEnv.sustain = p.fSustain / 100;
    this.filterEnv.release = toSeconds(p.fRelease);
    to(this.filter.Q, resonanceQ(p.resonance));
    // フィルターの LFO（行き先がフィルターのときだけ、カットオフに合わせた幅で揺らす）
    this.lfoFilter.frequency.value = lfoHz(g.lfoRate);
    const swing = g.lfoTarget === "filter" ? base * (g.lfoDepth / 100) * 0.9 : 0;
    this.lfoFilter.min = -swing;
    this.lfoFilter.max = swing;

    // アンプ
    this.amp.attack  = toSeconds(p.attack);
    this.amp.decay   = toSeconds(p.decay);
    this.amp.sustain = p.sustain / 100;
    this.amp.release = toSeconds(p.release);
  }

  trigger(dur: number, time: number, velocity: number): void {
    this.amp.triggerAttackRelease(dur, time, velocity);
    this.filterEnv.triggerAttackRelease(dur, time);
  }

  dispose(): void {
    this.disposeSources();
    this.nodes.forEach(n => n.dispose());
  }
}

export class ToniqVoice {
  readonly output: Tone.Gain;

  private layers: ToniqLayer[];
  private bus:    Tone.Gain;   // レイヤーを足す所
  private lfoPitch: Tone.LFO;
  private lfoAmp:  Tone.LFO;
  private ampMod:  Tone.Gain;  // 音量の LFO で揺らすゲイン
  private drive:  Tone.Distortion;
  private chorus: Tone.Chorus;
  private delay:  Tone.FeedbackDelay;
  private nodes:  Tone.ToneAudioNode[];

  private p: ToniqSynthParams;
  private lastFreq: number | null = null;
  private lastEnd = -Infinity;

  constructor(params: ToniqSynthParams) {
    this.p = cloneToniqSynth(params);

    // 音の高さの LFO は各オシレーターの detune（セント）へ（両方のレイヤーで共通）
    this.lfoPitch = new Tone.LFO({ frequency: 5, min: 0, max: 0 }).start();
    this.bus      = new Tone.Gain(1);
    this.ampMod   = new Tone.Gain(1);
    this.lfoAmp   = new Tone.LFO({ frequency: 5, min: 1, max: 1 }).start();
    this.lfoAmp.connect(this.ampMod.gain);
    this.drive    = new Tone.Distortion({ distortion: 0, oversample: "2x", wet: 0 });
    this.chorus   = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.6, wet: 0 }).start();
    this.delay    = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.3, wet: 0 });
    this.output   = new Tone.Gain(0);
    this.bus.chain(this.ampMod, this.drive, this.chorus, this.delay, this.output);

    this.layers = params.layers.map(lp => {
      const layer = new ToniqLayer(lp, this.lfoPitch);
      layer.output.connect(this.bus);
      return layer;
    });

    this.nodes = [
      this.lfoPitch, this.bus, this.lfoAmp, this.ampMod, this.drive, this.chorus, this.delay, this.output,
    ];

    this.set(params, true);
  }

  connect(dest: Tone.InputNode): this {
    this.output.connect(dest);
    return this;
  }

  // 値を当てる（鳴らしている途中でも変えられる。immediate なら滑らかにせずすぐ変える）
  set(params: ToniqSynthParams, immediate = false): void {
    const p = cloneToniqSynth(params);
    this.p = p;
    const ramp = immediate ? 0 : 0.03;
    const to = (param: Tone.Param<any> | Tone.Signal<any>, v: number) =>
      ramp === 0 ? (param.value = v) : param.rampTo(v, ramp);

    // レイヤー（A は常に鳴らす）
    this.layers.forEach((layer, i) => layer.set(p.layers[i], p, i === 0 || p.layers[i].on, ramp));

    // LFO（行き先以外の LFO は振れ幅 0 にしておく。フィルターの LFO は各レイヤーが持つ）
    const rate  = lfoHz(p.lfoRate);
    const depth = p.lfoDepth / 100;
    this.lfoPitch.frequency.value = rate;
    this.lfoAmp.frequency.value   = rate;
    const c = p.lfoTarget === "pitch" ? depth * 100 : 0;  // 最大 ±1半音
    this.lfoPitch.min = -c;
    this.lfoPitch.max = c;
    // 音量の LFO は 1 〜 1-深さ の間で揺らす（行き先でなければ 1 のまま）
    this.lfoAmp.min = p.lfoTarget === "amp" ? 1 - depth : 1;
    this.lfoAmp.max = 1;

    // エフェクト・出力
    this.drive.distortion = (p.drive / 100) * 0.8;
    to(this.drive.wet, p.drive / 100);
    to(this.chorus.wet, (p.chorus / 100) * 0.6);
    to(this.delay.wet, (p.delay / 100) * 0.45);
    to(this.delay.feedback, 0.2 + (p.delay / 100) * 0.25);
    to(this.output.gain, OUTPUT_GAIN * Math.pow(p.level / 70, 2));
  }

  // ほかのメロディの Synth と同じ呼び方で鳴らす
  triggerAttackRelease(note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 1): this {
    const t   = time === undefined ? Tone.now() : Tone.Time(time).toSeconds();
    const dur = Tone.Time(duration).toSeconds();
    const f   = Tone.Frequency(note).toFrequency();
    // 前の音から休まずに続くときだけ滑らせる（休符のあとは新しい高さから始める）
    const legato = this.lastFreq !== null && t <= this.lastEnd + 0.02;
    const glide  = legato ? glideSeconds(this.p.glide) : 0;
    this.lastFreq = f;
    this.lastEnd  = t + dur;

    for (const layer of this.layers) {
      layer.setPitch(f, t, glide);
      layer.trigger(dur, t, velocity);
    }
    return this;
  }

  dispose(): void {
    this.layers.forEach(l => l.dispose());
    this.nodes.forEach(n => n.dispose());
  }
}
