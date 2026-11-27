import { describe, it, expect, beforeEach, vi } from "vitest";

// ワンショット音源のハイハットのチョーク（クローズドハイハットがオープンハイハットを止める）。
// Tone.js のノードは、つなぐ・止める呼び出しを記録するだけの代わりを使う

interface FakeSource { started: number; stops: number[]; onended: () => void }
const sources = vi.hoisted(() => [] as FakeSource[]);

vi.mock("tone", () => {
  class FakeNode {
    context = {};
    disposed = false;
    connect(): this { return this; }
    dispose(): void { this.disposed = true; }
  }
  class ToneBufferSource extends FakeNode implements FakeSource {
    started = -1;
    stops: number[] = [];
    onended = () => {};
    constructor() {
      super();
      sources.push(this);
    }
    start(time: number): this { this.started = time; return this; }
    stop(time: number): this { this.stops.push(time); return this; }
  }
  return { Gain: FakeNode, Compressor: FakeNode, Distortion: FakeNode, Filter: FakeNode, ToneBufferSource };
});
vi.mock("../src/engine/DrumSamples", () => ({ getDrumSample: () => ({}) }));
vi.mock("../src/engine/Grow", () => ({
  GrowInstrument: vi.fn(), isGrowReady: () => false, findGrowPreset: () => -1, growPresetValuesWith: vi.fn(),
}));

import { createDrumKit } from "../src/engine/SynthFactory";

const openHat = () => createDrumKit("EDM", ["hihat_open"], "sample").voices.hihat_open;

beforeEach(() => { sources.length = 0; });

describe("ワンショット音源のチョーク", () => {
  it("クローズドハイハットが続いても、最初の1回で止める（2回目で止める時刻を延ばさない）", () => {
    const hat = openHat();
    hat.trigger(1, 1);
    hat.choke!(1.12);
    hat.choke!(1.24);  // 1つ目のフェードの途中で、次のクローズドハイハットの予約が来る
    hat.choke!(1.36);
    expect(sources[0].stops).toEqual([1.12]);
  });

  it("あとから鳴らしたオープンハイハットは、次のクローズドハイハットで止める", () => {
    const hat = openHat();
    hat.trigger(1, 1);
    hat.choke!(1.1);
    hat.trigger(1.5, 1);
    hat.choke!(1.6);
    expect(sources.map(s => s.stops)).toEqual([[1.1], [1.6]]);
  });

  it("鳴り終わった音は止めない", () => {
    const hat = openHat();
    hat.trigger(1, 1);
    sources[0].onended();
    hat.choke!(2);
    expect(sources[0].stops).toEqual([]);
  });
});
