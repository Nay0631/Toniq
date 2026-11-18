import { describe, it, expect, beforeEach, vi } from "vitest";

// 音を出す部分（Web Audio）・保存は使わないので外す。保存は書き出した MIDI を受け取って中身を調べる
vi.mock("../src/engine/VolumeManager", () => ({ createVolumeNode: vi.fn() }));
vi.mock("../src/engine/Grow", () => ({
  GrowInstrument: vi.fn(), growValues: vi.fn(), isGrowReady: () => false,
  findGrowPreset: vi.fn(), growPresetValuesWith: vi.fn(),
}));
vi.mock("../src/engine/SynthFactory", () => ({ createDrumKit: vi.fn(), createPercKit: vi.fn() }));
vi.mock("../src/engine/OutputFiles", () => ({ saveOutput: vi.fn() }));

import { Midi } from "@tonejs/midi";
import {
  METERS, Meter, beatsPerBar, unitsPerBar, unitsPerBeat, isStrongUnit, stepSubdivision,
  fitPattern, gridStep, gridSteps, barUnits, unitTime, barTime,
  unitsToTime, timeToUnits, unitsToDuration, durationToUnits, durationToBeats, convertNotes, genreMeter,
} from "../src/engine/Meter";
import { generateBatchSong } from "../src/engine/QualityBatch";
import { getState, setState } from "../src/engine/AppState";
import { setArrangementBypass } from "../src/engine/LoopArranger";
import { generateMelody, MelodyNote } from "../src/engine/MelodyGenerator";
import { generateSongMelodies, songMelody, songProgression } from "../src/engine/SongForm";
import { bassNotes } from "../src/engine/BassPlayer";
import { chordEvents } from "../src/engine/ChordPlayer";
import { padEvents } from "../src/engine/PadPlayer";
import { arpNotes } from "../src/engine/ArpPlayer";
import { counterNotes } from "../src/engine/CounterPlayer";
import { percStepHits } from "../src/engine/PercPlayer";
import { customDrumPattern, drumPatternBars, drumPatternIn, drumStepHits, withDrumHit } from "../src/engine/DrumEngine";
import { exportMidi } from "../src/engine/MidiExporter";
import { saveOutput } from "../src/engine/OutputFiles";
import { songMetrics, QUALITY_RULES, STRONG_CLASH_LIMIT, MelodyMetrics } from "../src/engine/QualityCheck";
import type { ChordProgression } from "../src/data/types";
import { chords, drums, resetState, seededRandom } from "./helpers";

const GENRES = ["EDM", "8bit", "ローファイ", "ゲームBGM", "テクノ", "ハウス", "トランス", "アンビエント", "ワルツ", "6/8バラード"];
const OTHER_METERS: Meter[] = ["3/4", "4/4t"];

beforeEach(() => {
  resetState();
  setArrangementBypass(false);
  vi.mocked(saveOutput).mockReset();
});

function partnerOf(base: ChordProgression): ChordProgression {
  return chords.find(c => c.id !== base.id && c.length_bars === base.length_bars && c.base_scale === base.base_scale)!;
}

// 拍子 meter・ジャンル genre の 32 小節の曲（メロディも作る）
function song(meter: Meter, genre = "EDM", length = 4): ChordProgression {
  const base = chords.find(c => c.length_bars === length)!;
  setState({
    meter, genre, key: "A", chordPattern: base, chorusPattern: partnerOf(base),
    drumPattern: drums[0], bars: 32, sections: null, arrangeEdits: [],
  });
  const random = Math.random;
  Math.random = seededRandom(7);
  try {
    setState(generateSongMelodies());
  } finally {
    Math.random = random;
  }
  return base;
}

describe("1小節のマスの数え方", () => {
  it("4/4 = 16 マス、3/4 = 12 マス、4/4 の3連符 = 12 マス", () => {
    expect(METERS).toEqual(["4/4", "3/4", "4/4t"]);
    expect([beatsPerBar("4/4"), unitsPerBeat("4/4"), unitsPerBar("4/4")]).toEqual([4, 4, 16]);
    expect([beatsPerBar("3/4"), unitsPerBeat("3/4"), unitsPerBar("3/4")]).toEqual([3, 4, 12]);
    expect([beatsPerBar("4/4t"), unitsPerBeat("4/4t"), unitsPerBar("4/4t")]).toEqual([4, 3, 12]);
    expect(stepSubdivision("3/4")).toBe("16n");
    expect(stepSubdivision("4/4t")).toBe("8t");
  });

  it("引数を省くと今の曲の拍子（知らない値は 4/4）", () => {
    expect(unitsPerBar()).toBe(16);
    setState({ meter: "3/4" });
    expect(unitsPerBar()).toBe(12);
    setState({ meter: "5/4" as Meter });
    expect(unitsPerBar()).toBe(16);
  });

  it("強拍：4/4 は1・3拍目、3/4 は1拍目だけ", () => {
    expect([0, 4, 8, 12, 16].map(u => isStrongUnit(u, "4/4"))).toEqual([true, false, true, false, true]);
    expect([0, 4, 8, 12].map(u => isStrongUnit(u, "3/4"))).toEqual([true, false, false, true]);
    expect([0, 3, 6, 9, 12].map(u => isStrongUnit(u, "4/4t"))).toEqual([true, false, true, false, true]);
  });

  it("Tone.js の時刻：3連符の 1 マスは 16分音符 4/3 個分", () => {
    expect(unitTime(6, "4/4")).toBe("0:0:6");
    expect(unitTime(6, "3/4")).toBe("0:0:6");
    expect(unitTime(3, "4/4t")).toBe("0:0:4");  // 3 マス = 1拍
    expect(barTime(2, 3, "4/4t")).toBe("2:0:4");
  });
});

describe("16 ステップのパターンを今の拍子のマスに直す", () => {
  it("4/4 はそのまま", () => {
    expect(fitPattern("x---..x-x.x.xxxx", "4/4")).toBe("x---..x-x.x.xxxx");
  });

  it("3/4 は頭の3拍（fromEnd なら終わりの3拍）", () => {
    expect(fitPattern("x---..x-x.x.xxxx", "3/4")).toBe("x---..x-x.x.");
    expect(fitPattern("........x.x.xxxx", "3/4", true)).toBe("....x.x.xxxx");
  });

  it("3連符は拍ごとに 4 つ → 3 つ。8分の裏は3つ目（シャッフル）、発音は伸ばす・休みより優先", () => {
    expect(fitPattern("x.x.x.x.x.x.x.x.", "4/4t")).toBe("x.xx.xx.xx.x");   // 8分 → シャッフル
    expect(fitPattern("xxxxxxxxxxxxxxxx", "4/4t")).toBe("xxxxxxxxxxxx");   // 16分 → 3連符
    expect(fitPattern("x---x--x...x.x..", "4/4t")).toBe("x--x-x..x.x.");   // 4つ目だけ鳴る所は3つ目に寄せる
  });

  it("ステップの位置：3/4 の4拍目は鳴らさない、3連符は 3・4 つ目が同じマスになる", () => {
    expect([0, 4, 11, 12, 15].map(s => gridStep(s, "3/4"))).toEqual([0, 4, 11, null, null]);
    expect([0, 1, 2, 3, 4, 14, 15].map(s => gridStep(s, "4/4t"))).toEqual([0, 1, 2, 2, 3, 11, 11]);
    expect(gridSteps([2, 6, 10, 14], "3/4")).toEqual([2, 6, 10]);
    expect(gridSteps([0, 3, 6, 10, 12], "4/4t")).toEqual([0, 2, 5, 8, 9]);
  });

  it("刻みで鳴らすマス：3連符の8分は1つ目と3つ目", () => {
    expect(barUnits("4n", "3/4")).toEqual([0, 4, 8]);
    expect(barUnits("8n", "4/4")).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(barUnits("8n", "4/4t")).toEqual([0, 2, 3, 5, 6, 8, 9, 11]);
    expect(barUnits("16n", "4/4t")).toHaveLength(12);
  });
});

describe("位置・長さの文字列とマスの数", () => {
  it("4/4 は今までと同じ表記", () => {
    expect(unitsToTime(21, "4/4")).toBe("1:1:1");
    expect(timeToUnits("1:1:1", "4/4")).toBe(21);
    expect(unitsToDuration(6, "4/4")).toBe("4n.");
    expect(unitsToDuration(5, "4/4")).toBe("0:1:1");
    expect(durationToUnits("0:1:1", "4/4")).toBe(5);
    expect(durationToUnits("1n", "4/4")).toBe(16);
  });

  it.each(METERS)("%s：マス → 文字列 → マスで元に戻る", meter => {
    for (let u = 0; u < unitsPerBar(meter) * 3; u++) {
      expect(timeToUnits(unitsToTime(u, meter), meter), `位置 ${u}`).toBe(u);
    }
    for (let u = 1; u <= unitsPerBar(meter) * 2; u++) {
      expect(durationToUnits(unitsToDuration(u, meter), meter), `長さ ${u}`).toBe(u);
    }
  });

  it("3/4 の小節は 12 マス、3連符は1拍 3 マス", () => {
    expect(unitsToTime(12, "3/4")).toBe("1:0:0");
    expect(unitsToTime(13, "3/4")).toBe("1:0:1");
    expect(timeToUnits("0:1:0", "4/4t")).toBe(3);
    expect(unitsToDuration(1, "4/4t")).toBe("8t");
    expect(unitsToDuration(3, "4/4t")).toBe("4n");
    expect(durationToBeats("8t")).toBeCloseTo(1 / 3);
  });
});

describe("convertNotes（拍子を変えたときのメロディの置き直し）", () => {
  const n = (note: string | null, time: string, duration: string): MelodyNote => ({ note, time, duration });

  it("4/4 → 3/4：小節と拍の位置を保ち、4拍目の音と休符は落とす", () => {
    const notes = [n("A4", "0:0:0", "4n"), n(null, "0:1:0", "4n"), n("C5", "0:2:2", "8n"), n("E5", "0:3:0", "4n"), n("G4", "1:0:0", "2n")];
    expect(convertNotes(notes, "4/4", "3/4")).toEqual([
      n("A4", "0:0:0", "4n"), n("C5", "0:2:2", "8n"), n("G4", "1:0:0", "2n"),
    ]);
  });

  it("4/4 → 3連符：いちばん近いマスに寄せ、重なった音は先のものを残して次の音の手前で切る", () => {
    const notes = [n("A4", "0:0:0", "8n"), n("B4", "0:0:2", "16n"), n("C5", "0:0:3", "16n"), n("D5", "0:1:0", "2n")];
    const out = convertNotes(notes, "4/4", "4/4t");
    // 8分の裏（0:0:2）は3連符の3つ目。16分の4つ目（0:0:3）も同じマスに寄るので、先の B4 を残して C5 は落とす
    expect(out.map(x => [x.note, timeToUnits(x.time, "4/4t"), durationToUnits(x.duration, "4/4t")])).toEqual([
      ["A4", 0, 2], ["B4", 2, 1], ["D5", 3, 6],
    ]);
  });

  it("同じ拍子ならそのまま", () => {
    const notes = [n("A4", "0:0:0", "4n")];
    expect(convertNotes(notes, "3/4", "3/4")).toBe(notes);
  });
});

describe.each(OTHER_METERS)("%s の曲：各パートが小節のマスに収まる", meter => {
  it.each(GENRES)("%s：メロディ・コード・ベース・アルペジオ・パッド・カウンターメロディ", genre => {
    const base = song(meter, genre);
    const BAR = unitsPerBar();
    expect(BAR).toBe(12);

    // メロディ（コード進行1周）：音があり、1周の長さに収まる
    const loop = getState().melodyNotes.filter(x => x.note !== null);
    expect(loop.length, "Aメロの音の数").toBeGreaterThan(0);
    for (const x of loop) {
      const start = timeToUnits(x.time);
      expect(start).toBeLessThan(base.length_bars * BAR);
      expect(start + durationToUnits(x.duration)).toBeLessThanOrEqual(base.length_bars * BAR);
    }

    const p = songProgression()!;
    const total = p.length_bars * BAR;
    const melody = songMelody();
    const check = (name: string, list: { sixteenth: number; length?: number }[]) => {
      expect(list.length, `${name} の音の数`).toBeGreaterThan(0);
      for (const h of list) {
        expect(Number.isInteger(h.sixteenth), `${name} の位置 ${h.sixteenth}`).toBe(true);
        expect(h.sixteenth, name).toBeGreaterThanOrEqual(0);
        expect(h.sixteenth + (h.length ?? 1), name).toBeLessThanOrEqual(total);
      }
    };
    check("コード", chordEvents(p, "A"));
    check("パッド", padEvents(p, "A"));
    check("ベース", bassNotes(p, "A"));
    check("アルペジオ", arpNotes(p, "A"));
    const counter = counterNotes(p, melody, "A");
    for (const c of counter) {
      expect(c.sixteenth + c.length, "カウンターメロディ").toBeLessThanOrEqual(total);
      expect(c.length).toBeGreaterThan(0);
    }
  });

  it("コードのリズム：刻むとコードの長さをすき間なく埋める", () => {
    song(meter);
    const p = songProgression()!;
    for (const rhythm of ["half", "quarter", "eighth"] as const) {
      setState({ chordRhythm: rhythm });
      const hits = chordEvents(p, "A").filter(h => h.sixteenth < 12 * 4);
      const covered = hits.reduce((sum, h) => sum + h.length, 0);
      expect(covered, rhythm).toBe(12 * 4);
    }
  });

  it("ドラム・パーカッション：DB の 16 ステップのパターンを 12 マスで鳴らす", () => {
    song(meter, "ハウス");
    let drumHits = 0, percHits = 0;
    for (let bar = 0; bar < 8; bar++) {
      for (let step = 0; step < 12; step++) {
        drumHits += drumStepHits(drums[0], bar, step).length;
        percHits += percStepHits(bar, step).length;
      }
    }
    expect(drumHits).toBeGreaterThan(8 * 4);
    expect(percHits).toBeGreaterThan(0);
    // 1拍目の頭のキックは残る
    expect(drumStepHits(drums[0], 0, 0).some(h => h.name === "kick")).toBe(true);
  });

  it("フィルの小節では、フィルの音が小節の終わりに鳴る", () => {
    song(meter, "EDM");
    // 4 小節の進行：サビの前（3 周目がサビ）の小節 7 は大きいフィル
    const hits = Array.from({ length: 12 }, (_, step) => drumStepHits(drums[0], 7, step));
    expect(hits[11].some(h => h.name === "snare")).toBe(true);
  });

  it("オリジナルのドラムは今の拍子のマス（1小節 12）で作り、そのまま鳴る", () => {
    song(meter);
    const custom = customDrumPattern(drums[0], 2);
    expect(custom.steps).toBe(24);
    expect(custom.meter).toBe(meter);
    expect(drumPatternBars(custom)).toBe(2);
    expect(drumPatternIn(custom)).toBe(custom);  // 同じ拍子なら直さない
    const edited = withDrumHit(customDrumPattern(null, 1), "rim", 7, 0.5);
    setState({ drumPattern: edited, drumFill: false, endingEnabled: false });
    expect(drumStepHits(edited, 3, 7)).toEqual([{ name: "rim", velocity: 0.5 }]);
    expect(drumStepHits(edited, 3, 6)).toEqual([]);
  });

  it("MIDI書き出し：拍子と曲の長さが合う", async () => {
    song(meter);
    await exportMidi("test.mid");
    const blob = vi.mocked(saveOutput).mock.calls[0][1] as Blob;
    const midi = new Midi(new Uint8Array(await blob.arrayBuffer()));
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([beatsPerBar(), 4]);
    const end = 32 * beatsPerBar() * midi.header.ppq;
    expect(midi.tracks.length).toBeGreaterThan(4);
    for (const track of midi.tracks) {
      for (const note of track.notes) expect(note.ticks, track.name).toBeLessThan(end);
    }
    // 3連符の拍子：メロディ・ベースの音は3連符のマス（1拍の 1/3）に乗る
    if (meter === "4/4t") {
      const unit = midi.header.ppq / 3;
      for (const name of ["Melody", "Bass"]) {
        const track = midi.tracks.find(t => t.name === name)!;
        for (const note of track.notes) expect(note.ticks % unit, name).toBe(0);
      }
    }
  });

  it("自動チェックが動く（強拍は拍子の強拍で数える）", () => {
    song(meter);
    const m = songMetrics().melody!;
    expect(m.strongTotal).toBeGreaterThan(0);
    expect(m.strongFit + m.strongClash).toBeLessThanOrEqual(m.strongTotal);
  });
});

describe("オリジナルのドラムを別の拍子に持っていく", () => {
  it("4/4 → 3/4 は頭の3拍、4/4 → 3連符は拍ごとに 4 つ → 3 つ", () => {
    const four = withDrumHit(withDrumHit(withDrumHit(customDrumPattern(null, 1), "kick", 0, 1), "snare", 6, 0.8), "kick", 14, 0.7);
    const three = drumPatternIn(four, "3/4");
    expect(three.steps).toBe(12);
    expect(three.meter).toBe("3/4");
    expect(three.tracks.kick.pattern.filter(Boolean)).toHaveLength(1);  // 4拍目のキックはなくなる
    expect(three.tracks.snare.velocity[6]).toBe(0.8);

    const triplet = drumPatternIn(four, "4/4t");
    expect(triplet.steps).toBe(12);
    expect(triplet.tracks.snare.pattern[5]).toBe(1);   // 2拍目の裏（8分）→ 3連符の3つ目
    expect(triplet.tracks.kick.pattern[11]).toBe(1);   // 4拍目の裏
    expect(drumPatternIn(four, "3/4")).toBe(three);    // 同じパターンは覚えておいたものを返す
  });

  it("3/4 → 4/4 は4拍目を空にして戻す", () => {
    setState({ meter: "3/4" });
    const three = withDrumHit(customDrumPattern(null, 1), "kick", 8, 1);
    const four = drumPatternIn(three, "4/4");
    expect(four.steps).toBe(16);
    expect(four.meter).toBeUndefined();
    expect(four.tracks.kick.pattern.indexOf(1)).toBe(8);
  });
});

describe("メロディ生成（3/4）", () => {
  it("頭の3拍に音がないリズムは選ばない（空の小節だらけにならない）", () => {
    setState({ meter: "3/4" });
    const base = chords.find(c => c.length_bars === 4)!;
    const random = Math.random;
    try {
      for (const genre of GENRES) {
        for (let seed = 1; seed <= 20; seed++) {
          Math.random = seededRandom(seed);
          const notes = generateMelody(base, "C", genre).filter(x => x.note !== null);
          const bars = new Set(notes.map(x => Math.floor(timeToUnits(x.time) / 12)));
          expect(bars.size, `${genre} seed ${seed}`).toBe(4);
        }
      }
    } finally {
      Math.random = random;
    }
  });
});

describe("ジャンルの標準の拍子", () => {
  it("ワルツは 3/4、6/8バラードは 4/4 の3連符、ほかのジャンルと知らないジャンルは 4/4", () => {
    expect(genreMeter("ワルツ")).toBe("3/4");
    expect(genreMeter("6/8バラード")).toBe("4/4t");
    GENRES.filter(g => g !== "ワルツ" && g !== "6/8バラード").forEach(g => expect(genreMeter(g), g).toBe("4/4"));
    expect(genreMeter("知らないジャンル")).toBe("4/4");
  });

  it("一括計測（シンプルモードの生成と同じ手順）はジャンルの拍子で曲を作り、メロディは頭の拍から鳴る", () => {
    const cases: [string, string, Meter][] = [["ワルツ", "明るい", "3/4"], ["6/8バラード", "切ない", "4/4t"], ["EDM", "明るい", "4/4"]];
    for (const [genre, mood, meter] of cases) {
      generateBatchSong(1, genre, mood, 0);
      expect(getState().meter, genre).toBe(meter);
      const units = getState().melodyNotes.filter(n => n.note !== null).map(n => timeToUnits(n.time));
      expect(units.length, genre).toBeGreaterThan(0);
      expect(Math.max(...units), genre).toBeLessThan(getState().chordPattern!.length_bars * unitsPerBar(meter));
    }
  });
});

describe("自動チェック：強拍の基準", () => {
  const metrics = (strongFit: number, strongClash: number, strongTotal: number): MelodyMetrics => ({
    strongFit, strongClash, strongTotal,
    tonicEnds: 1, chordEnds: 0, phrases: 1, maxLeap: 5, stepRatio: 0.6, range: 12, notes: 40, chorusLift: 3,
  });

  it("コードとぶつかる音（構成音の半音上）が 20% 以下なら合格。コード構成音の割合では決めない", () => {
    expect(STRONG_CLASH_LIMIT).toBe(0.2);
    expect(QUALITY_RULES.strongFit(metrics(10, 4, 20))).toBe(true);    // 構成音は 50% でも、ぶつかるのは 20%
    expect(QUALITY_RULES.strongFit(metrics(15, 5, 20))).toBe(false);   // 構成音が 75% でも、25% がぶつかる
    expect(QUALITY_RULES.strongFit(metrics(0, 0, 0))).toBeNull();
  });

  it("C メジャーのコードの上：ミ・ソは構成音、レ・ラはぶつからない音、ファはぶつかる音", () => {
    const base = chords.find(c => c.base_scale === "major" && c.progression[0].degree === "I" && c.progression[0].type === "major")!;
    const first = base.progression[0];
    const loop = base.length_bars * 16;
    const count = (note: string) => {
      resetState();
      setState({
        key: "C", chordPattern: { ...base, progression: [{ ...first, bar: 1, duration_bars: base.length_bars }] },
        chorusPattern: null, drumPattern: drums[0], bars: base.length_bars, endingEnabled: false,
        melodyNotes: Array.from({ length: loop / 16 }, (_, bar) => ({ note, duration: "4n", time: `${bar}:0:0` })),
      });
      const m = songMetrics().melody!;
      return [m.strongFit, m.strongClash, m.strongTotal];
    };
    const bars = base.length_bars;
    expect(count("E4")).toEqual([bars, 0, bars]);
    expect(count("G4")).toEqual([bars, 0, bars]);
    expect(count("D4")).toEqual([0, 0, bars]);
    expect(count("A4")).toEqual([0, 0, bars]);
    expect(count("F4")).toEqual([0, bars, bars]);
  });
});
