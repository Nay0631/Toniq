import { describe, it, expect } from "vitest";
import { Grow, SR, concat, difference, maxStep, peak } from "./growWasm";

// grow の音（Git に入れた public/grow/grow.wasm をそのまま鳴らす）：
// ハードシンク・FM の折り返しノイズ、同じ高さの弾き直し、LFO のスムーズ、スロットの開き直し

// 倍音（f0 の整数倍）から外れた成分の、倍音全体に対する大きさ（dB）。折り返しノイズの目安
function aliasing(values: Record<string, number>, note: number): number {
  const g = new Grow({
    filter_type: 0, filter_cutoff: 20000, filter_reso: 0, filter_keytrack: 0,
    aenv_attack: 0.001, aenv_sustain: 1, reverb_mix: 0, ...values,
  });
  g.on(note, 1);
  g.render(0.3);
  const n = 16384, x = g.render(n / SR), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / (n - 1);
    re[i] = x[i] * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t));
  }
  fft(re, im);
  const f0 = 440 * 2 ** ((note - 69) / 12), bin = SR / n;
  let harmonic = 0, alias = 0;
  for (let i = 8; i < n / 2; i++) {
    const hz = i * bin, k = Math.round(hz / f0), power = re[i] ** 2 + im[i] ** 2;
    if (k >= 1 && Math.abs(hz - k * f0) < 6 * bin) harmonic += power;
    else alias += power;
  }
  return 10 * Math.log10(alias / harmonic);
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const a = -2 * Math.PI * k / len, c = Math.cos(a), s = Math.sin(a), p = i + k, q = p + len / 2;
        const br = re[q] * c - im[q] * s, bi = re[q] * s + im[q] * c;
        re[q] = re[p] - br; im[q] = im[p] - bi; re[p] += br; im[p] += bi;
      }
    }
  }
}

describe("折り返しノイズ", () => {
  const SYNC = { osc1_level: 0, osc2_level: 0.8, hard_sync: 1 };
  const SAW  = aliasing({}, 72);  // 普通のノコギリ（PolyBLEP）

  it("ハードシンクは、どの波形でも普通のノコギリと同じくらいに抑える", () => {
    for (const wave of [0, 1, 2, 3]) {
      expect(aliasing({ ...SYNC, osc2_wave: wave, osc2_semi: 7 }, 72), `波形 ${wave}`).toBeLessThan(SAW + 4);
    }
  });

  it("周期が同じハードシンクは、普通のノコギリと同じ音になる", () => {
    expect(Math.abs(aliasing({ ...SYNC, osc2_wave: 2 }, 72) - SAW)).toBeLessThan(0.5);
  });

  it("ハードシンクは、パルス幅を変えても・低い OSC 2 でも抑える", () => {
    expect(aliasing({ ...SYNC, osc2_wave: 3, osc2_pw: 0.2, osc2_semi: 5 }, 72)).toBeLessThan(SAW + 4);
    expect(aliasing({ ...SYNC, osc2_wave: 2, osc2_octave: -1, osc2_semi: 7 }, 72)).toBeLessThan(SAW + 4);
  });

  it("ノコギリ・矩形にサインの FM をかけても抑える（位相が逆に進む深い FM も）", () => {
    for (const [wave, amount] of [[2, 0.15], [3, 0.15], [2, 0.6], [3, 0.6]]) {
      expect(aliasing({ osc1_wave: wave, osc2_wave: 0, osc2_level: 0, fm_amount: amount }, 60), `波形 ${wave}・量 ${amount}`).toBeLessThan(-34);
    }
  });

  it("シンク・FM を鳴らしながら切り替えても、値が飛び抜けない", () => {
    const g = new Grow({ aenv_sustain: 1, reverb_mix: 0, osc2_wave: 0, osc2_level: 0.5, osc1_unison: 3 });
    g.on(60);
    const parts = [g.render(0.1)];
    const steps: Record<string, number>[] = [{ hard_sync: 1 }, { fm_amount: 0.4 }, { osc1_unison: 7 }, { hard_sync: 0 }, { fm_amount: 0 }, { osc2_wave: 2, hard_sync: 1 }];
    for (const v of steps) {
      g.set(v);
      parts.push(g.render(0.1));
    }
    const x = concat(...parts);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeLessThan(0.9);
  });
});

describe("同じ高さの弾き直し", () => {
  const DRY = { reverb_mix: 0, delay_mix: 0, chorus_mix: 0 };
  // 16分音符（120 BPM）で同じ高さを times 回
  const repeat = (g: Grow, times: number) => {
    const parts: Float32Array[] = [];
    for (let i = 0; i < 16; i++) {
      if (i < times) g.on(67);
      parts.push(g.render(0.075));
      g.off(67);
      parts.push(g.render(0.05));
    }
    return concat(...parts);
  };
  const growth = (preset: string, sameNote: number) => {
    const values = { ...DRY, same_note: sameNote };
    return 20 * Math.log10(peak(repeat(new Grow(values, 120, preset), 16)) / peak(repeat(new Grow(values, 120, preset), 1)));
  };

  it("弾き直しなら、連打しても音量が積み上がらない（重ねると積み上がる）", () => {
    expect(growth("music_box", 1)).toBeLessThan(1.5);
    expect(growth("music_box", 0)).toBeGreaterThan(3);
  });

  it("打つ・弾く楽器のプリセットは弾き直しにしている", () => {
    const g = new Grow();
    for (const id of ["keys", "epiano", "lofi_keys", "bell", "music_box", "marimba", "kalimba"]) expect(g.presetValue(id, "same_note"), id).toBe(1);
    for (const id of ["soft_pad", "strings", "supersaw", "init"]) expect(g.presetValue(id, "same_note"), id).toBe(0);
  });

  it("高さの違う音は止めない（和音になる）", () => {
    const values = { ...DRY, same_note: 1, osc1_wave: 0, aenv_sustain: 1, filter_cutoff: 20000 };
    const one = new Grow(values), two = new Grow(values);
    one.on(60);
    two.on(60);
    two.on(67);
    expect(peak(two.render(0.5), 0.2)).toBeGreaterThan(1.5 * peak(one.render(0.5), 0.2));
  });

  it("大きく鳴っている音を弱く弾き直しても、段差にならない", () => {
    const values = { ...DRY, same_note: 1, osc1_wave: 0, filter_cutoff: 20000, velocity: 1, aenv_attack: 0.001, aenv_decay: 2, aenv_sustain: 0.8 };
    const g = new Grow(values);
    g.on(57, 1);                                          // 220 Hz のサイン
    const before = g.render(0.2 + 0.25 / 220);            // 波の山で弾き直す（段差があればいちばん目立つ）
    g.on(57, 0.2);
    const after = g.render(0.1);
    const natural = maxStep(before, 0.1);                 // 弾き直す前の、なめらかな波の1サンプルの変化
    expect(maxStep(concat(before.subarray(-2), after), 0, 0.005)).toBeLessThan(1.5 * natural);
  });

  it("離したあとの弾き直しも、離せば止まる（鳴りっぱなしにならない）", () => {
    const g = new Grow({ ...DRY, same_note: 1, aenv_sustain: 1, aenv_release: 0.5 });
    g.blip(0.2);
    g.on(60);
    g.render(0.2);
    g.off(60);
    expect(peak(g.render(2), 1.5)).toBe(0);
  });
});

describe("LFO のスムーズ", () => {
  // 低いサインを、矩形の LFO で刻む
  const GATE = {
    osc1_wave: 0, filter_cutoff: 20000, aenv_attack: 0.001, aenv_sustain: 1, reverb_mix: 0,
    lfo_wave: 3, lfo_rate: 8, lfo_retrigger: 1, lfo_amp: 1,
  };
  const gate = (values: Record<string, number>) => {
    const g = new Grow({ ...GATE, ...values });
    g.on(45);
    return g.render(1.5);
  };

  it("矩形の LFO で刻んでも、角が段差にならない（刻みの深さは残る）", () => {
    const smooth = gate({ lfo_smooth: 0.002 }), hard = gate({});
    expect(maxStep(hard, 0.2)).toBeGreaterThan(5 * maxStep(smooth, 0.2));
    // 閉じている間（半周期の後ろ）は、ほとんど聞こえない
    const half = 1 / 16;
    expect(peak(smooth, 1 + half * 1.5, 1 + half * 1.9)).toBeLessThan(0.01 * peak(smooth));
  });

  it("0 なら波の形のまま（今までの音と同じ）", () => {
    expect(difference(gate({}), gate({ lfo_smooth: 0 }))).toBe(-Infinity);
  });

  it("LFO 2 も丸められる", () => {
    const values = { lfo_amp: 0, lfo2_wave: 3, lfo2_rate: 8, lfo2_retrigger: 1, mod1_source: 4, mod1_dest: 4, mod1_amount: 0.9 };
    expect(maxStep(gate(values), 0.2)).toBeGreaterThan(5 * maxStep(gate({ ...values, lfo2_smooth: 0.002 }), 0.2));
  });

  it("ゲートパッドは角を丸めている", () => {
    expect(new Grow().presetValue("gate_pad", "lfo_smooth")).toBeGreaterThan(0);
  });
});

describe("スロットの開き直し（ノードの使い回し）", () => {
  it("鳴らしたあとに閉じて開き直した音は、初めて開いた音とサンプル単位で同じ（前の音の響き・メモリの中身が混ざらない）", () => {
    for (const preset of ["trance_lead", "fx_riser_noise", "wide_pad", "drum_kick"]) {
      const used = new Grow({ delay_feedback: 0.9, delay_mix: 1, reverb_mix: 1 }, 60, "supersaw");
      for (const n of [36, 48, 60, 64, 67]) used.on(n, 1);
      used.render(6);             // ディレイの線（4秒）を全部埋める
      used.ex.grow_close(0);
      used.ex.grow_open(0);
      used.load({}, 90, preset);
      const fresh = new Grow({}, 90, preset);
      expect(difference(fresh.blip(3, 60), used.blip(3, 60)), preset).toBe(-Infinity);
    }
  });

  it("開き直したあと、まだ書いていないディレイの線の中身（前の音）は鳴らない", () => {
    const g = new Grow({ delay_feedback: 0.9, delay_mix: 1 }, 60, "supersaw");
    for (const n of [36, 48, 60]) g.on(n, 1);
    g.render(6);
    g.ex.grow_close(0);
    g.ex.grow_open(0);
    g.load({ osc1_level: 0, reverb_mix: 0, delay_mix: 1, delay_feedback: 0.9, delay_time: 5 }, 40);
    g.on(60);
    expect(peak(g.render(5))).toBe(0);
  });
});
