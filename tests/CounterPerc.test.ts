import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 音を出す部分（Web Audio）は使わないので外す
vi.mock("../src/engine/VolumeManager", () => ({ createVolumeNode: vi.fn() }));
vi.mock("../src/engine/Grow", () => ({ GrowInstrument: vi.fn(), growValues: vi.fn(), isGrowReady: () => false }));
vi.mock("../src/engine/SynthFactory", () => ({ createPercKit: vi.fn() }));

import { counterNotes, CounterNote } from "../src/engine/CounterPlayer";
import { percStepHits, percLabel, PERC_TRACKS, PERC_PATTERNS } from "../src/engine/PercPlayer";
import { generateMelody, noteToMidi, timeToUnits, durationToUnits, MelodyNote } from "../src/engine/MelodyGenerator";
import { resolveChord, scaleSemitones, NOTE_INDEX, SCALE_TONES } from "../src/data/degree_resolver";
import { setState, getState } from "../src/engine/AppState";
import { setArrangementBypass } from "../src/engine/LoopArranger";
import type { ChordProgression } from "../src/data/types";
import melodyParams from "../src/data/melody_params.json";
import { chords, chordById, resetState, seededRandom } from "./helpers";

const GENRES = Object.keys(melodyParams);
const KEYS   = ["A", "C", "F#"];
const random = Math.random;
afterEach(() => { Math.random = random; });

// 進行のコードに全部同じセクションを付ける（曲全体の並び songProgression と同じ形）
function withSection(p: ChordProgression, section: "A" | "B"): ChordProgression {
  return { ...p, progression: p.progression.map(c => ({ ...c, section })) };
}

const sounding = (notes: MelodyNote[]) => notes
  .filter((n): n is MelodyNote & { note: string } => n.note !== null)
  .map(n => ({ midi: noteToMidi(n.note), start: timeToUnits(n.time), units: durationToUnits(n.duration) }));

function chordTonesAt(p: ChordProgression, key: string, unit: number): number[] {
  const c = p.progression.find(c => unit >= (c.bar - 1) * 16 && unit < (c.bar - 1 + c.duration_bars) * 16)!;
  return resolveChord(c.degree, c.type, 0, key, p.base_scale, 4).notes.map(n => noteToMidi(n) % 12);
}

// 進行 × ジャンル × キーの組み合わせ（シードで決まるメロディ）
function cases(section: "A" | "B"): { p: ChordProgression; key: string; melody: MelodyNote[]; counter: CounterNote[] }[] {
  const out = [];
  let seed = 1;
  for (const base of chords.slice(0, 40)) {
    for (const genre of GENRES) {
      const key = KEYS[seed % KEYS.length];
      Math.random = seededRandom(seed++);
      const melody = generateMelody(base, key, genre, { section });
      Math.random = random;
      const p = withSection(base, section);
      out.push({ p, key, melody, counter: counterNotes(p, melody, key) });
    }
  }
  return out;
}

describe("カウンターメロディ：サビのハモり", () => {
  const all = cases("B");

  it("メロディの音と同じ位置で、3度・4度・6度下のスケール音（G3 より下には行かない）", () => {
    for (const { p, key, melody, counter } of all) {
      const notes = sounding(melody);
      const scale = new Set(scaleSemitones(p.base_scale).map(t => ((NOTE_INDEX[key] ?? 0) + t) % 12));
      for (const c of counter) {
        const m = notes.find(n => n.start === c.sixteenth);
        expect(m, `${p.id} ${key} ${c.sixteenth}`).toBeDefined();
        expect([3, 4, 5, 8, 9]).toContain(m!.midi - c.midi);
        expect(c.length).toBe(m!.units);
        expect(scale.has(c.midi % 12)).toBe(true);
        expect(c.midi).toBeGreaterThanOrEqual(55);
      }
    }
  });

  it("ほとんどのメロディの音にハモりが付き、強拍（1・3拍目）はほぼコード構成音", () => {
    let melodyCount = 0, counterCount = 0, strong = 0, strongChord = 0;
    for (const { p, key, melody, counter } of all) {
      melodyCount  += sounding(melody).length;
      counterCount += counter.length;
      for (const c of counter.filter(c => c.sixteenth % 8 === 0)) {
        strong++;
        if (chordTonesAt(p, key, c.sixteenth).includes(c.midi % 12)) strongChord++;
      }
    }
    expect(counterCount / melodyCount).toBeGreaterThan(0.9);
    expect(strongChord / strong).toBeGreaterThan(0.9);
  });
});

describe("カウンターメロディ：Aメロの合いの手", () => {
  const all = cases("A");

  it("メロディの発音と重ならず、次の発音の前に終わる（ペンタトニック・G4〜C6）", () => {
    let figures = 0;
    for (const { p, key, melody, counter } of all) {
      const onsets = sounding(melody).map(n => n.start);
      const total  = p.length_bars * 16;
      const core   = new Set(SCALE_TONES[p.base_scale].core.map(t => ((NOTE_INDEX[key] ?? 0) + t) % 12));
      for (const c of counter) {
        expect(onsets).not.toContain(c.sixteenth);
        expect(onsets.some(o => o > c.sixteenth && o < c.sixteenth + c.length), `${p.id} ${c.sixteenth}`).toBe(false);
        expect(c.sixteenth + c.length).toBeLessThanOrEqual(total);
        expect(core.has(c.midi % 12)).toBe(true);
        expect(c.midi).toBeGreaterThanOrEqual(67);
        expect(c.midi).toBeLessThanOrEqual(84);
      }
      figures += counter.length;
    }
    expect(figures).toBeGreaterThan(0);  // どこかには合いの手が入る
  });

  it("合いの手はサビに食い込まない（Aメロの次がサビ）", () => {
    const base = chordById(chords.find(c => c.length_bars === 4)!.id);
    Math.random = seededRandom(7);
    const melody = generateMelody(base, "A", "ローファイ", { section: "A" });
    // 2周目をサビにした8小節の並び（2周目のメロディは無し）
    const song: ChordProgression = {
      ...base, length_bars: 8,
      progression: [
        ...base.progression.map(c => ({ ...c, section: "A" as const })),
        ...base.progression.map(c => ({ ...c, bar: c.bar + 4, section: "B" as const })),
      ],
    };
    for (const c of counterNotes(song, melody, "A")) expect(c.sixteenth + c.length).toBeLessThanOrEqual(64);
  });

  it("メロディが空なら何も鳴らさない", () => {
    expect(counterNotes(chords[0], [], "A")).toEqual([]);
  });
});

describe("パーカッション", () => {
  beforeEach(() => {
    resetState();
    setArrangementBypass(false);
    setState({ chordPattern: chords.find(c => c.length_bars === 4)!, bars: 32, endingEnabled: true });
  });

  it.each(GENRES)("%s：ラベルがあり、サビ（9〜16小節目）は Aメロ（1〜8小節目）以上に鳴る", genre => {
    setState({ genre });
    expect(percLabel(genre).length).toBeGreaterThan(0);
    const count = (from: number) => {
      let n = 0;
      for (let bar = from; bar < from + 8; bar++) for (let step = 0; step < 16; step++) n += percStepHits(bar, step).length;
      return n;
    };
    expect(count(16)).toBeGreaterThanOrEqual(count(0));  // 標準の構成は A A サビ A（3つ目の8小節がサビ）
    expect(count(0)).toBeGreaterThan(0);
  });

  it("全ジャンルのパターンが 16 ステップの X / x / o / . で書かれている", () => {
    for (const genre of GENRES) {
      const def = PERC_PATTERNS[genre];
      expect(def, genre).toBeDefined();
      for (const section of ["A", "B"] as const) {
        for (const [track, steps] of Object.entries(def[section])) {
          expect(PERC_TRACKS).toContain(track);
          expect(steps, `${genre} ${section} ${track}`).toMatch(/^[Xxo.]{16}$/);
        }
      }
    }
  });

  it("エンディングの小節では鳴らさず、強さは 0〜1・トラック名は決まったもの", () => {
    for (const genre of GENRES) {
      setState({ genre });
      const end = getState().bars - 1;
      for (let step = 0; step < 16; step++) expect(percStepHits(end, step)).toEqual([]);
      for (let bar = 0; bar < end; bar++) {
        for (let step = 0; step < 16; step++) {
          for (const h of percStepHits(bar, step)) {
            expect(PERC_TRACKS).toContain(h.name);
            expect(h.velocity).toBeGreaterThan(0);
            expect(h.velocity).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
