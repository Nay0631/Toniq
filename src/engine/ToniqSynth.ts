import * as Tone from "tone";

// Toniq シンセ（テスト中）：Toniq 専用の単音シンセサイザー。メロディの音色「Toniq シンセ」で鳴らす。
// 音の流れ：OSC1・OSC2・サブ・ノイズ → ミックス → フィルター（エンベロープ・LFO で動かす）→ アンプ（ADSR）
//          → 音量の LFO → ドライブ → コーラス → ディレイ → 出力
// 後ろの響き（リバーブ）は自前で持たず、マスターのリバーブ送りで付ける。
// 音作りの値は AppState.toniqSynth（曲に保存する）に置き、ノブの値はすべて 0〜100（波形などは選択肢）。
// 実際の単位（Hz・秒など）への変換はここの関数で行う

export type ToniqWave = "sawtooth" | "square" | "triangle" | "sine";
export type ToniqFilterType = "lowpass" | "highpass" | "bandpass";
export type ToniqLfoTarget = "off" | "pitch" | "filter" | "amp";

export interface ToniqSynthParams {
  // オシレーター
  osc1Wave:   ToniqWave;
  osc1Level:  number;
  osc2Wave:   ToniqWave;
  osc2Level:  number;
  osc2Octave: number;  // -2〜+2（オクターブ）
  osc2Detune: number;  // 0〜100（50 = ずらさない。±50 セント）
  subLevel:   number;  // 1オクターブ下のサイン波
  noiseLevel: number;
  unison:     number;  // 0〜100（重ねる枚数 1〜7）
  spread:     number;  // 重ねた音のずれ幅
  glide:      number;  // 音のつながりを滑らせる時間
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

export type ToniqKnobKey = { [K in keyof ToniqSynthParams]: ToniqSynthParams[K] extends number ? K : never }[keyof ToniqSynthParams];

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
    case "glide":     return v === 0 ? "OFF" : sec(glideSeconds(v));
    case "osc2Octave": return `${v > 0 ? "+" : ""}${v}`;
    default:          return `${Math.round(v)}`;
  }
}

// ===== プリセット =====

export const DEFAULT_TONIQ_SYNTH: ToniqSynthParams = {
  osc1Wave: "sawtooth", osc1Level: 80,
  osc2Wave: "square",   osc2Level: 45, osc2Octave: 0, osc2Detune: 56,
  subLevel: 25, noiseLevel: 0,
  unison: 17, spread: 30, glide: 20,
  filterType: "lowpass", cutoff: 52, resonance: 25, envAmount: 40,
  fAttack: 5, fDecay: 62, fSustain: 40, fRelease: 59,
  attack: 10, decay: 62, sustain: 70, release: 59,
  lfoTarget: "pitch", lfoRate: 76, lfoDepth: 12,
  drive: 0, chorus: 20, delay: 20, level: 70,
};

export interface ToniqPreset {
  id:     string;
  label:  string;
  params: ToniqSynthParams;
}

const preset = (id: string, label: string, p: Partial<ToniqSynthParams>): ToniqPreset =>
  ({ id, label, params: { ...DEFAULT_TONIQ_SYNTH, ...p } });

export const TONIQ_PRESETS: ToniqPreset[] = [
  preset("standard", "スタンダードリード", {}),
  preset("wide", "ワイドリード", {
    osc1Wave: "sawtooth", osc2Wave: "sawtooth", osc2Level: 60, osc2Detune: 58,
    unison: 67, spread: 60, cutoff: 62, envAmount: 30, chorus: 45, delay: 30, level: 62,
  }),
  preset("glass", "ガラスベル", {
    osc1Wave: "sine", osc1Level: 80, osc2Wave: "triangle", osc2Level: 40, osc2Octave: 2, osc2Detune: 50,
    subLevel: 0, unison: 0, spread: 0, glide: 0,
    cutoff: 80, resonance: 10, envAmount: 20, fAttack: 0, fDecay: 70, fSustain: 30,
    attack: 0, decay: 80, sustain: 15, release: 78,
    lfoTarget: "off", chorus: 25, delay: 40, level: 86,
  }),
  preset("chip", "チップチューン", {
    osc1Wave: "square", osc1Level: 75, osc2Wave: "square", osc2Level: 25, osc2Octave: 1, osc2Detune: 50,
    subLevel: 0, unison: 0, spread: 0, glide: 0,
    cutoff: 100, resonance: 0, envAmount: 0,
    attack: 0, decay: 40, sustain: 65, release: 20,
    lfoTarget: "pitch", lfoRate: 80, lfoDepth: 18, chorus: 0, delay: 15, level: 74,
  }),
  preset("wah", "ワウリード", {
    osc1Wave: "sawtooth", osc2Wave: "sawtooth", osc2Level: 50, osc2Detune: 54,
    cutoff: 42, resonance: 55, envAmount: 15,
    lfoTarget: "filter", lfoRate: 50, lfoDepth: 60, chorus: 15, delay: 25, level: 58,
  }),
  preset("soft", "ソフトパッド", {
    osc1Wave: "triangle", osc1Level: 75, osc2Wave: "sine", osc2Level: 50, osc2Octave: 1, osc2Detune: 53,
    subLevel: 15, noiseLevel: 4, unison: 33, spread: 35, glide: 20,
    cutoff: 50, resonance: 8, envAmount: 15, fAttack: 60, fDecay: 70, fSustain: 60, fRelease: 75,
    attack: 62, decay: 70, sustain: 80, release: 78,
    lfoTarget: "amp", lfoRate: 30, lfoDepth: 20, chorus: 55, delay: 25, level: 62,
  }),
  preset("acid", "アシッド", {
    osc1Wave: "sawtooth", osc1Level: 90, osc2Wave: "square", osc2Level: 0,
    subLevel: 10, unison: 0, spread: 0, glide: 30,
    cutoff: 25, resonance: 78, envAmount: 62, fAttack: 0, fDecay: 58, fSustain: 15, fRelease: 40,
    attack: 0, decay: 62, sustain: 60, release: 40,
    lfoTarget: "off", drive: 40, chorus: 0, delay: 30, level: 62,
  }),
];

// 今の値と一致するプリセット（なければ null = 手で作った音）
export function matchingPreset(p: ToniqSynthParams): ToniqPreset | null {
  const keys = Object.keys(DEFAULT_TONIQ_SYNTH) as (keyof ToniqSynthParams)[];
  return TONIQ_PRESETS.find(pr => keys.every(k => pr.params[k] === p[k])) ?? null;
}

// 保存した曲などで足りない項目を初期値で補う
export function normalizeToniqSynth(p: Partial<ToniqSynthParams> | null | undefined): ToniqSynthParams {
  return { ...DEFAULT_TONIQ_SYNTH, ...(p ?? {}) };
}

// ===== 音源 =====

// 出力の大きさ（level 70 で、ほかのメロディの音色と同じくらいになる）
const OUTPUT_GAIN = 0.22;

export class ToniqVoice {
  readonly output: Tone.Gain;

  private osc1:   Tone.FatOscillator;
  private osc2:   Tone.FatOscillator;
  private sub:    Tone.Oscillator;
  private noise:  Tone.Noise;
  private g1:     Tone.Gain;
  private g2:     Tone.Gain;
  private gSub:   Tone.Gain;
  private gNoise: Tone.Gain;
  private filter: Tone.Filter;
  private filterEnv: Tone.FrequencyEnvelope;
  private amp:    Tone.AmplitudeEnvelope;
  private lfoPitch:  Tone.LFO;
  private lfoFilter: Tone.LFO;
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
    this.p = { ...params };

    this.osc1  = new Tone.FatOscillator({ type: params.osc1Wave, count: 1, spread: 0 });
    this.osc2  = new Tone.FatOscillator({ type: params.osc2Wave, count: 1, spread: 0 });
    this.sub   = new Tone.Oscillator({ type: "sine" });
    this.noise = new Tone.Noise("white");
    this.g1 = new Tone.Gain(0);
    this.g2 = new Tone.Gain(0);
    this.gSub = new Tone.Gain(0);
    this.gNoise = new Tone.Gain(0);

    this.filter    = new Tone.Filter({ type: params.filterType, rolloff: -24 });
    this.filterEnv = new Tone.FrequencyEnvelope({ baseFrequency: 1000, octaves: 0, exponent: 2 });
    this.amp       = new Tone.AmplitudeEnvelope();
    this.ampMod    = new Tone.Gain(1);
    this.lfoAmp    = new Tone.LFO({ frequency: 5, min: 1, max: 1 }).start();
    this.lfoAmp.connect(this.ampMod.gain);
    this.drive     = new Tone.Distortion({ distortion: 0, oversample: "2x", wet: 0 });
    this.chorus    = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.6, wet: 0 }).start();
    this.delay     = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.3, wet: 0 });
    this.output    = new Tone.Gain(0);

    this.osc1.connect(this.g1);
    this.osc2.connect(this.g2);
    this.sub.connect(this.gSub);
    this.noise.connect(this.gNoise);
    [this.g1, this.g2, this.gSub, this.gNoise].forEach(g => g.connect(this.filter));
    this.filter.chain(this.amp, this.ampMod, this.drive, this.chorus, this.delay, this.output);

    // フィルターの周波数はエンベロープ＋LFO で決まる（つないだ信号の和になる）
    this.filterEnv.connect(this.filter.frequency);
    this.lfoFilter = new Tone.LFO({ frequency: 5, min: 0, max: 0 }).start();
    this.lfoFilter.connect(this.filter.frequency);
    // 音の高さの LFO はオシレーターの detune（セント）へ。細かいずれ（osc2Detune）は周波数の側で付ける
    this.lfoPitch = new Tone.LFO({ frequency: 5, min: 0, max: 0 }).start();
    this.lfoPitch.connect(this.osc1.detune);
    this.lfoPitch.connect(this.osc2.detune);
    this.lfoPitch.connect(this.sub.detune);

    this.nodes = [
      this.osc1, this.osc2, this.sub, this.noise, this.g1, this.g2, this.gSub, this.gNoise,
      this.filter, this.filterEnv, this.amp, this.lfoPitch, this.lfoFilter,
      this.lfoAmp, this.ampMod, this.drive, this.chorus, this.delay, this.output,
    ];

    // オシレーターは鳴らしっぱなしにして、音の出入りはアンプのエンベロープで決める（音の頭のクリックを防ぐ）
    const f = Tone.Frequency("A4").toFrequency();
    this.setPitch(f, Tone.now(), 0);
    this.osc1.start();
    this.osc2.start();
    this.sub.start();
    this.noise.start();

    this.set(params, true);
  }

  connect(dest: Tone.InputNode): this {
    this.output.connect(dest);
    return this;
  }

  // 値を当てる（鳴らしている途中でも変えられる。immediate なら滑らかにせずすぐ変える）
  set(params: ToniqSynthParams, immediate = false): void {
    const p = { ...params };
    const ramp = immediate ? 0 : 0.03;
    const to = (param: Tone.Param<any> | Tone.Signal<any>, v: number) =>
      ramp === 0 ? (param.value = v) : param.rampTo(v, ramp);

    // オシレーター（重ねた枚数に応じた音量の補正は FatOscillator が行う）
    const count = unisonCount(p.unison);
    if (this.osc1.type !== p.osc1Wave) this.osc1.type = p.osc1Wave;
    if (this.osc2.type !== p.osc2Wave) this.osc2.type = p.osc2Wave;
    if (this.osc1.count !== count) { this.osc1.count = count; this.osc2.count = count; }
    // FatOscillator は重ねた音の位相をずらして鳴らすので、高さが同じだと打ち消し合って消える。重ねるときは最低 8 セントずらす
    const spread = count > 1 ? 8 + p.spread * 0.72 : 0;
    this.osc1.spread = spread;
    this.osc2.spread = spread;
    const lv = (v: number) => Math.pow(v / 100, 2);
    to(this.g1.gain, lv(p.osc1Level));
    to(this.g2.gain, lv(p.osc2Level));
    to(this.gSub.gain, lv(p.subLevel) * 0.9);
    to(this.gNoise.gain, lv(p.noiseLevel) * 0.5);

    // osc2 のオクターブ・ずれは鳴っている音の高さにもすぐ当てる
    const pitchChanged = p.osc2Octave !== this.p.osc2Octave || p.osc2Detune !== this.p.osc2Detune;
    this.p = p;
    if (pitchChanged && this.lastFreq !== null) {
      this.osc2.frequency.rampTo(this.osc2Freq(this.lastFreq), ramp || 0.001);
    }

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

    // アンプ
    this.amp.attack  = toSeconds(p.attack);
    this.amp.decay   = toSeconds(p.decay);
    this.amp.sustain = p.sustain / 100;
    this.amp.release = toSeconds(p.release);

    // LFO（行き先以外の LFO は振れ幅 0 にしておく）
    const rate  = lfoHz(p.lfoRate);
    const depth = p.lfoDepth / 100;
    this.lfoPitch.frequency.value  = rate;
    this.lfoFilter.frequency.value = rate;
    this.lfoAmp.frequency.value    = rate;
    const cents = p.lfoTarget === "pitch" ? depth * 100 : 0;  // 最大 ±1半音
    this.lfoPitch.min = -cents;
    this.lfoPitch.max = cents;
    const swing = p.lfoTarget === "filter" ? base * depth * 0.9 : 0;
    this.lfoFilter.min = -swing;
    this.lfoFilter.max = swing;
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

  private osc2Freq(f: number): number {
    return f * Math.pow(2, this.p.osc2Octave) * Math.pow(2, detuneCents(this.p.osc2Detune) / 1200);
  }

  // 音の高さを決める（glide 秒かけて滑らせる。0 ならすぐ）
  private setPitch(f: number, time: number, glide: number): void {
    const targets: [Tone.Signal<"frequency">, number][] = [
      [this.osc1.frequency, f],
      [this.osc2.frequency, this.osc2Freq(f)],
      [this.sub.frequency, f / 2],
    ];
    for (const [sig, value] of targets) {
      sig.cancelScheduledValues(time);
      if (glide > 0) {
        sig.setValueAtTime(sig.getValueAtTime(time), time);
        sig.exponentialRampToValueAtTime(value, time + glide);
      } else {
        sig.setValueAtTime(value, time);
      }
    }
  }

  // ほかのメロディの Synth と同じ呼び方で鳴らす
  triggerAttackRelease(note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 1): this {
    const t   = time === undefined ? Tone.now() : Tone.Time(time).toSeconds();
    const dur = Tone.Time(duration).toSeconds();
    const f   = Tone.Frequency(note).toFrequency();
    // 前の音から休まずに続くときだけ滑らせる（休符のあとは新しい高さから始める）
    const legato = this.lastFreq !== null && t <= this.lastEnd + 0.02;
    this.setPitch(f, t, legato ? glideSeconds(this.p.glide) : 0);
    this.lastFreq = f;
    this.lastEnd  = t + dur;

    this.amp.triggerAttackRelease(dur, t, velocity);
    this.filterEnv.triggerAttackRelease(dur, t);
    return this;
  }

  dispose(): void {
    this.nodes.forEach(n => n.dispose());
  }
}
