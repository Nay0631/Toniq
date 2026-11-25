import { describe, it, expect } from "vitest";
import workletSource from "../src/engine/growWorklet.js?raw";
import { Grow, GROW_WASM, SR } from "./growWasm";

// grow の AudioWorklet（src/engine/growWorklet.js）：合図での発音と、スロットを閉じて開き直す（ノードの使い回し）。
// AudioWorkletGlobalScope の代わりを用意して、wasm（Git に入れた public/grow/grow.wasm）ごと動かす

interface Processor {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(data: unknown): void };
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

const BLOCK = 128, SLOTS = 16;

function loadProcessor() {
  let Registered: (new (options: unknown) => Processor) | null = null;
  class Base {
    port = { onmessage: null, sent: [] as unknown[], postMessage(data: unknown) { this.sent.push(data); } };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", workletSource)(
    Base, (_name: string, c: new (options: unknown) => Processor) => { Registered = c; }, SR);
  return Registered! as (new (options: unknown) => Processor) & { parameterDescriptors: { name: string }[] };
}

const GrowProcessor = loadProcessor();
const reference = new Grow();
const values = (preset: string, over: Record<string, number> = {}) => {
  const ids = Array.from({ length: reference.ex.grow_param_count() }, (_, i) => paramId(i));
  return ids.map(id => over[id] ?? reference.presetValue(preset, id));
};
function paramId(i: number): string {
  const bytes = new Uint8Array(reference.ex.memory.buffer);
  const ptr = reference.ex.grow_param_id(i);
  let end = ptr;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(ptr, end));
}

const DRY   = { reverb_mix: 0, delay_mix: 0, chorus_mix: 0 };
const ORGAN = values("organ", DRY);

class Node {
  readonly p: Processor;
  private frame = 0;
  // スロットごとの合図の値（次のブロックのサンプルの位置 → 値）と、そのあとずっと残る値
  readonly held: Record<string, number> = {};
  constructor(slots: { values: number[]; bpm: number }[], readonly keep: boolean) {
    this.p = new GrowProcessor({ processorOptions: { wasm: GROW_WASM.buffer.slice(GROW_WASM.byteOffset, GROW_WASM.byteOffset + GROW_WASM.byteLength), slots, overlap: 0.002, keep } });
  }
  get sent(): { type: string; slot: number; id: number }[] { return (this.p.port as unknown as { sent: never[] }).sent; }
  send(data: unknown) { this.p.port.onmessage!({ data }); }

  // 1ブロック描く。signals は「名前＋スロット」→ [サンプルの位置, 値]。出力はスロットごとのピーク
  block(signals: Record<string, [number, number]> = {}): { alive: boolean; peaks: number[]; left: Float32Array[] } {
    const outputs = Array.from({ length: this.keep ? SLOTS : 1 }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)]);
    const parameters: Record<string, Float32Array> = {};
    for (const { name } of GrowProcessor.parameterDescriptors) {
      const base = this.held[name] ?? 0, signal = signals[name];
      if (!signal) parameters[name] = new Float32Array([base]);
      else { parameters[name] = new Float32Array(BLOCK).fill(base); parameters[name][signal[0]] = signal[1]; }
    }
    (globalThis as Record<string, unknown>).currentFrame = this.frame;
    const alive = this.p.process([], outputs, parameters);
    this.frame += BLOCK;
    return { alive, peaks: outputs.map(o => o[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0)), left: outputs.map(o => o[0]) };
  }
  blocks(n: number): number[] {
    const max = Array.from({ length: this.keep ? SLOTS : 1 }, () => 0);
    for (let i = 0; i < n; i++) this.block().peaks.forEach((v, s) => { max[s] = Math.max(max[s], v); });
    return max;
  }
}
const on = (note: number, velocity = 1) => note + 1 + velocity * 0.5;

describe("grow の AudioWorklet", () => {
  it("合図のサンプルから鳴り始める", () => {
    const node = new Node([{ values: ORGAN, bpm: 120 }], false);
    const { left } = node.block({ on0: [40, on(60)] });
    expect(left[0].subarray(0, 40).every(v => v === 0)).toBe(true);
    expect(node.blocks(20)[0]).toBeGreaterThan(0.01);
  });

  it("全部のスロットを閉じると、書き出し用のノードは終わり、再生用（keep）は残る", () => {
    for (const keep of [false, true]) {
      const node = new Node([{ values: ORGAN, bpm: 120 }], keep);
      expect(node.block().alive).toBe(true);
      node.send({ type: "close", slot: 0 });
      expect(node.block().alive).toBe(keep);
    }
  });

  it("閉じたスロットを開き直すと、知らせ（opened）を返し、新しい音色で鳴る", () => {
    const node = new Node([{ values: ORGAN, bpm: 120 }], true);
    node.block({ on0: [0, on(60)] });
    expect(node.blocks(20)[0]).toBeGreaterThan(0.01);
    node.send({ type: "close", slot: 0 });
    expect(node.blocks(5)[0]).toBe(0);  // 閉じたら、押したままの音も止まる
    node.send({ type: "open", slot: 0, id: 7, values: values("organ", { ...DRY, master: -36 }), bpm: 120 });
    expect(node.sent).toContainEqual({ type: "opened", slot: 0, id: 7 });
    expect(node.blocks(20)[0]).toBe(0);  // 前の音は残らない
    node.block({ on0: [5, on(60)] });
    const level = node.blocks(20)[0];
    expect(level).toBeGreaterThan(0.0005);
    expect(level).toBeLessThan(0.02);    // 開き直した値（マスター -36dB）で鳴る
  });

  it("開き直した直後：残っている前の合図は鳴らさず、次のサンプルからの合図は落とさない", () => {
    const node = new Node([{ values: ORGAN, bpm: 120 }], true);
    node.held.on0 = on(48);              // 前の音色の合図の値が残っている
    node.send({ type: "close", slot: 0 });
    node.send({ type: "open", slot: 0, id: 1, values: ORGAN, bpm: 120 });
    expect(node.blocks(20)[0]).toBe(0);
    node.held.on0 = 0;                   // 0 に戻っても鳴らない
    expect(node.blocks(20)[0]).toBe(0);

    node.send({ type: "close", slot: 0 });
    node.send({ type: "open", slot: 0, id: 2, values: ORGAN, bpm: 120 });
    node.block({ on0: [1, on(60)] });    // 知らせを受けてすぐ入れた合図は、いちばん早いとここに来る
    expect(node.blocks(20)[0]).toBeGreaterThan(0.01);
  });

  it("開き直したスロットは、前の音色の弾き直しの記録を引き継がない（消音が無視されて鳴りっぱなしにならない）", () => {
    const node = new Node([{ values: ORGAN, bpm: 120 }], true);
    node.block({ on0: [0, on(60)] });
    node.send({ type: "close", slot: 0 });
    node.send({ type: "open", slot: 0, id: 1, values: ORGAN, bpm: 120 });
    node.block();
    node.block({ on0: [0, on(60)], off0: [60, 61] });  // 発音の直後（2ms 以内）の消音。前の音色で押したままだった高さ
    node.blocks(400);
    expect(node.blocks(5)[0]).toBe(0);
  });

  it("ほかのスロットの音は、開き直しの影響を受けない", () => {
    const steady = new Node([{ values: ORGAN, bpm: 120 }, { values: ORGAN, bpm: 120 }], true);
    const busy   = new Node([{ values: ORGAN, bpm: 120 }, { values: ORGAN, bpm: 120 }], true);
    steady.block({ on0: [0, on(60)] });
    busy.block({ on0: [0, on(60)] });
    for (let i = 0; i < 20; i++) {
      busy.send({ type: "close", slot: 1 });
      busy.send({ type: "open", slot: 1, id: i, values: values("supersaw"), bpm: 120 });
      expect(Array.from(busy.block().left[0])).toEqual(Array.from(steady.block().left[0]));
    }
  });
});
