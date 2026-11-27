import { describe, it, expect, beforeEach, vi } from "vitest";

// ロングリバーブ（FX 用の長い響き）を、FX が鳴る間だけつなぐ（MixerEngine.ts の createLongReverbGate）。
// Tone.js のノードは、つないだ相手を覚えるだけの代わりを使う
const tone = vi.hoisted(() => {
  class Node {
    static all: Node[] = [];
    kind: string;
    options: unknown;
    to = new Set<unknown>();
    gain = { value: 1 }; threshold = { value: 0 }; ratio = { value: 0 }; attack = { value: 0 }; release = { value: 0 };
    low = { value: 0 }; mid = { value: 0 }; high = { value: 0 };
    buffer: unknown = null;
    constructor(kind: string, options: unknown) { this.kind = kind; this.options = options; Node.all.push(this); }
    connect(node: unknown): this { this.to.add(node); return this; }
    disconnect(node: unknown): this { this.to.delete(node); return this; }
    toDestination(): this { return this; }
  }
  const of = (kind: string) => class extends Node { constructor(options?: unknown) { super(kind, options); } };
  const liveContext = () => ({
    isOffline: false, sampleRate: 48000, currentTime: 0, rawContext: {} as unknown,
    timers: [] as { fn: () => void; at: number }[],
    setTimeout(fn: () => void, seconds: number) { this.timers.push({ fn, at: this.currentTime + seconds }); return 0; },
    advance(to: number) {
      this.currentTime = to;
      for (const t of this.timers.filter(t => t.at <= to)) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); }
    },
  });
  return { Node, of, liveContext, context: liveContext() as ReturnType<typeof liveContext> };
});
vi.mock("tone", () => ({
  Gain: tone.of("Gain"), Limiter: tone.of("Limiter"), Compressor: tone.of("Compressor"), EQ3: tone.of("EQ3"), Filter: tone.of("Filter"),
  Convolver: tone.of("Convolver"), Panner: tone.of("Panner"), Analyser: tone.of("Analyser"), ToneAudioBuffer: class {}, OfflineContext: class {},
  getContext: () => tone.context, now: () => 0,
}));
vi.mock("../src/engine/ReverbImpulse", () => ({ reverbImpulse: () => ({ buffer: {}, gain: 1 }) }));

import { connectToMixer, createLongReverbGate } from "../src/engine/MixerEngine";

type FakeNode = InstanceType<typeof tone.Node>;
const longIn = () => tone.Node.all.filter(n => n.kind === "Filter" && (n.options as { frequency?: number })?.frequency === 350).slice(-1)[0];
const connected = () => tone.Node.all.some(n => n.kind === "Gain" && n.to.has(longIn()));

// FX のパートをミキサーにつないで、ゲートを作る
function setup() {
  connectToMixer(new tone.Node("part", null) as unknown as never, "fx");
  return createLongReverbGate();
}

beforeEach(() => {
  tone.Node.all.length = 0;
  tone.context = tone.liveContext();
});

describe("ロングリバーブ：再生", () => {
  it("FX が鳴るまではつながず、鳴る間と余韻（4 秒）のあとに外す", () => {
    const gate = setup();
    expect(connected()).toBe(false);
    gate(1, 2);
    expect(connected()).toBe(true);
    tone.context.advance(6.9);
    expect(connected()).toBe(true);
    tone.context.advance(7.1);  // 1 + 2 + 4
    expect(connected()).toBe(false);
  });

  it("重なっている間は、最後の FX が終わるまで外さない", () => {
    const gate = setup();
    gate(1, 2);
    tone.context.advance(5);
    gate(5.1, 1);
    tone.context.advance(8);    // 1つ目は終わったが、2つ目（〜10.1）がある
    expect(connected()).toBe(true);
    tone.context.advance(10.2);
    expect(connected()).toBe(false);
  });

  it("FX 以外のパートは長い響きに送らない", () => {
    const gate = setup();
    const before = tone.Node.all.length;
    connectToMixer(new tone.Node("part", null) as unknown as never, "chord");
    gate(1, 1);
    expect(tone.Node.all.slice(before).some(n => n.to.has(longIn()))).toBe(false);
  });
});

describe("ロングリバーブ：書き出し", () => {
  interface Stop { at: number; resolve: () => void }
  // suspend を受け付ける書き出し用のコンテキスト。reject = 一時停止できない
  function offline(reject = false) {
    const stops: Stop[] = [];
    let resumed = 0;
    const raw = {
      sampleRate: 48000,
      suspend: (at: number) => reject
        ? Promise.reject(new Error("InvalidStateError"))
        : new Promise<void>(resolve => stops.push({ at, resolve })),
      resume: async () => { resumed++; },
    };
    tone.context = Object.assign(tone.liveContext(), { isOffline: true, rawContext: raw });
    return { stops, resumed: () => resumed };
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it("音の少し前で一時停止してつなぎ、余韻のあとで外して、そのつど再開する", async () => {
    const { stops, resumed } = offline();
    const gate = setup();
    gate(10, 2);
    expect(connected()).toBe(false);  // 予定を組み立てている間はつながない
    expect(stops.map(s => s.at)).toHaveLength(2);
    expect(stops[0].at).toBeGreaterThan(9.9);
    expect(stops[0].at).toBeLessThan(10);
    expect(stops[1].at).toBeCloseTo(16, 1);
    stops[0].resolve();
    await settle();
    expect(connected()).toBe(true);
    stops[1].resolve();
    await settle();
    expect(connected()).toBe(false);
    expect(resumed()).toBe(2);
  });

  it("同じ所で始まる FX は、一時停止を1つにまとめる", async () => {
    const { stops } = offline();
    const gate = setup();
    gate(10, 2);
    gate(10, 3);
    expect(stops).toHaveLength(3);  // 始まり1つ＋終わり2つ
    stops[0].resolve();
    await settle();
    stops[1].resolve();
    await settle();
    expect(connected()).toBe(true);  // 長いほうがまだ鳴っている
    stops[2].resolve();
    await settle();
    expect(connected()).toBe(false);
  });

  it("一時停止できない・曲の頭から鳴るときは、つないだままにする（音を欠かさない）", async () => {
    offline(true);
    const gate = setup();
    gate(10, 2);
    await settle();
    expect(connected()).toBe(true);

    const { stops } = offline();
    tone.Node.all.length = 0;
    setup()(0, 1);
    expect(connected()).toBe(true);
    expect(stops).toHaveLength(1);  // 終わりだけ
  });

  it("作ったあとでコンテキストが再生用に戻っても、書き出し用のミキサーにつなぐ", async () => {
    const { stops } = offline();
    const gate = setup();
    const target = longIn() as FakeNode;
    tone.context = tone.liveContext();
    gate(10, 2);
    stops[0].resolve();
    await settle();
    expect(tone.Node.all.some(n => n.kind === "Gain" && n.to.has(target))).toBe(true);
  });
});
