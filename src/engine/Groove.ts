import * as Tone from "tone";
import mixPresets from "../data/mix_presets.json";
import { getState } from "./AppState";
import { duckGains } from "./VolumeManager";

// グルーヴ：スウィング（裏の16分音符を後ろへずらす）とサイドチェイン（キックに合わせて他のパートを沈める）。
// 量は AppState.swing / sidechain（0〜100。null = ジャンルの標準 mix_presets.json の swing / sidechain）

const presets = mixPresets as Record<string, { swing?: number; sidechain?: number }>;

function genreDefault(key: "swing" | "sidechain", genre: string): number {
  return presets[genre]?.[key] ?? presets["ローファイ"]?.[key] ?? 0;
}

// 今の曲で使う量（0〜100）
export function swingAmount(): number {
  const s = getState();
  return s.swing ?? genreDefault("swing", s.genre);
}

export function sidechainAmount(): number {
  const s = getState();
  return s.sidechain ?? genreDefault("sidechain", s.genre);
}

export function genreSwing(genre: string): number     { return genreDefault("swing", genre); }
export function genreSidechain(genre: string): number { return genreDefault("sidechain", genre); }

// ===== スウィング =====

// 100 のときの Tone.js の swing の値。Tone.js は 1 で「16分音符の半分」ずれる（付点のようにかなり跳ねる）ので、
// 100 で3連符に近いシャッフル（約 0.67）になるようにする
const SWING_MAX = 0.67;

// 現在のコンテキストの Transport に当てる（再生・試聴・WAV書き出しの開始時と、量を変えたとき）。
// 判定は Transport の16分音符の裏拍なので、各パートの Part / Sequence のイベントがまとめてずれる
export function applySwing(): void {
  const transport = Tone.getTransport();
  transport.swingSubdivision = "16n";
  transport.swing = (swingAmount() / 100) * SWING_MAX;
}

// ===== サイドチェイン =====

// パートごとの沈め方（1 = 量どおり）。低音とパッドを一番深く、メロディ・ドラム・FX は沈めない
const SIDECHAIN_PARTS: Record<string, number> = {
  bass:      1,
  pad:       1,
  chord:     0.8,
  arp:       0.6,
  signature: 0.6,
};

const DUCK_MAX    = 0.8;    // 100 のときに下げる割合（0.8 = 音量 0.2 倍 ≒ −14dB）
const DUCK_ATTACK = 0.004;  // 沈むまで（秒）。短いとプチッとなるので数ms

// キックが鳴った時刻に呼ぶ（DrumEngine）。各パートの Volume の後ろのゲインを一瞬下げ、拍の6割ほどで戻す
export function sidechainHit(time: number, velocity = 1): void {
  const amount = sidechainAmount() / 100;
  if (amount <= 0) return;
  const gains   = duckGains();
  const release = (60 / Tone.getTransport().bpm.value) * 0.6;

  for (const [part, weight] of Object.entries(SIDECHAIN_PARTS)) {
    const gain = gains[part];
    if (!gain) continue;
    const low = 1 - DUCK_MAX * amount * weight * Math.min(1, velocity);
    gain.gain.cancelAndHoldAtTime(time);
    gain.gain.linearRampToValueAtTime(low, time + DUCK_ATTACK);
    gain.gain.linearRampToValueAtTime(1, time + DUCK_ATTACK + release);
  }
}
