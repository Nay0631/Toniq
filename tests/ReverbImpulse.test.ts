import { describe, it, expect } from "vitest";
import { CUT_DB, impulseData, impulseSeconds } from "../src/engine/ReverbImpulse";
import mixPresets from "../src/data/mix_presets.json";

const SR = 44100;
// 全ジャンルの設定と、FX 用のロングリバーブ（MixerEngine.ts の LONG_REVERB）
const SETTINGS: [string, number, number][] = [
  ["ロングリバーブ", 5.5, 0.04],
  ...Object.entries(mixPresets).map(([genre, p]) =>
    [genre, p.reverb.decay, (p.reverb as { preDelay?: number }).preDelay ?? 0.02] as [string, number, number]),
];

const rmsDb = (data: Float32Array, from: number, to: number): number => {
  let sum = 0, n = 0;
  for (let i = Math.floor(from * SR); i < Math.min(data.length, Math.floor(to * SR)); i++) { sum += data[i] ** 2; n++; }
  return 10 * Math.log10(sum / Math.max(1, n) + 1e-20);
};

describe("リバーブの響き（ReverbImpulse）", () => {
  it.each(SETTINGS)("%s（decay %f・preDelay %f）：響き始めるまで無音、Tone.Reverb と同じ速さで減り、聞こえない所で切る", (_name, decay, preDelay) => {
    const { channels } = impulseData(decay, preDelay, SR);
    expect(channels).toHaveLength(2);
    const [left, right] = channels;
    expect(left.length).toBe(right.length);
    expect(left.slice(0, Math.round(preDelay * SR)).every(v => v === 0)).toBe(true);
    expect(left.every(v => Math.abs(v) <= 1)).toBe(true);

    // 減り方：時定数 ln(decay + 1) / ln(200) 秒（Tone.js の exponentialApproachValueAtTime）
    const tc   = Math.log(decay + 1) / Math.log(200);
    const span = Math.min(decay, tc * 4);
    const drop = rmsDb(left, preDelay, preDelay + tc * 0.5) - rmsDb(left, preDelay + span * 0.5, preDelay + span * 0.5 + tc * 0.5);
    expect(drop).toBeCloseTo((20 * Math.log10(Math.E) * span * 0.5) / tc, -0.5);

    // 切った所は十分小さい（切る設定なら −80dB のあたり、短い響きは最後まで持つ）
    expect(left.length / SR).toBeLessThanOrEqual(decay + preDelay + 1 / SR);
    expect(left.length / SR).toBeCloseTo(impulseSeconds(decay, preDelay), 2);
    if (left.length / SR < decay + preDelay - 0.05) {
      const head = rmsDb(left, preDelay, preDelay + 0.02);
      const tail = rmsDb(left, left.length / SR - 0.04, left.length / SR - 0.02);
      expect(tail - head).toBeLessThan(CUT_DB + 6);
    }
  });

  it("左右は別のノイズ、作るたびに同じ", () => {
    const a = impulseData(2, 0.02, SR), b = impulseData(2, 0.02, SR);
    expect(a.channels[0]).toEqual(b.channels[0]);
    let same = 0;
    for (let i = 1000; i < 2000; i++) if (a.channels[0][i] === a.channels[1][i]) same++;
    expect(same).toBeLessThan(5);
  });

  it("切ったぶん上がる平均の大きさを gain で戻す（切らなければ 1）", () => {
    // ConvolverNode は「データ全体の平均の大きさ」で音量をそろえる。合計の大きさ ÷ 平均 × gain が、切らないときと同じになる
    const { channels, gain } = impulseData(5.5, 0.04, SR);
    const full = Math.floor(5.54 * SR);
    expect(gain).toBeCloseTo(Math.sqrt(full / channels[0].length), 6);
    expect(gain).toBeGreaterThan(1.2);
    expect(impulseData(0.5, 0.01, SR).gain).toBeCloseTo(1, 3);
  });
});
