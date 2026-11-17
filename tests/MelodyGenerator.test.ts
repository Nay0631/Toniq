import { describe, it, expect, afterEach } from "vitest";
import {
  generateMelody, noteToMidi, timeToUnits, durationToUnits, unitsToDuration, unitsToTime, MelodyNote, JUMP_LIMIT, accentsPerBar,
} from "../src/engine/MelodyGenerator";
import { resolveChord, NOTE_INDEX, SCALE_TONES } from "../src/data/degree_resolver";
import melodyParams from "../src/data/melody_params.json";
import { chords, chordById, seededRandom } from "./helpers";

type Param = { rhythmPatterns: string[]; chorusRhythmPatterns?: string[]; octaveRange: number[]; pitchLimit?: number };
const params = melodyParams as unknown as Record<string, Param>;
const GENRES = Object.keys(params);
const random = Math.random;
afterEach(() => { Math.random = random; });

function withSeed<T>(seed: number, fn: () => T): T {
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = random; }
}

const sounding = (notes: MelodyNote[]) => notes
  .filter((n): n is MelodyNote & { note: string } => n.note !== null)
  .map(n => ({ midi: noteToMidi(n.note), start: timeToUnits(n.time), units: durationToUnits(n.duration) }));

describe("音価・時刻の表記", () => {
  it("16分音符単位と往復で同じになる", () => {
    for (let u = 1; u <= 32; u++) expect(durationToUnits(unitsToDuration(u))).toBe(u);
    for (let u = 0; u < 64; u++) expect(timeToUnits(unitsToTime(u))).toBe(u);
    expect(unitsToDuration(4)).toBe("4n");
    expect(unitsToDuration(6)).toBe("4n.");
  });
});

describe("generateMelody", () => {
  it("同じシードなら同じメロディになる", () => {
    const prog = chordById("chord_001");
    const a = withSeed(42, () => generateMelody(prog, "A", "EDM"));
    const b = withSeed(42, () => generateMelody(prog, "A", "EDM"));
    const c = withSeed(43, () => generateMelody(prog, "A", "EDM"));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  // 全ジャンル × その進行 × A / サビ で、メロディの形の決まりを確かめる
  const cases = GENRES.flatMap(genre =>
    chords.filter(c => c.genre.includes(genre)).flatMap(c => (["A", "B"] as const).map(section => ({ genre, c, section }))));

  it.each(cases.map(x => [x.genre, x.c.id, x.section, x] as const))("%s %s（%s）：時間の並び・音域・終わりの音", (_g, _id, _s, { genre, c, section }) => {
    for (let seed = 1; seed <= 5; seed++) {
      const key = ["C", "E", "G", "A#"][seed % 4];
      const notes = withSeed(seed, () => generateMelody(c, key, genre, { section }));
      const total = c.length_bars * 16;

      // 休符も含めて、隙間・重なりなく進行の長さちょうどを埋める
      let cursor = 0;
      for (const n of notes) {
        expect(timeToUnits(n.time)).toBe(cursor);
        cursor += durationToUnits(n.duration);
      }
      expect(cursor).toBe(total);

      const played = sounding(notes);
      expect(played.length).toBeGreaterThan(0);

      // 音域：ジャンルの octaveRange のスケール音の範囲（下のオクターブの頭〜上のオクターブの終わり）
      const [lo, hi] = params[genre].octaveRange;
      for (const n of played) {
        expect(n.midi).toBeGreaterThanOrEqual((lo + 1) * 12);
        expect(n.midi).toBeLessThan((hi + 2) * 12);
      }

      // スケールの外の音は使わない
      const tones = SCALE_TONES[c.base_scale] ?? SCALE_TONES.minor;
      const allowed = new Set([...tones.core, ...Object.keys(tones.accent).map(Number)]);
      const root = NOTE_INDEX[key];
      for (const n of played) expect(allowed.has(((n.midi - root) % 12 + 12) % 12)).toBe(true);

      // 最後の音は主音か、そのときのコードの構成音（言い切って終わる）
      const last = played[played.length - 1];
      const chord = c.progression.find(d => last.start >= (d.bar - 1) * 16 && last.start < (d.bar - 1 + d.duration_bars) * 16)!;
      const chordPcs = resolveChord(chord.degree, chord.type, chord.inversion, key, c.base_scale, 4).notes.map(n => noteToMidi(n) % 12);
      expect(last.midi % 12 === root || chordPcs.includes(last.midi % 12)).toBe(true);
    }
  });

  it("サビは chorusRhythmPatterns のリズムで作る（Aメロは rhythmPatterns）", () => {
    const onsets = (pattern: string) => [...pattern].flatMap((ch, i) => ch === "x" ? [i] : []).join(",");
    for (const genre of GENRES) {
      const p = params[genre];
      if (!p.chorusRhythmPatterns) continue;
      const pools = { A: new Set(p.rhythmPatterns.map(onsets)), B: new Set(p.chorusRhythmPatterns.map(onsets)) };
      const prog = chords.find(c => c.genre.includes(genre) && c.length_bars === 4)!;
      for (const section of ["A", "B"] as const) {
        for (let seed = 1; seed <= 10; seed++) {
          const played = sounding(withSeed(seed, () => generateMelody(prog, "C", genre, { section })));
          for (let bar = 0; bar < prog.length_bars; bar++) {
            const bar16 = played.filter(n => Math.floor(n.start / 16) === bar).map(n => n.start % 16).join(",");
            // 発音の位置は選んだリズムのまま（終止で音を伸ばすことはあるが、発音の位置は変えない）
            expect(pools[section].has(bar16), `${genre} ${section} 小節${bar + 1}: ${bar16}`).toBe(true);
          }
        }
      }
    }
  });

  it("prevNote を渡すと、最初の音をその近くに置く", () => {
    const prog = chordById("chord_003");
    for (let seed = 1; seed <= 20; seed++) {
      const first = sounding(withSeed(seed, () => generateMelody(prog, "C", "ゲームBGM", { section: "B", prevNote: 72 })))[0];
      expect(Math.abs(first.midi - 72)).toBeLessThanOrEqual(12);
    }
  });
});

describe("基本の5音と外す音", () => {
  const degree = (midi: number, key: string) => ((midi - NOTE_INDEX[key]) % 12 + 12) % 12;
  const free = GENRES.filter(g => !params[g].pitchLimit);

  it.each(free)("%s：基本の5音で作り、音が3つ以上の小節はほぼ必ず外す音（accent）を1つ以上入れる", genre => {
    let bars = 0, withAccent = 0;
    let seed = 1;
    for (const prog of chords.filter(c => c.genre.includes(genre))) {
      for (const section of ["A", "B"] as const) {
        const key = ["C", "F#", "A"][seed % 3];
        const played = sounding(withSeed(seed++, () => generateMelody(prog, key, genre, { section })));
        const tones = SCALE_TONES[prog.base_scale];
        const accents = Object.keys(tones.accent).map(Number);
        for (const n of played) expect([...tones.core, ...accents]).toContain(degree(n.midi, key));
        if (accents.length === 0) continue;  // 外す音のないスケール（メジャーペンタトニック・全音音階）
        // 終止のある最後の小節は数えない
        for (let bar = 0; bar < prog.length_bars - 1; bar++) {
          const inBar = played.filter(n => Math.floor(n.start / 16) === bar);
          if (inBar.length < 3) continue;
          bars++;
          if (inBar.some(n => accents.includes(degree(n.midi, key)))) withAccent++;
        }
      }
    }
    if (bars > 0) expect(withAccent / bars, `${genre} ${withAccent}/${bars}`).toBeGreaterThan(0.95);
  });

  it("1小節で外す回数は小節の音の数で決める", () => {
    expect([1, 2, 3, 4, 7, 8].map(accentsPerBar)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it("同じ音の連続も使う", () => {
    let repeats = 0;
    for (const genre of free) {
      const played = sounding(withSeed(3, () => generateMelody(chordById("chord_001"), "C", genre)));
      for (let i = 1; i < played.length; i++) if (played[i].midi === played[i - 1].midi) repeats++;
    }
    expect(repeats).toBeGreaterThan(0);
  });
});

describe("使う音の数の上限（pitchLimit。テクノ）", () => {
  it("Aメロは主音を含む2音だけで作り、サビは同じ音名でAメロより高く作る", () => {
    const genre = GENRES.find(g => params[g].pitchLimit === 2)!;
    for (const prog of chords.filter(c => c.genre.includes(genre))) {
      for (let seed = 1; seed <= 3; seed++) {
        const verse = sounding(withSeed(seed, () => generateMelody(prog, "D", genre, { section: "A" })));
        const pcs = [...new Set(verse.map(n => n.midi % 12))];
        expect(new Set(verse.map(n => n.midi)).size).toBeLessThanOrEqual(2);
        expect(pcs).toContain(NOTE_INDEX.D);
        const chorus = sounding(withSeed(seed, () => generateMelody(prog, "D", genre, { section: "B", pitchClasses: pcs })));
        expect(new Set(chorus.map(n => n.midi % 12))).toEqual(new Set(pcs));
        expect(new Set(chorus.map(n => n.midi)).size).toBeLessThanOrEqual(2);
        const avg = (s: { midi: number }[]) => s.reduce((a, n) => a + n.midi, 0) / s.length;
        if (pcs.length === 2) expect(avg(chorus)).toBeGreaterThan(avg(verse));
      }
    }
  });
});

describe("跳躍（JUMP_LIMIT）", () => {
  // 続けて鳴る音（間の休符が1拍未満）の跳躍のうち、JUMP_LIMIT を超えるものの数。ループの継ぎ目（最後 → 最初）も数える
  function bigLeaps(notes: MelodyNote[], totalUnits: number): number {
    const s = sounding(notes);
    let count = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i].start - (s[i - 1].start + s[i - 1].units) >= 4) continue;
      if (Math.abs(s[i].midi - s[i - 1].midi) > JUMP_LIMIT) count++;
    }
    const last = s[s.length - 1];
    if (totalUnits - (last.start + last.units) + s[0].start < 4 && Math.abs(last.midi - s[0].midi) > JUMP_LIMIT) count++;
    return count;
  }

  it.each(GENRES)("%s：Aメロ・サビとも、ループの継ぎ目を含めて大きな跳躍がほとんどない", genre => {
    let melodies = 0, withLeap = 0;
    for (const prog of chords.filter((_, i) => i % 5 === 0)) {
      for (const section of ["A", "B"] as const) {
        const notes = withSeed(melodies + 1, () => generateMelody(prog, "C", genre, { section }));
        melodies++;
        if (bigLeaps(notes, prog.length_bars * 16) > 0) withLeap++;
      }
    }
    // 小節の一部をオクターブ動かして直すので、直しきれないのは 1 割未満
    expect(withLeap / melodies, `${genre} ${withLeap}/${melodies}`).toBeLessThan(0.1);
  });

  it("nextNote（サビのあとの Aメロの最初の音）を渡すと、サビの最後の音がそこへ近づく", () => {
    const prog = chordById("chord_001");
    const distance = (nextNote?: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const s = sounding(withSeed(seed, () => generateMelody(prog, "A", "トランス", { section: "B", prevNote: 69, nextNote })));
        sum += Math.abs(s[s.length - 1].midi - 64);
      }
      return sum / 50;
    };
    expect(distance(64)).toBeLessThan(distance(undefined) - 1);
  });
});
