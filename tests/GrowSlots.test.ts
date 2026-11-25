import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { GROW_WASM } from "./growWasm";

// grow のノードの使い回し（src/engine/Grow.ts の GrowInstrument）：再生用のコンテキストでは、閉じたスロットを
// 次の音色が使い、ノードを作り足さない。書き出し（オフライン）では毎回ノードを作る
vi.mock("../src/engine/DrumSamples", () => ({
  fetchArrayBuffer: async () => GROW_WASM.buffer.slice(GROW_WASM.byteOffset, GROW_WASM.byteOffset + GROW_WASM.byteLength),
}));

class FakeParam {
  events: [string, number, number?][] = [];
  setValueAtTime(value: number, time: number) { this.events.push(["set", value, time]); }
  cancelScheduledValues(time: number) { this.events = [["cancel", time]]; }
  get pulses() { return this.events.filter(e => e[0] === "set" && e[1] !== 0); }
}
interface Msg { type: string; slot: number; id?: number; values?: unknown }
class FakeNode {
  port = { sent: [] as Msg[], onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(m: Msg) { this.sent.push(m); } };
  parameters = new Map<string, FakeParam>();
  onprocessorerror: (() => void) | null = null;
  constructor(readonly options: { numberOfOutputs: number; processorOptions: { slots: unknown[]; keep: boolean } }) {
    for (let s = 0; s < 16; s++) for (const n of ["on", "off", "pidx", "pval"]) this.parameters.set(`${n}${s}`, new FakeParam());
  }
  disconnect() { /* つなぎ先は見ない */ }
  opens() { return this.port.sent.filter(m => m.type === "open"); }
  ack(m: Msg) { this.port.onmessage!({ data: { type: "opened", slot: m.slot, id: m.id } }); }
}

let nodes: FakeNode[] = [];
let context: { isOffline: boolean; rawContext: { currentTime: number; sampleRate: number }; now(): number; createAudioWorkletNode(name: string, o: never): FakeNode };

vi.mock("tone", () => ({
  getContext: () => context,
  connect: () => undefined,
  Gain: class { context = context; connect() { return this; } dispose() { return this; } },
  TimeClass: class { private v: number; constructor(_c: unknown, v: number) { this.v = v; } toSeconds() { return this.v; } },
  FrequencyClass: class { toMidi() { return 60; } },
}));

const Grow = await import("../src/engine/Grow");
const task = () => new Promise(resolve => setTimeout(resolve, 0));

function newContext(isOffline = false) {
  nodes = [];
  context = {
    isOffline,
    rawContext: { currentTime: 1, sampleRate: 48000 },
    now: () => 1.1,
    createAudioWorkletNode: (_n, o) => { const node = new FakeNode(o); nodes.push(node); return node; },
  };
}
const create = (n = 1) => Array.from({ length: n }, () => new Grow.GrowInstrument(() => [1, 2, 3], 120));

beforeAll(async () => { expect(await Grow.loadGrow()).toBe(true); });
beforeEach(() => newContext());

describe("grow のノードの使い回し", () => {
  it("同じタスクで作った音色は1つのノードにまとまり、すぐ発音を入れられる", async () => {
    const insts = create(3);
    insts[1].triggerAttack("C4", 2, 1);   // ノードができる前の発音もためておく
    await task();
    expect(nodes.length).toBe(1);
    expect(nodes[0].options.numberOfOutputs).toBe(16);
    expect(nodes[0].options.processorOptions.slots.length).toBe(3);
    expect(nodes[0].parameters.get("on1")!.pulses.length).toBe(1);
  });

  it("破棄した音色のスロットを次の音色が使い、ノードを作り足さない", async () => {
    const [a] = create(2);
    await task();
    a.dispose();
    create(1);
    await task();
    expect(nodes.length).toBe(1);
    expect(nodes[0].opens()).toMatchObject([{ slot: 0, values: [1, 2, 3] }]);
  });

  it("使い回すスロットは、開き終わった知らせを待ってから発音を入れる", async () => {
    const [a] = create(1);
    await task();
    a.dispose();
    const [b] = create(1);
    b.triggerAttackRelease("C4", 0.5, 2, 1);
    await task();
    expect(nodes[0].parameters.get("on0")!.pulses.length).toBe(0);
    nodes[0].ack(nodes[0].opens()[0]);
    expect(nodes[0].parameters.get("on0")!.pulses.length).toBe(1);
    expect(nodes[0].parameters.get("off0")!.pulses.length).toBe(1);
  });

  it("開いている途中で破棄し、別の音色で開き直したとき、前の知らせでは鳴らさない", async () => {
    const [a] = create(1);
    await task();
    a.dispose();
    const [b] = create(1);
    await task();
    const first = nodes[0].opens()[0];
    b.dispose();
    const [c] = create(1);
    c.triggerAttack("C4", 2, 1);
    await task();
    nodes[0].ack(first);
    expect(nodes[0].parameters.get("on0")!.pulses.length).toBe(0);
    nodes[0].ack(nodes[0].opens()[1]);
    expect(nodes[0].parameters.get("on0")!.pulses.length).toBe(1);
  });

  it("破棄すると、これから鳴るはずだった合図を消して 0 に戻す", async () => {
    const [a] = create(1);
    await task();
    a.triggerAttackRelease("C4", 0.5, 3, 1);
    a.dispose();
    for (const name of ["on0", "off0", "pidx0", "pval0"]) {
      expect(nodes[0].parameters.get(name)!.events, name).toEqual([["cancel", 0], ["set", 0, 1]]);
    }
    expect(nodes[0].port.sent).toContainEqual({ type: "close", slot: 0 });
  });

  it("空きが足りないときだけノードを足す", async () => {
    const insts = create(20);
    await task();
    expect(nodes.length).toBe(2);
    insts.slice(0, 5).forEach(i => i.dispose());
    create(16);                                  // 空き 5 ＋ 2つ目のノードの空き 12 = 17
    await task();
    expect(nodes.length).toBe(2);
    create(2);
    await task();
    expect(nodes.length).toBe(3);
  });

  it("ノードができる前に破棄した音色は、スロットを使わない", async () => {
    const [a] = create(2);
    a.dispose();
    await task();
    expect(nodes[0].options.processorOptions.slots.length).toBe(1);
  });

  it("例外で止まったノードは使い回さない", async () => {
    const [a] = create(1);
    await task();
    a.dispose();
    vi.spyOn(console, "warn").mockImplementationOnce(() => undefined);
    nodes[0].onprocessorerror!();
    create(1);
    await task();
    expect(nodes.length).toBe(2);
    expect(nodes[0].opens().length).toBe(0);
  });

  it("書き出し（オフライン）では、使い回さずに毎回ちょうどの出力のノードを作る", async () => {
    newContext(true);
    const [a] = create(2);
    await task();
    a.dispose();
    create(1);
    await task();
    expect(nodes.map(n => [n.options.numberOfOutputs, n.options.processorOptions.keep])).toEqual([[2, false], [1, false]]);
  });
});
