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
import { songProgression, songMelody, getSections, endingBar } from "../src/engine/SongForm";
import { bassNotes } from "../src/engine/BassPlayer";
import { exportMidi, durationToBeats } from "../src/engine/MidiExporter";
import { saveOutput } from "../src/engine/OutputFiles";
import { swungBeats, SWING_MAX } from "../src/engine/Groove";
import { getState, setState, defaultState } from "../src/engine/AppState";
import { setArrangementBypass } from "../src/engine/LoopArranger";
import { generateSongMelodies } from "../src/engine/SongForm";
import { resolveChord, NOTE_INDEX } from "../src/data/degree_resolver";
import { noteToMidi, timeToUnits } from "../src/engine/MelodyGenerator";
import type { ChordProgression } from "../src/data/types";
import bassParams from "../src/data/bass_params.json";
import { chords, drums, resetState, seededRandom } from "./helpers";

const GENRES = Object.keys(bassParams);

beforeEach(() => {
  resetState();
  setArrangementBypass(false);
  vi.mocked(saveOutput).mockReset();
});

// 同じ長さ・スケールの別の進行（サビの相方）
function partnerOf(base: ChordProgression): ChordProgression {
  return chords.find(c => c.id !== base.id && c.length_bars === base.length_bars && c.base_scale === base.base_scale)!;
}

function song(length: number, options: { genre?: string; ending?: boolean; chorus?: boolean } = {}): ChordProgression {
  const base = chords.find(c => c.length_bars === length)!;
  setState({
    genre: options.genre ?? "EDM", key: "A", chordPattern: base,
    chorusPattern: options.chorus === false ? null : partnerOf(base),
    drumPattern: drums[0], bars: 32, sections: null, arrangeEdits: [],
    endingEnabled: options.ending ?? true,
  });
  return base;
}

describe("songProgression（曲全体のコードの並び）", () => {
  it.each([2, 4, 8])("%i 小節の進行：周回ごとにセクションの進行を並べ、最後の小節はエンディングの主和音", length => {
    const base = song(length);
    const chorus = getState().chorusPattern!;
    const p = songProgression()!;
    const sections = getSections();

    expect(p.length_bars).toBe(32);
    expect(p.section_bars).toBe(length);
    expect(sections.length).toBe(32 / length);

    // エンディング以外のコードは、周回のセクションの進行と同じ並び
    const end = endingBar()!;
    for (const c of p.progression) {
      if (c.ending) continue;
      const loop = Math.floor((c.bar - 1) / length);
      expect(c.section).toBe(sections[loop]);
      const source = sections[loop] === "B" ? chorus : base;
      const original = source.progression.find(o => o.bar === c.bar - loop * length)!;
      expect(c.degree).toBe(original.degree);
      expect(c.bar - 1 + c.duration_bars).toBeLessThanOrEqual(end);
    }

    // 最後は主和音の全音符1つ（メジャーは I、それ以外は Im）
    const last = p.progression[p.progression.length - 1];
    expect(last.ending).toBe(true);
    expect(last.bar).toBe(32);
    expect(last.duration_bars).toBe(1);
    expect(last.type).toBe(base.base_scale === "major" ? "major" : "minor");

    // 小節がすき間なく埋まっている
    const covered = p.progression.reduce((sum, c) => sum + c.duration_bars, 0);
    expect(covered).toBe(32);
  });

  it("エンディングを使わないときは周回をそのまま並べ、主和音を足さない", () => {
    song(4, { ending: false });
    const p = songProgression()!;
    expect(p.length_bars).toBe(32);
    expect(p.progression.some(c => c.ending)).toBe(false);
    expect(p.progression.reduce((sum, c) => sum + c.duration_bars, 0)).toBe(32);
  });

  it("サビの進行がない・合わないときはサビでも Aメロの進行", () => {
    const base = song(4, { chorus: false });
    const p = songProgression()!;
    const sections = getSections();
    expect(sections).toContain("B");
    for (const c of p.progression.filter(c => !c.ending)) {
      const original = base.progression.find(o => o.bar === ((c.bar - 1) % 4) + 1)!;
      expect(c.degree).toBe(original.degree);
    }

    // 長さの違う進行はサビに使わない
    setState({ chorusPattern: chords.find(c => c.length_bars === 8)! });
    expect(songProgression()!.progression.filter(c => !c.ending).map(c => c.degree))
      .toEqual(p.progression.filter(c => !c.ending).map(c => c.degree));
  });

  it("試聴・サンプル中はコード進行1周をそのまま返す", () => {
    const base = song(4);
    setArrangementBypass(true);
    expect(songProgression()).toBe(base);
  });
});

describe("bassNotes（ベースの音の並び）", () => {
  // コードの構成音（ピッチクラス）
  const tones = (p: ChordProgression, bar: number) => {
    const c = p.progression.find(c => bar >= c.bar - 1 && bar < c.bar - 1 + c.duration_bars)!;
    return { chord: c, pcs: resolveChord(c.degree, c.type, 0, "A", p.base_scale, 2).notes.map(n => noteToMidi(n) % 12) };
  };

  it.each(GENRES)("%s：音はコードのルート・5度で、小節からはみ出さず重ならない", genre => {
    song(4, { genre });
    const p = songProgression()!;
    const notes = bassNotes(p, "A");
    expect(notes.length).toBeGreaterThan(0);

    let prevEnd = 0;
    for (const n of notes) {
      expect(n.length).toBeGreaterThanOrEqual(1);
      expect(n.sixteenth).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = n.sixteenth + n.length;
      const bar = Math.floor(n.sixteenth / 16);
      expect(prevEnd).toBeLessThanOrEqual((bar + 1) * 16);
      const { chord, pcs } = tones(p, bar);
      const pc = noteToMidi(n.note) % 12;
      expect(pcs, `${genre} ${n.sixteenth} ${n.note} ${chord.degree}`).toContain(pc);
    }
    expect(prevEnd).toBeLessThanOrEqual(32 * 16);
  });

  it.each(GENRES)("%s：周回の最後の小節は fill、ほかは patterns を順に使う", genre => {
    song(4, { genre, ending: false });
    const param = (bassParams as Record<string, { patterns: string[]; fill: string }>)[genre];
    const notes = bassNotes(songProgression()!, "A");
    const onsets = (bar: number) => notes.filter(n => Math.floor(n.sixteenth / 16) === bar).map(n => n.sixteenth % 16);
    const expected = (pattern: string) => [...pattern].flatMap((ch, i) => "RFO".includes(ch) ? [i] : []);
    for (let bar = 0; bar < 32; bar++) {
      const pattern = bar % 4 === 3 ? param.fill : param.patterns[bar % param.patterns.length];
      expect(onsets(bar), `${genre} 小節 ${bar}`).toEqual(expected(pattern));
    }
  });

  it("エンディングの小節はルートの全音符1つ", () => {
    song(4, { genre: "ハウス" });
    const notes = bassNotes(songProgression()!, "A");
    const last = notes.filter(n => n.sixteenth >= 31 * 16);
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ sixteenth: 31 * 16, length: 16 });
    expect(noteToMidi(last[0].note) % 12).toBe(NOTE_INDEX.A);
  });
});

describe("durationToBeats（音価 → 拍数）", () => {
  it.each([
    ["1n", 4], ["2n", 2], ["4n", 1], ["8n", 0.5], ["16n", 0.25], ["4n.", 1.5], ["8n.", 0.75],
    ["0:1:2", 1.5], ["1:0:0", 4], ["0:0:3", 0.75],
  ])("%s → %f 拍", (duration, beats) => {
    expect(durationToBeats(duration)).toBeCloseTo(beats);
  });
});

describe("exportMidi（MIDI書き出し）", () => {
  async function exported(): Promise<Midi> {
    await exportMidi("test.mid");
    expect(saveOutput).toHaveBeenCalledTimes(1);
    const [kind, blob, name] = vi.mocked(saveOutput).mock.calls[0];
    expect(kind).toBe("midi");
    expect(name).toBe("test.mid");
    return new Midi(new Uint8Array(await (blob as Blob).arrayBuffer()));
  }

  function generated(genre: string): void {
    song(4, { genre });
    const random = Math.random;
    Math.random = seededRandom(7);
    try { setState(generateSongMelodies()); } finally { Math.random = random; }
  }

  it.each(GENRES)("%s：ON のパートのトラックがあり、音は曲の長さに収まる", async genre => {
    generated(genre);
    setState({ bpm: 123 });
    const midi = await exported();
    const s = getState();

    expect(midi.header.tempos[0].bpm).toBeCloseTo(123, 0);
    const names = midi.tracks.map(t => t.name);
    for (const name of ["Melody", "Chord", "Bass", "Drums"]) expect(names, genre).toContain(name);
    // シグネチャー・FX は書き出さない（トラック名は MidiExporter.ts の TRACKS のどれか）
    for (const name of names) {
      expect(["Melody", "Chord", "Pad", "Arpeggio", "Bass", "Counter Melody", "Drums", "Percussion"]).toContain(name);
    }

    const endTicks = s.bars * 4 * midi.header.ppq;
    for (const t of midi.tracks) {
      expect(t.notes.length, `${genre} ${t.name}`).toBeGreaterThan(0);
      for (const n of t.notes) {
        expect(n.ticks).toBeGreaterThanOrEqual(0);
        expect(n.ticks, `${genre} ${t.name}`).toBeLessThan(endTicks);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(1);
      }
    }
    // ドラム・パーカッションはチャンネル 10（0 始まりで 9）
    for (const t of midi.tracks.filter(t => t.name === "Drums" || t.name === "Percussion")) expect(t.channel).toBe(9);
  });

  it("OFF のパートは書き出さない", async () => {
    generated("ローファイ");
    setState({ parts: { ...getState().parts, bass: false, melody: false } });
    const names = (await exported()).tracks.map(t => t.name);
    expect(names).not.toContain("Bass");
    expect(names).not.toContain("Melody");
    expect(names).toContain("Chord");
  });

  it("メロディは曲全体の並び（Aメロ・サビ・エンディング）と同じ音", async () => {
    generated("ハウス");
    setState({ swing: 0 });
    const midi = await exported();
    const melody = midi.tracks.find(t => t.name === "Melody")!;
    const last = melody.notes[melody.notes.length - 1];
    // エンディングの主音の全音符で終わる
    expect(last.ticks).toBe(31 * 4 * midi.header.ppq);
    expect(last.midi % 12).toBe(NOTE_INDEX.A);
    expect(last.durationTicks).toBe(4 * midi.header.ppq);
  });

  it("進行がないときは何も書き出さない", async () => {
    setState({ ...defaultState, chordPattern: null });
    await exportMidi("none.mid");
    expect(saveOutput).not.toHaveBeenCalled();
  });
});

describe("転調（AppState.modulation）", () => {
  // 4 小節の進行・32 小節で、セクションは A A A A B B A A（LOOP_SCHEDULE の標準）
  function modulated(semitones: number, scope: "last" | "chorus"): void {
    song(4, { genre: "EDM" });
    const random = Math.random;
    Math.random = seededRandom(3);
    try { setState(generateSongMelodies()); } finally { Math.random = random; }
    setState({ modulation: semitones, modulationScope: scope });
  }
  const loopShifts = () => {
    const shifts: number[] = [];
    for (const c of songProgression()!.progression) shifts[Math.floor((c.bar - 1) / 4)] = c.keyShift ?? 0;
    return shifts;
  };

  it("しない（0）ときは keyShift を付けない", () => {
    modulated(0, "last");
    expect(songProgression()!.progression.some(c => c.keyShift)).toBe(false);
  });

  it("last：最後のサビの1周目から曲の終わり（エンディングを含む）まで上げる", () => {
    modulated(2, "last");
    const sections = getSections();
    // 最後に続くサビの1周目
    let start = sections.lastIndexOf("B");
    while (start > 0 && sections[start - 1] === "B") start--;
    expect(start).toBeGreaterThan(0);
    expect(loopShifts()).toEqual(sections.map((_, i) => i >= start ? 2 : 0));
    const progression = songProgression()!.progression;
    const last = progression[progression.length - 1];
    expect(last.ending).toBe(true);
    expect(last.keyShift).toBe(2);
  });

  it("chorus：サビの周回だけ上げ、Aメロでは戻す", () => {
    modulated(1, "chorus");
    expect(loopShifts()).toEqual(getSections().map(sec => sec === "B" ? 1 : 0));
  });

  it("メロディは転調した周回だけ同じ半音上がり、エンディングの音はずらしたキーの主音", () => {
    modulated(0, "last");
    const plain = songMelodyMidis();
    modulated(2, "last");
    const moved = songMelodyMidis();
    const shifts = loopShifts();
    expect(moved.length).toBe(plain.length);
    moved.slice(0, -1).forEach((n, i) => {
      expect(n.midi - plain[i].midi).toBe(shifts[Math.floor(n.start / 64)]);
    });
    expect(moved[moved.length - 1].midi % 12).toBe((NOTE_INDEX.A + 2) % 12);
  });

  it("ベースは転調した所でずらしたキーのルートを鳴らす", () => {
    modulated(2, "last");
    const song = songProgression()!;
    const notes = bassNotes(song, "A");
    const ending = notes[notes.length - 1];
    expect(noteToMidi(ending.note) % 12).toBe((NOTE_INDEX.A + 2) % 12);  // B（A の全音上）の主和音のルート
    // 最初のコード（転調していない）は元のキーのルート
    const first = song.progression[0];
    expect(noteToMidi(notes[0].note) % 12).toBe(
      noteToMidi(resolveChord(first.degree, first.type, 0, "A", song.base_scale, 2).bass_note) % 12);
  });

  it("試聴・サンプル中は転調しない", () => {
    modulated(2, "last");
    setArrangementBypass(true);
    expect(songProgression()!.progression.some(c => c.keyShift)).toBe(false);
  });
});

function songMelodyMidis(): { midi: number; start: number }[] {
  return songMelody()
    .filter(n => n.note !== null)
    .map(n => ({ midi: noteToMidi(n.note!), start: timeToUnits(n.time) }));
}

describe("スウィング・シャッフル（swungBeats。MIDI書き出しのずらし方）", () => {
  it("16分音符：裏の16分だけずれ、拍の頭と8分の頭はずれない", () => {
    setState({ swing: 100, swingUnit: "16n" });
    expect(swungBeats(0)).toBe(0);
    expect(swungBeats(0.5)).toBe(0.5);
    expect(swungBeats(0.25)).toBeGreaterThan(0.25);
    // いちばん大きい所で 8分 ÷ 3 × 量（SWING_MAX）
    expect(swungBeats(0.25) - 0.25).toBeCloseTo((0.5 / 3) * SWING_MAX);
  });

  it("8分音符（シャッフル）：拍の頭はずれず、裏の8分がいちばん大きく（16分の2倍）ずれる", () => {
    setState({ swing: 100, swingUnit: "8n" });
    expect(swungBeats(0)).toBe(0);
    expect(swungBeats(1)).toBe(1);
    expect(swungBeats(0.5) - 0.5).toBeCloseTo((1 / 3) * SWING_MAX);
    setState({ swingUnit: "16n" });
    const sixteenth = swungBeats(0.25) - 0.25;
    setState({ swingUnit: "8n" });
    expect(swungBeats(0.5) - 0.5).toBeCloseTo(sixteenth * 2);
  });

  it("量が 0 ならずらさない", () => {
    setState({ swing: 0, swingUnit: "8n" });
    expect(swungBeats(0.5)).toBe(0.5);
  });
});
