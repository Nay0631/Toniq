import { describe, it, expect } from "vitest";
import {
  resolveChord, voiceProgression, VOICING_RANGES, noteToMidi, midiToNote, scaleSemitones,
} from "../src/data/degree_resolver";
import { chords, chordById } from "./helpers";

const pcs = (notes: string[]) => notes.map(n => noteToMidi(n) % 12);

describe("resolveChord（ディグリー → 実音）", () => {
  it("キー A のマイナーで Im は A・C・E", () => {
    const c = resolveChord("Im", "minor", 0, "A", "minor", 4);
    expect(c.root).toBe("A");
    expect(c.notes).toEqual(["A4", "C5", "E5"]);
    expect(c.bass_note).toBe("A3");
  });

  it("キー C のメジャーで IV・V・VIm", () => {
    expect(resolveChord("IV", "major", 0, "C", "major", 4).notes).toEqual(["F4", "A4", "C5"]);
    expect(resolveChord("V", "major", 0, "C", "major", 4).notes).toEqual(["G4", "B4", "D5"]);
    expect(resolveChord("VIm", "minor", 0, "C", "major", 4).notes).toEqual(["A4", "C5", "E5"]);
  });

  it("フラットのディグリー（bVI・bII）と7th", () => {
    expect(pcs(resolveChord("bVI", "maj7", 0, "A", "minor", 4).notes)).toEqual([5, 9, 0, 4]);  // F A C E
    expect(pcs(resolveChord("bII", "major", 0, "E", "phrygian", 4).notes)).toEqual([5, 9, 0]);  // F A C
    expect(pcs(resolveChord("V", "dom7", 0, "C", "major", 4).notes)).toEqual([7, 11, 2, 5]);   // G B D F
  });

  it("転回形は下の音をオクターブ上へ回す", () => {
    expect(resolveChord("I", "major", 1, "C", "major", 4).notes).toEqual(["E4", "G4", "C5"]);
    expect(resolveChord("I", "major", 2, "C", "major", 4).notes).toEqual(["G4", "C5", "E5"]);
  });

  it("未定義のキー・スケール・ディグリー・種類は例外", () => {
    expect(() => resolveChord("I", "major", 0, "H", "major", 4)).toThrow(/Unknown key/);
    expect(() => resolveChord("I", "major", 0, "C", "lydian", 4)).toThrow(/Unknown scale/);
    expect(() => resolveChord("bII", "major", 0, "C", "major", 4)).toThrow(/Unknown degree/);
    expect(() => resolveChord("I", "sus4", 0, "C", "major", 4)).toThrow(/Unknown chord type/);
  });

  it("コード進行DB の全進行が、12 のキーすべてで実音にできる", () => {
    for (const key of ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]) {
      for (const c of chords) {
        for (const d of c.progression) {
          expect(() => resolveChord(d.degree, d.type, d.inversion, key, c.base_scale, 4), `${c.id} ${d.degree} in ${key}`).not.toThrow();
        }
      }
    }
  });
});

describe("noteToMidi / midiToNote", () => {
  it("往復で同じになる", () => {
    for (let m = 21; m <= 108; m++) expect(noteToMidi(midiToNote(m))).toBe(m);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("C4")).toBe(60);
  });
});

describe("scaleSemitones", () => {
  it("スケールの7音を低い順に返す（未定義はマイナー）", () => {
    expect(scaleSemitones("major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleSemitones("minor")).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(scaleSemitones("unknown")).toEqual(scaleSemitones("minor"));
  });
});

describe("voiceProgression（ボイシング）", () => {
  const movement = (a: number[], b: number[]) => {
    const near = (from: number[], to: number[]) => from.reduce((s, n) => s + Math.min(...to.map(m => Math.abs(n - m))), 0);
    return near(a, b) + near(b, a);
  };

  it("各コードの構成音は変えず、最低音を範囲に収める", () => {
    for (const [name, range] of Object.entries(VOICING_RANGES)) {
      for (const c of chords) {
        const voiced = voiceProgression(c, "A", range);
        expect(voiced).toHaveLength(c.progression.length);
        voiced.forEach((notes, i) => {
          const d = c.progression[i];
          const expected = pcs(resolveChord(d.degree, d.type, 0, "A", c.base_scale, 4).notes).sort();
          expect([...pcs(notes)].sort(), `${c.id} ${name}`).toEqual(expected);
          const low = Math.min(...notes.map(noteToMidi));
          expect(low, `${c.id} ${name} の最低音`).toBeGreaterThanOrEqual(range.low);
          expect(low, `${c.id} ${name} の最低音`).toBeLessThanOrEqual(range.high);
        });
      }
    }
  });

  it("基本形のまま並べるより、コードの間の動きが小さい（ループの継ぎ目も含めた1周で比べる）", () => {
    for (const c of chords) {
      const voiced = voiceProgression(c, "C", VOICING_RANGES.chord).map(v => v.map(noteToMidi));
      // 比べる相手：転回せず、根音を範囲に入れただけの並べ方
      const plain = c.progression.map(d => {
        const notes = resolveChord(d.degree, d.type, 0, "C", c.base_scale, 4).notes.map(noteToMidi);
        const shift = Math.ceil((VOICING_RANGES.chord.low - notes[0]) / 12) * 12;
        return notes.map(n => n + shift);
      });
      // 最後のコード → 最初のコード（ループの継ぎ目）も数える
      const total = (list: number[][]) => list.reduce((s, v, i) => s + movement(list[(i + list.length - 1) % list.length], v), 0);
      expect(total(voiced), c.id).toBeLessThanOrEqual(total(plain));
    }
  });

  it("spread（開離配置）は下から2番目の音を1オクターブ上げる", () => {
    const c = chordById("chord_003");  // I IV V I
    const close  = voiceProgression(c, "C", VOICING_RANGES.pad).map(v => v.map(noteToMidi));
    const spread = voiceProgression(c, "C", VOICING_RANGES.pad, { spread: true }).map(v => v.map(noteToMidi));
    spread.forEach((v, i) => {
      const expected = [...close[i]];
      expected[1] += 12;
      expect(v).toEqual(expected.sort((a, b) => a - b));
    });
  });
});
