import { describe, it, expect, afterEach } from "vitest";
import { resolveSimpleMode, rerollChord, preferGenreScales, scalesForGenre } from "../src/engine/SimpleModeResolver";
import { resolveChord } from "../src/data/degree_resolver";
import easyTable from "../src/data/easy_mode_table.json";
import genreScales from "../src/data/genre_scales.json";
import { chords, seededRandom } from "./helpers";

// ジャンルに合うスケール（genre_scales.json）でシンプルモードのコード進行を選ぶ

const table = easyTable as Record<string, Record<string, { chord_ids: string[] }>>;
const random = Math.random;
afterEach(() => { Math.random = random; });

describe("ジャンルに合うスケール", () => {
  it("すべてのジャンルにスケールが決めてあり、どれもコード進行DBにある", () => {
    const inDB = new Set(chords.map(c => c.base_scale));
    for (const genre of Object.keys(table)) {
      const scales = scalesForGenre(genre);
      expect(scales, genre).not.toBeNull();
      for (const sc of scales!) expect(inDB.has(sc), `${genre} ${sc}`).toBe(true);
    }
    expect(Object.keys(genreScales).sort()).toEqual(Object.keys(table).sort());
  });

  it("どのジャンル×雰囲気も、合うスケールの候補（表＋タグ）が3件以上ある", () => {
    for (const [genre, moods] of Object.entries(table)) {
      for (const [mood, entry] of Object.entries(moods)) {
        const scales = scalesForGenre(genre)!;
        const fit = chords.filter(c => (entry.chord_ids.includes(c.id) || (c.genre.includes(genre) && c.mood.includes(mood)))
          && scales.includes(c.base_scale));
        expect(fit.length, `${genre} ${mood}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("シンプルモードの生成・差し替えは、ジャンルに合うスケールの進行だけを選ぶ", () => {
    let seed = 1;
    for (const [genre, moods] of Object.entries(table)) {
      const scales = scalesForGenre(genre)!;
      for (const mood of Object.keys(moods)) {
        for (let i = 0; i < 15; i++) {
          Math.random = seededRandom(seed++);
          const { chordPattern } = resolveSimpleMode(genre, mood);
          expect(scales, `${genre} ${mood} ${chordPattern.id}`).toContain(chordPattern.base_scale);
          const next = rerollChord(genre, mood, chordPattern.id);
          expect(scales, `${genre} ${mood} 差し替え ${next.id}`).toContain(next.base_scale);
        }
      }
    }
  });

  it("合うスケールの候補がなければ絞らない（原則）", () => {
    const list = [{ base_scale: "major" }, { base_scale: "minor" }];
    expect(preferGenreScales(list, "ハウス")).toEqual(list);
    expect(preferGenreScales(list, "EDM")).toEqual([{ base_scale: "minor" }]);
    expect(preferGenreScales(list, "未知のジャンル")).toEqual(list);
  });
});

describe("9th・sus・aug7 のコード", () => {
  it("1オクターブを超える音も正しい高さになる", () => {
    expect(resolveChord("I", "maj9", 0, "C", "major", 4).notes).toEqual(["C4", "E4", "G4", "B4", "D5"]);
    expect(resolveChord("V", "dom9", 0, "C", "major", 4).notes).toEqual(["G4", "B4", "D5", "F5", "A5"]);
    expect(resolveChord("II", "sus4", 0, "C", "major_pentatonic", 4).notes).toEqual(["D4", "G4", "A4"]);
    expect(resolveChord("II", "aug7", 0, "C", "whole_tone", 4).notes).toEqual(["D4", "F#4", "A#4", "C5"]);
  });
});
