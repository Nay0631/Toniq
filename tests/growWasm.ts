import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Git に入れた grow の wasm（public/grow/grow.wasm）を Node で直接鳴らす部品（grow のテストで共通）
export const GROW_WASM = readFileSync(fileURLToPath(new URL("../public/grow/grow.wasm", import.meta.url)));
export const SR = 48000;

const module = new WebAssembly.Module(GROW_WASM);

export interface GrowWasm {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  grow_init(rate: number): void;
  grow_open(slot: number): number;
  grow_close(slot: number): void;
  grow_set_bpm(bpm: number): void;
  grow_render(n: number): void;
  grow_left(): number;
  grow_block_size(): number;
  grow_note_on(note: number, velocity: number): void;
  grow_note_off(note: number): void;
  grow_set_param(index: number, value: number): void;
  grow_param_count(): number;
  grow_param_id(i: number): number;
  grow_preset_count(): number;
  grow_preset_id(i: number): number;
  grow_preset_value(preset: number, i: number): number;
}

export class Grow {
  readonly ex: GrowWasm;
  private readonly ids: string[];

  // values は初期化のプリセット（preset を渡せばそのプリセット）から変える値（パラメーターの ID → 値）
  constructor(values: Record<string, number> = {}, bpm = 120, preset?: string) {
    const imports: Record<string, Record<string, () => number>> = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.kind === "function") (imports[imp.module] ??= {})[imp.name] = () => 0;
    }
    this.ex = new WebAssembly.Instance(module, imports).exports as unknown as GrowWasm;
    this.ex._initialize?.();
    this.ex.grow_init(SR);
    this.ids = Array.from({ length: this.ex.grow_param_count() }, (_, i) => this.text(this.ex.grow_param_id(i)));
    this.load(values, bpm, preset);
  }

  private text(ptr: number): string {
    const bytes = new Uint8Array(this.ex.memory.buffer);
    let end = ptr;
    while (bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
  }

  load(values: Record<string, number>, bpm: number, preset?: string): void {
    this.ex.grow_set_bpm(bpm);
    if (preset) this.ids.forEach((id, i) => this.set({ [id]: this.ex.grow_preset_value(this.presetIndex(preset), i) }));
    this.set(values);
  }

  private presetIndex(id: string): number {
    for (let i = 0; i < this.ex.grow_preset_count(); i++) if (this.text(this.ex.grow_preset_id(i)) === id) return i;
    throw new Error(`プリセットがない：${id}`);
  }

  // プリセットの値（パラメーターの ID）
  presetValue(preset: string, id: string): number {
    return this.ex.grow_preset_value(this.presetIndex(preset), this.ids.indexOf(id));
  }

  set(values: Record<string, number>): void {
    for (const [id, v] of Object.entries(values)) {
      const index = this.ids.indexOf(id);
      if (index < 0) throw new Error(`パラメーターがない：${id}`);
      this.ex.grow_set_param(index, v);
    }
  }

  on(note: number, velocity = 0.9): void { this.ex.grow_note_on(note, velocity); }
  off(note: number): void { this.ex.grow_note_off(note); }

  // seconds 秒分を描いて左チャンネルを返す
  render(seconds: number): Float32Array {
    const total = Math.round(seconds * SR), out = new Float32Array(total), block = this.ex.grow_block_size();
    for (let pos = 0; pos < total; pos += block) {
      const n = Math.min(block, total - pos);
      this.ex.grow_render(n);
      out.set(new Float32Array(this.ex.memory.buffer, this.ex.grow_left(), n), pos);
    }
    return out;
  }

  // 短い音を1つ鳴らして、そのあと seconds 秒を返す（音の長さを含む）
  blip(seconds: number, note = 60): Float32Array {
    this.on(note);
    const head = this.render(0.1);
    this.off(note);
    return concat(head, this.render(seconds - 0.1));
  }
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// from〜to 秒のピーク
export const peak = (x: Float32Array, from = 0, to = x.length / SR) =>
  x.subarray(Math.round(from * SR), Math.round(to * SR)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// 1サンプルの変化の最大（from〜to 秒）
export function maxStep(x: Float32Array, from = 0, to = x.length / SR): number {
  let m = 0;
  for (let i = Math.max(1, Math.round(from * SR)); i < Math.round(to * SR); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
}

// a に対する a と b の差の大きさ（dB）
export function difference(a: Float32Array, b: Float32Array): number {
  let signal = 0, diff = 0;
  a.forEach((v, i) => { signal += v * v; diff += (v - b[i]) ** 2; });
  return 10 * Math.log10(diff / signal);
}
