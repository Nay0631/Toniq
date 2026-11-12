import { describe, it, expect, beforeEach, vi } from "vitest";

// 音を出す部分（Web Audio）は使わないので外す
vi.mock("../src/engine/VolumeManager", () => ({ createVolumeNode: vi.fn() }));
vi.mock("../src/engine/SynthFactory", () => ({ createDrumKit: vi.fn() }));
vi.mock("../src/engine/Groove", () => ({ sidechainHit: vi.fn() }));

import { drumStepHits, fillAt, fillSize, FILLS, FILL_SIZES } from "../src/engine/DrumEngine";
import { fillKind } from "../src/engine/SongForm";
import { setState } from "../src/engine/AppState";
import { setArrangementBypass } from "../src/engine/LoopArranger";
import { chords, drums, resetState } from "./helpers";
import easyTable from "../src/data/easy_mode_table.json";

const GENRES = Object.keys(easyTable);
const TRACKS = ["kick", "snare", "hihat_closed", "hihat_open", "clap", "rim"];

beforeEach(() => {
  resetState();
  setArrangementBypass(false);
});

// 4 小節の進行・32 小節（A A サビ A）の曲にする
function song(genre: string, mood: string): void {
  const chordPattern = chords.find(c => c.length_bars === 4)!;
  const drumPattern  = drums.find(d => d.genre?.includes(genre)) ?? drums[0];
  setState({ genre, mood, chordPattern, chorusPattern: null, drumPattern, bars: 32, arrangement: null, sections: null,
             drumFill: true, endingEnabled: true });
}

describe("FILLS（ジャンル × 大きさのフィルの定義）", () => {
  it.each(GENRES)("%s：小・中・大があり、書式が正しい", genre => {
    const fills = FILLS[genre];
    expect(fills, genre).toBeDefined();
    for (const size of FILL_SIZES) {
      const f = fills[size];
      expect(f.from).toBeGreaterThanOrEqual(0);
      expect(f.from).toBeLessThan(16);
      for (const [name, steps] of Object.entries(f.tracks)) {
        expect(TRACKS, `${genre} ${size} ${name}`).toContain(name);
        expect(steps, `${genre} ${size} ${name}`).toMatch(/^[x.]+$/);
        expect(steps.length, `${genre} ${size} ${name}`).toBe(16 - f.from);
      }
      for (const name of f.keep) expect(TRACKS).toContain(name);
    }
    // 大きいフィルほど早く始まる（同じなら音が多い）
    const hits = (size: "small" | "normal" | "big") =>
      Object.values(fills[size].tracks).join("").split("x").length - 1;
    expect(fills.small.from).toBeGreaterThanOrEqual(fills.normal.from);
    expect(fills.normal.from).toBeGreaterThanOrEqual(fills.big.from);
    expect(hits("big")).toBeGreaterThan(hits("small"));
  });
});

describe("fillSize（理由と雰囲気からフィルの大きさ）", () => {
  it("次がサビ・エンディングは大、Aメロへ戻る・編成の変化は中、同じセクションの区切りは小", () => {
    expect(fillSize("chorus", "明るい")).toBe("big");
    expect(fillSize("ending", "切ない")).toBe("big");
    expect(fillSize("section", "明るい")).toBe("normal");
    expect(fillSize("change", "暗い")).toBe("normal");
    expect(fillSize("regular", "明るい")).toBe("small");
  });

  it("激しいは1段大きく、落ち着いたは1段小さく（小〜大に収める）", () => {
    expect(fillSize("regular", "激しい")).toBe("normal");
    expect(fillSize("chorus", "激しい")).toBe("big");
    expect(fillSize("chorus", "落ち着いた")).toBe("normal");
    expect(fillSize("regular", "落ち着いた")).toBe("small");
  });
});

describe("曲の中のフィル（セクションで変わる）", () => {
  it("サビの直前・サビの終わり・エンディングの直前で理由が変わる", () => {
    song("EDM", "明るい");
    expect(fillKind(15)).toBe("chorus");   // 小節 16〜23 がサビ
    expect(fillKind(23)).toBe("section");
    expect(fillKind(30)).toBe("ending");   // 小節 31 がエンディング
    expect(fillKind(14)).toBeNull();
  });

  it("サビの直前は大きいフィル（EDM は小節の頭からロール）、雰囲気で変わる", () => {
    song("EDM", "明るい");
    expect(fillAt(15)).toBe(FILLS["EDM"].big);
    expect(drumStepHits(edmPattern(), 15, 0).map(h => h.name)).toContain("snare");

    song("EDM", "落ち着いた");
    expect(fillAt(15)).toBe(FILLS["EDM"].normal);
  });

  it("フィルを使わない設定・試聴中はフィルなし", () => {
    song("EDM", "明るい");
    setState({ drumFill: false });
    expect(fillAt(15)).toBeNull();
    setState({ drumFill: true });
    setArrangementBypass(true);
    expect(fillAt(15)).toBeNull();
  });
});

function edmPattern() {
  return drums.find(d => d.genre?.includes("EDM")) ?? drums[0];
}
