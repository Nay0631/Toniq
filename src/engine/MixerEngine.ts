import * as Tone from "tone";
import mixPresets from "../data/mix_presets.json";

interface MixPreset {
  reverb:     { decay: number; wet: number };  // wet = リバーブ送りの全体量
  eq:         { low: number; mid: number; high: number };
  compressor: { threshold: number; ratio: number; attack: number; release: number };
  limiter:    { threshold: number };
  gain:       number;  // コンプ後の持ち上げ（dB）。コンプで下がった音量を戻す
}

// パートごとのリバーブ送りの量（0〜1）。低音は響かせるとぼやけるので送らない
const REVERB_SENDS: Record<string, number> = {
  drum:   0.15,
  chord:  0.5,
  bass:   0,
  arp:    0.6,
  pad:    0.8,
  signature: 0.4,
  melody: 0.5,
  fx:     0.7,
};

// ロングリバーブ：FX / SE だけを送る長い響き（ライザーやインパクトの余韻を後ろに大きく残す）
// ジャンルのリバーブ（短め・薄め）とは別に持ち、ジャンルによらず同じ響きにする
const LONG_REVERB = { decay: 5.5, preDelay: 0.04, wet: 0.55 };  // wet = 戻りの量
const LONG_REVERB_SENDS: Record<string, number> = {
  fx: 0.8,
};

// マスター：入口 → EQ → コンプ → 持ち上げ → リミッター → スピーカー
// リバーブ：送り → 低域カット → リバーブ → 戻り → マスター入口
interface Mixer {
  input:      Tone.Gain;
  eq:         Tone.EQ3;
  compressor: Tone.Compressor;
  makeup:     Tone.Gain<"decibels">;
  limiter:    Tone.Limiter;
  reverbIn:   Tone.Filter;
  reverb:     Tone.Reverb;
  reverbOut:  Tone.Gain;
  longIn:     Tone.Filter;  // ロングリバーブの送り先（低域カット）
  longReverb: Tone.Reverb;
}

// オーディオコンテキストごとに1つ持つ（WAV書き出しの Tone.Offline は別コンテキスト）
// 各パートの Volume ノードはコンテキストごとに使い回すので、ミキサーも作り直さない
const mixers = new WeakMap<Tone.BaseContext, Mixer>();

function getMixer(): Mixer {
  const ctx = Tone.getContext();
  const existing = mixers.get(ctx);
  if (existing) return existing;

  const limiter    = new Tone.Limiter(-1).toDestination();
  const makeup     = new Tone.Gain(0, "decibels").connect(limiter);
  const compressor = new Tone.Compressor().connect(makeup);
  const eq         = new Tone.EQ3().connect(compressor);
  const input      = new Tone.Gain(1).connect(eq);

  const reverbOut = new Tone.Gain(0).connect(input);
  const reverb    = new Tone.Reverb({ decay: 1.5, preDelay: 0.02, wet: 1 }).connect(reverbOut);
  const reverbIn  = new Tone.Filter({ type: "highpass", frequency: 250 }).connect(reverb);

  // ロングリバーブ：送り → 低域カット → リバーブ → 戻り → マスター入口
  const longOut    = new Tone.Gain(LONG_REVERB.wet).connect(input);
  const longReverb = new Tone.Reverb({ decay: LONG_REVERB.decay, preDelay: LONG_REVERB.preDelay, wet: 1 }).connect(longOut);
  const longIn     = new Tone.Filter({ type: "highpass", frequency: 350 }).connect(longReverb);

  const mixer = { input, eq, compressor, makeup, limiter, reverbIn, reverb, reverbOut, longIn, longReverb };
  mixers.set(ctx, mixer);
  console.log("Mixer初期化完了");
  return mixer;
}

// パートの出口をマスターにつなぎ、リバーブ送りも作る（VolumeManager から呼ぶ）
export function connectToMixer(node: Tone.ToneAudioNode, part: string): void {
  const mixer = getMixer();
  node.connect(mixer.input);
  const amount = REVERB_SENDS[part] ?? 0;
  if (amount > 0) node.connect(new Tone.Gain(amount).connect(mixer.reverbIn));
  const long = LONG_REVERB_SENDS[part] ?? 0;
  if (long > 0) node.connect(new Tone.Gain(long).connect(mixer.longIn));
}

// 現在のコンテキストのミキサーにジャンルの設定を当てる
export function applyMixPreset(genre: string) {
  const presets = mixPresets as Record<string, MixPreset>;
  const preset  = presets[genre] ?? presets["ローファイ"];
  const mixer   = getMixer();

  // decay を変えると響きのデータを作り直すので、変わったときだけ設定する
  if (mixer.reverb.decay !== preset.reverb.decay) mixer.reverb.decay = preset.reverb.decay;
  mixer.reverbOut.gain.value = preset.reverb.wet;

  mixer.eq.low.value  = preset.eq.low;
  mixer.eq.mid.value  = preset.eq.mid;
  mixer.eq.high.value = preset.eq.high;

  mixer.compressor.threshold.value = preset.compressor.threshold;
  mixer.compressor.ratio.value     = preset.compressor.ratio;
  mixer.compressor.attack.value    = preset.compressor.attack;
  mixer.compressor.release.value   = preset.compressor.release;

  mixer.makeup.gain.value       = preset.gain;
  mixer.limiter.threshold.value = preset.limiter.threshold;

  console.log(`ミックスプリセット適用: ${genre}`, preset);
}

// リバーブの響きのデータができるまで待つ（WAV書き出しで曲の頭から響かせるため）
export async function mixerReady(): Promise<void> {
  const mixer = getMixer();
  await Promise.all([mixer.reverb.ready, mixer.longReverb.ready]);
}
