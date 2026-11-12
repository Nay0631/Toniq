import { defaultState, setState } from "../src/engine/AppState";
import chordDB from "../src/data/chord_progressions.json";
import drumDB from "../src/data/drum_patterns.json";
import type { ChordProgression, DrumPattern } from "../src/data/types";

// テストで共通に使うもの

export const chords = chordDB as unknown as ChordProgression[];
export const drums  = drumDB  as unknown as DrumPattern[];

export function chordById(id: string): ChordProgression {
  const c = chords.find(c => c.id === id);
  if (!c) throw new Error(`進行がない: ${id}`);
  return c;
}

// シードから作る乱数（mulberry32）。Math.random を差し替えて生成結果を固定する
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// AppState を初期状態に戻す（テストごとに前のテストの状態を持ち越さない）
export function resetState(): void {
  setState(structuredClone(defaultState));
}

// localStorage の代わり（Node には無い）。quotaAfter 文字を超える書き込みは容量オーバーの例外にする
export class MemoryStorage {
  private items = new Map<string, string>();
  quotaAfter = Infinity;
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(k: string) { return this.items.get(k) ?? null; }
  removeItem(k: string) { this.items.delete(k); }
  setItem(k: string, v: string) {
    if (v.length > this.quotaAfter) {
      const e = new Error("The quota has been exceeded.");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.items.set(k, String(v));
  }
}
