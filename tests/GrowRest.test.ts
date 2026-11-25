import { describe, it, expect } from "vitest";
import { Grow, SR, difference, peak } from "./growWasm";

// grow のエフェクトの「休み」（Git に入れた public/grow/grow.wasm をそのまま鳴らす）：
// ボイスが止まり、出力も無音のまま続いたら、エフェクトの計算を止める（grow/core/GrowFx.cpp の updateRest / rest / wake）。
// 余韻・ディレイのくり返しを途中で切らないことと、再開した音が止めなかったときと変わらないことを確かめる
// 余韻が短く、毎回同じ波形になる音（ユニゾン・ドリフトなし）。エフェクトは使うものだけ足す
const DRY = { reverb_mix: 0, aenv_attack: 0.001, aenv_decay: 0.05, aenv_sustain: 0.5, aenv_release: 0.03 };
const D2 = 5;  // delay_time の選択肢：1/2（2拍）

describe("grow のエフェクトの休み", () => {
  it("余韻が聞こえなくなると休みに入り、出力が完全な 0 になる", () => {
    const g = new Grow({ ...DRY, chorus_mix: 0.4, delay_mix: 0.3, reverb_mix: 0.3, reverb_size: 0.8, fx_drive: 0.3, dist_mix: 0.5, comp_mix: 1 });
    const x = g.blip(14);
    expect(peak(x, 0, 1)).toBeGreaterThan(0.01);
    // 止めずに計算していると、リバーブ（60dB 下がるまで 4.6 秒）の響きがまだ極小の値で残っている
    expect(peak(x, 13.5, 14)).toBe(0);
  });

  it("休みに入るとき、聞こえる余韻を切らない", () => {
    const g = new Grow({ ...DRY, reverb_mix: 0.5, reverb_size: 0.8 });
    const x = g.blip(14);
    let last = x.length - 1;
    while (x[last] === 0) last--;  // 音が出ていた最後のサンプル
    expect(last / SR).toBeLessThan(13);
    expect(peak(x, last / SR - 0.1, last / SR)).toBeLessThan(1e-6);  // -120 dB
  });

  it("ディレイのくり返しの間の静かな所で止めない（左右に跳ねる・跳ねない）", () => {
    for (const pingpong of [0, 1]) {
      const g = new Grow({ ...DRY, delay_mix: 0.5, delay_time: D2, delay_feedback: 0.5, delay_pingpong: pingpong }, 60);  // 2秒ごと
      const x = g.blip(9);
      // 左に返るくり返し：跳ねないなら毎回、跳ねるなら1つおき
      const echoes = pingpong ? [2, 6] : [2, 4, 6, 8];
      echoes.forEach(t => expect(peak(x, t, t + 0.2), `pingpong ${pingpong}・${t} 秒のくり返し`).toBeGreaterThan(1e-4));
      expect(peak(x, 1, 1.9)).toBeLessThan(1e-4);  // くり返しの間は静か
    }
  });

  it("休みのあとに鳴らした音は、休む前に鳴らした音と同じ", () => {
    const values = { ...DRY, dist_mix: 0.5, comp_mix: 1, comp_threshold: -30, fx_drive: 0.2 };
    const g = new Grow(values);
    g.render(0.05);             // マスターが立ち上がるまで（まだ休みに入らない）
    const first = g.blip(0.4);
    expect(peak(g.render(6), 5, 6)).toBe(0);
    const again = g.blip(0.4);
    expect(difference(first.subarray(SR * 0.001), again.subarray(SR * 0.001))).toBeLessThan(-40);
  });

  it("休みの間に替えたつまみの値は、次の音の頭から当たる（滑らせない）", () => {
    // マスターを大きく下げ、ディレイを 0 から上げてから鳴らす
    const g = new Grow({ ...DRY, master: 0, delay_time: 0 }, 240);  // ディレイは 1/16 = 0.0625 秒
    g.blip(5);
    g.set({ master: -24, delay_mix: 0.5 });
    const changed = g.blip(0.3);
    // くり返しが返ってくる前は、ディレイのない音と同じはず（長さが 0 から伸びると、早く返ってきてしまう）
    const dry = new Grow({ ...DRY, master: -24 });
    dry.render(0.05);
    const until = Math.round(0.061 * SR);
    expect(difference(dry.blip(0.3).subarray(0, until), changed.subarray(0, until))).toBeLessThan(-40);
  });

  it("休みの間に BPM を下げても、前に鳴らした音のくり返しが出てこない", () => {
    const values = { ...DRY, delay_mix: 0.5, delay_time: D2, delay_feedback: 0 };
    const g = new Grow(values, 240);  // 0.5 秒
    g.blip(4.5);                      // 休みに入って、ディレイの線の長さ（4秒）だけ待つ
    g.ex.grow_set_bpm(30);            // 4 秒
    const x = g.blip(3);
    expect(peak(x, 0.5, 3)).toBeLessThan(1e-5);
  });

  it("鳴らしながらエフェクトの量を 0 から上げても、段差にならない", () => {
    const g = new Grow({ ...DRY, aenv_sustain: 1, osc1_wave: 0, filter_cutoff: 20000 });
    g.ex.grow_note_on(45, 0.9);                 // 110 Hz
    const before = g.render(1 + 0.25 / 110);    // 波の山で切り替える
    g.set({ chorus_mix: 1 });
    const after = g.render(0.002);
    const top = peak(before, 0.5);
    expect(Math.abs(before[before.length - 1])).toBeGreaterThan(0.8 * top);
    // 量が一気に変わると、空のディレイの音（0）へ跳ぶ
    expect(Math.abs(after[0] - before[before.length - 1])).toBeLessThan(0.05 * top);
  });
});
