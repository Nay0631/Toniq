import { describe, it, expect, beforeEach } from "vitest";
import { setState, getState } from "../src/engine/AppState";
import {
  arrangementGate, arrangementBlockAt, buildDefaultArrangement, defaultSections, emptyArrangement,
  findBlock, getArrangement, setArrangementBypass, LAYERS, SECTION_BARS,
} from "../src/engine/LoopArranger";
import { chordById, resetState } from "./helpers";
import easyTable from "../src/data/easy_mode_table.json";

// tests/stubs/tone.ts の Transport は BPM 120：1 小節 = 2 秒
const BAR_SEC = 2;
const GENRES = Object.keys(easyTable);

beforeEach(() => {
  resetState();
  setArrangementBypass(false);
});

describe("buildDefaultArrangement（ジャンルの標準アレンジ）", () => {
  it.each(GENRES.flatMap(g => [2, 4, 8].map(L => [g, L] as const)))("%s・進行 %i 小節：ブロックが重ならず曲の中に収まる", (genre, L) => {
    const total = 32;
    const arrangement = buildDefaultArrangement(genre, L, total);
    for (const part of LAYERS) {
      const blocks = arrangement[part];
      blocks.forEach((b, i) => {
        expect(b.length).toBeGreaterThan(0);
        expect(b.start).toBeGreaterThanOrEqual(0);
        expect(b.start + b.length).toBeLessThanOrEqual(total);
        // 続いた小節は1つのブロックにまとめる（となりのブロックとの間は空く）
        if (i > 0) expect(b.start).toBeGreaterThan(blocks[i - 1].start + blocks[i - 1].length);
      });
    }
    // 曲のどこかでは必ず何かが鳴る・どの小節もメロディかコードかパッドのどれかは鳴る
    for (let bar = 0; bar < total; bar++) {
      expect(LAYERS.some(p => findBlock(arrangement[p], bar)), `${genre} 小節${bar + 1}`).toBe(true);
    }
  });

  it("セクションは A → A → サビ → A（8小節ずつ）", () => {
    for (const genre of GENRES) {
      expect(defaultSections(genre, 8, 4)).toEqual(["A", "A", "A", "A", "B", "B", "A", "A"]);
      expect(defaultSections(genre, 4, 8)).toEqual(["A", "A", "B", "A"]);
      expect(defaultSections(genre, 16, 2)).toEqual([...Array(8).fill("A"), ...Array(4).fill("B"), ...Array(4).fill("A")]);
    }
    expect(SECTION_BARS).toBe(8);
  });

  // 4 小節の進行・32 小節：小節 8〜15（0 始まり）が2つ目の A、16〜23 がサビ
  it("サビの直前の1小節だけ gap のパートを抜く（8bit はベース）", () => {
    const arrangement = buildDefaultArrangement("8bit", 4, 32);
    expect(findBlock(arrangement.bass, 14)).toBeDefined();
    expect(findBlock(arrangement.bass, 15)).toBeUndefined();
    expect(findBlock(arrangement.bass, 16)).toBeDefined();
  });

  it("セクションの最後の1小節だけ build のパートを足す（EDM のブレイクの終わりにドラムを戻す）", () => {
    const arrangement = buildDefaultArrangement("EDM", 4, 32);
    expect(findBlock(arrangement.drum, 14)).toBeUndefined();
    expect(findBlock(arrangement.drum, 15)).toBeDefined();
  });

  it("曲の最後の小節では gap・build を使わない", () => {
    // 16 小節の曲：小節 15 が最後。8bit の2つ目の A の最後でも、ベースは抜かない
    const arrangement = buildDefaultArrangement("8bit", 4, 16);
    expect(findBlock(arrangement.bass, 15)).toBeDefined();
  });
});

describe("arrangementGate（再生中にパートを鳴らすか）", () => {
  it("ブロックのある小節だけ true", () => {
    setState({
      chordPattern: chordById("chord_001"),
      bars: 8,
      arrangement: { ...emptyArrangement(), bass: [{ start: 2, length: 3 }] },  // 小節 3〜5（1 始まり）
    });
    const gate = arrangementGate("bass");
    const expected = [false, false, true, true, true, false, false, false];
    expected.forEach((on, bar) => {
      expect(gate(bar * BAR_SEC), `小節${bar + 1}の頭`).toBe(on);
      expect(gate(bar * BAR_SEC + 1.9), `小節${bar + 1}の終わり近く`).toBe(on);
    });
    expect(arrangementGate("drum")(0)).toBe(false);
  });

  it("小節の境目ちょうどの時刻は次の小節として扱う（丸めの誤差で前の小節にしない）", () => {
    setState({ chordPattern: chordById("chord_001"), bars: 8, arrangement: { ...emptyArrangement(), chord: [{ start: 1, length: 1 }] } });
    const gate = arrangementGate("chord");
    expect(gate(BAR_SEC - 1e-9)).toBe(true);  // getTicksAtTime の誤差でわずかに手前でも 1e-6 の余裕で次の小節
    expect(gate(2 * BAR_SEC)).toBe(false);
  });

  it("試聴中（判定を外しているとき）はいつも true、ブロックは null", () => {
    setState({ chordPattern: chordById("chord_001"), bars: 8, arrangement: emptyArrangement() });
    setArrangementBypass(true);
    expect(arrangementGate("melody")(3)).toBe(true);
    expect(arrangementBlockAt("fx")(3)).toBeNull();
  });

  it("arrangementBlockAt はその時刻のブロック（FX の種類・ドラムのパターン）を返す", () => {
    setState({
      chordPattern: chordById("chord_001"), bars: 8,
      arrangement: { ...emptyArrangement(), fx: [{ start: 0, length: 2, fx: "impact" }, { start: 4, length: 2 }] },
    });
    const at = arrangementBlockAt("fx");
    expect(at(1)?.fx).toBe("impact");
    expect(at(3 * BAR_SEC)).toBeUndefined();
    expect(at(4 * BAR_SEC)?.fx).toBeUndefined();
    expect(at(4 * BAR_SEC)).toBeDefined();
  });

  it("アレンジを編集していなければ（null）ジャンルの標準アレンジで判定する", () => {
    setState({ genre: "ハウス", chordPattern: chordById("chord_003"), bars: 32, arrangement: null, sections: null });
    expect(getState().arrangement).toBeNull();
    expect(getArrangement()).toEqual(buildDefaultArrangement("ハウス", 4, 32, null));
  });
});
