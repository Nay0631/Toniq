import * as Tone from "tone";
import mixPresets from "../data/mix_presets.json";

interface MixPreset {
  reverb:     { decay: number; wet: number };
  eq:         { low: number; mid: number; high: number };
  compressor: { threshold: number; ratio: number; attack: number; release: number };
  limiter:    { threshold: number };
}

// マスターエフェクト
let masterReverb:     Tone.Reverb     | null = null;
let masterCompressor: Tone.Compressor | null = null;
let masterLimiter:    Tone.Limiter    | null = null;

export function initMixer() {
  // 既存のDestinationはそのまま維持し
  // マスター処理はDestination手前に挿入する
  masterLimiter    = new Tone.Limiter(-2).toDestination();
  masterCompressor = new Tone.Compressor({
    threshold: -18, ratio: 6, attack: 0.003, release: 0.15
  }).connect(masterLimiter);
  masterReverb     = new Tone.Reverb({ decay: 1.5, wet: 0.2 }).connect(masterCompressor);

  console.log("Mixer初期化完了");
}

export function applyMixPreset(genre: string) {
  const presets = mixPresets as Record<string, MixPreset>;
  const preset  = presets[genre] ?? presets["ローファイ"];

  if (!masterReverb || !masterCompressor || !masterLimiter) {
    console.warn("Mixerが初期化されていません");
    return;
  }

  masterReverb.decay         = preset.reverb.decay;
  masterReverb.wet.value     = preset.reverb.wet;

  masterCompressor.threshold.value = preset.compressor.threshold;
  masterCompressor.ratio.value     = preset.compressor.ratio;
  masterCompressor.attack.value    = preset.compressor.attack;
  masterCompressor.release.value   = preset.compressor.release;

  masterLimiter.threshold.value = preset.limiter.threshold;

  console.log(`ミックスプリセット適用: ${genre}`, preset);
}

export function getMasterReverb(): Tone.Reverb | null {
  return masterReverb;
}

export function disposeMixer() {
  masterReverb?.dispose();
  masterCompressor?.dispose();
  masterLimiter?.dispose();
  masterReverb     = null;
  masterCompressor = null;
  masterLimiter    = null;
}