import { describe, it, expect, beforeEach } from "vitest";
import { setState, getState, type ArrangeEdit } from "../src/engine/AppState";
import {
  arrangementGate, arrangementBlockAt, buildArrangement, buildDefaultArrangement, currentEditsWithPartBlocks, currentUnits, defaultSections,
  editsFromLegacy, findBlock, findEdit, getArrangement, setArrangementBypass, withEdit, ARRANGE_PRESETS, LAYERS, SECTION_BARS,
} from "../src/engine/LoopArranger";
import { chordById, chords, resetState } from "./helpers";
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
  // EDM・4 小節の進行・16 小節：小節 0〜7 が Aメロ1回目、8〜15 が Aメロ2回目。標準ではどちらもコードが鳴る
  const edm16 = () => ({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 16, sections: null });

  it("ブロックのある小節だけ true（Aメロ1回目のコードを抜く）", () => {
    setState({ ...edm16(), arrangeEdits: [{ section: "A", nth: 0, part: "chord", on: false }] });
    const gate = arrangementGate("chord");
    for (let bar = 0; bar < 16; bar++) {
      expect(gate(bar * BAR_SEC), `小節${bar + 1}の頭`).toBe(bar >= 8);
      expect(gate(bar * BAR_SEC + 1.9), `小節${bar + 1}の終わり近く`).toBe(bar >= 8);
    }
  });

  it("小節の境目ちょうどの時刻は次の小節として扱う（丸めの誤差で前の小節にしない）", () => {
    setState({ ...edm16(), arrangeEdits: [{ section: "A", nth: 0, part: "chord", on: false }] });
    const gate = arrangementGate("chord");
    expect(gate(8 * BAR_SEC - 1e-9)).toBe(true);  // getTicksAtTime の誤差でわずかに手前でも 1e-6 の余裕で次の小節
    expect(gate(8 * BAR_SEC - 0.01)).toBe(false);
  });

  it("試聴中（判定を外しているとき）はいつも true、ブロックは null", () => {
    setState({ ...edm16(), arrangeEdits: [{ section: "A", nth: 0, part: "melody", on: false }] });
    setArrangementBypass(true);
    expect(arrangementGate("melody")(3)).toBe(true);
    expect(arrangementBlockAt("fx")(3)).toBeNull();
  });

  it("arrangementBlockAt はその時刻のブロック（FX の種類・ドラムのパターン）を返す", () => {
    setState({
      ...edm16(),
      arrangeEdits: [
        { section: "A", nth: 0, part: "fx", on: true, fx: "impact" },
        { section: "A", nth: 0, part: "drum", drum: "drum_002" },
      ],
    });
    const fx = arrangementBlockAt("fx");
    expect(fx(1)?.fx).toBe("impact");
    expect(fx(7 * BAR_SEC)?.fx).toBe("impact");
    const drum = arrangementBlockAt("drum");
    expect(drum(1)?.drum).toBe("drum_002");
  });

  it("変えた所がなければ構成のプリセット（標準）のまま", () => {
    setState({ genre: "ハウス", chordPattern: chordById("chord_003"), bars: 32, arrangeEdits: [], sections: null });
    expect(getState().arrangePreset).toBe("standard");
    expect(getArrangement()).toEqual(buildDefaultArrangement("ハウス", 4, 32, null));
  });
});

describe("変えた所（ArrangeEdit）", () => {
  // 4 小節の進行・32 小節：Aメロ1回目 0〜7、Aメロ2回目 8〜15、サビ1回目 16〜23、Aメロ3回目 24〜31
  const chorusChordOff: ArrangeEdit[] = [{ section: "B", nth: 0, part: "chord", on: false }];
  const chordIn = (from: number, to: number) => {
    const blocks = getArrangement().chord;
    return Array.from({ length: to - from }, (_, i) => findBlock(blocks, from + i) !== undefined);
  };

  it("「サビ1回目のコードを抜く」は、小節数・ジャンル・進行の長さを変えてもサビ1回目に当て直す", () => {
    setState({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 32, sections: null, arrangeEdits: chorusChordOff });
    expect(chordIn(16, 24).every(on => !on)).toBe(true);
    expect(chordIn(24, 32).some(on => on)).toBe(true);

    setState({ bars: 48 });
    expect(chordIn(16, 24).every(on => !on)).toBe(true);

    setState({ genre: "ハウス" });
    expect(chordIn(16, 24).every(on => !on)).toBe(true);

    // 8 小節の進行でもサビ1回目（1セクション = 8 小節 = 1周）は 16〜23
    const eight = chords.find(c => c.length_bars === 8)!;
    setState({ chordPattern: eight });
    expect(currentUnits().find(u => u.section === "B" && u.nth === 0)?.start).toBe(16);
    expect(chordIn(16, 24).every(on => !on)).toBe(true);
  });

  it("曲が短くて当たるセクションがない変えた所は使わない（消さずに残す）", () => {
    setState({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 16, sections: null, arrangeEdits: chorusChordOff });
    expect(getArrangement()).toEqual(buildDefaultArrangement("EDM", 4, 16, null));
    expect(getState().arrangeEdits).toEqual(chorusChordOff);
  });

  it("足したセクションでは、そのセクション全体で鳴らす", () => {
    setState({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 32, sections: null,
               arrangeEdits: [{ section: "A", nth: 0, part: "pad", on: true }] });
    const pad = getArrangement().pad;
    for (let bar = 0; bar < 8; bar++) expect(findBlock(pad, bar), `小節${bar + 1}`).toBeDefined();
  });

  it("withEdit：足す → 元に戻す で変えた所が消える。パターンだけの変えた所も持てる", () => {
    setState({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 32, sections: null });
    const unit = currentUnits()[0];
    let edits = withEdit([], unit, "pad", { on: true });
    expect(edits).toEqual([{ section: "A", nth: 0, part: "pad", on: true }]);
    edits = withEdit(edits, unit, "pad", { on: undefined });
    expect(edits).toEqual([]);
    edits = withEdit(edits, unit, "drum", { drum: "drum_002" });
    expect(findEdit(edits, unit, "drum")).toEqual({ section: "A", nth: 0, part: "drum", drum: "drum_002" });
    edits = withEdit(edits, unit, "drum", { drum: undefined });
    expect(edits).toEqual([]);
  });
});

describe("editsWithPartBlocks（アレンジャーのドラッグ・長さ変更・削除・配置）", () => {
  // 鳴らす小節を、続いた小節ごとのブロックにする
  const toBlocks = (playing: boolean[]) => {
    const blocks: { start: number; length: number }[] = [];
    playing.forEach((on, bar) => {
      if (!on) return;
      const last = blocks[blocks.length - 1];
      if (last && last.start + last.length === bar) last.length++;
      else blocks.push({ start: bar, length: 1 });
    });
    return blocks;
  };
  // 4 小節の進行・32 小節：Aメロ1回目 0〜7、Aメロ2回目 8〜15、サビ1回目 16〜23、Aメロ3回目 24〜31
  const setup = () => setState({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 32, sections: null, arrangeEdits: [] });
  const playing = (part: "pad" | "chord") => {
    const blocks = getArrangement()[part];
    return Array.from({ length: 32 }, (_, bar) => findBlock(blocks, bar) !== undefined);
  };

  it("今のまま渡すと変えた所はできない", () => {
    setup();
    expect(currentEditsWithPartBlocks("chord", getArrangement().chord)).toEqual([]);
  });

  it("隙間なく隣に置いたブロックは結合しない（切れ目 splits を持つ）。前のブロックを消すと切れ目も消える", () => {
    setup();
    // パッドは Aメロ1回目（0〜7）で鳴らない。0〜3 と 4〜7 の2つを隣り合わせに置く
    const blocks = [{ start: 0, length: 4 }, { start: 4, length: 4 }, ...getArrangement().pad];
    const edits = currentEditsWithPartBlocks("pad", blocks);
    expect(edits).toEqual([
      { section: "A", nth: 0, part: "pad", on: true, splits: [4] },
      { section: "A", nth: 1, part: "pad", splits: [0] },  // プリセットのパッドの頭（8 小節目〜）
    ]);
    setState({ arrangeEdits: edits });
    expect(getArrangement().pad.slice(0, 2)).toEqual([{ start: 0, length: 4 }, { start: 4, length: 4 }]);
    // プリセットのパッドの頭（8 小節目〜）とも結合しない
    expect(getArrangement().pad[2].start).toBe(8);
    // 0〜3 を消すと 4〜7 の頭の切れ目は要らなくなる（8 小節目の切れ目は残る）
    expect(currentEditsWithPartBlocks("pad", getArrangement().pad.slice(1))).toEqual(expect.arrayContaining([
      { section: "A", nth: 1, part: "pad", splits: [0] },
      { section: "A", nth: 0, part: "pad", bars: [4, 5, 6, 7] },
    ]));
  });

  it("セクションの一部だけ鳴らすと bars（セクションの頭からの位置）で持ち、その小節だけ鳴る", () => {
    setup();
    const want = playing("pad");
    for (let bar = 0; bar < 8; bar++) want[bar] = bar >= 2 && bar < 5;  // Aメロ1回目の 3〜5 小節目だけ
    const edits = currentEditsWithPartBlocks("pad", toBlocks(want));
    expect(edits).toEqual([{ section: "A", nth: 0, part: "pad", bars: [2, 3, 4] }]);
    setState({ arrangeEdits: edits });
    expect(playing("pad")).toEqual(want);
  });

  it("セクション全体を消す・置くと on で持ち、プリセットに戻すと変えた所が消える", () => {
    setup();
    const want = playing("chord");
    for (let bar = 16; bar < 24; bar++) want[bar] = false;
    setState({ arrangeEdits: currentEditsWithPartBlocks("chord", toBlocks(want)) });
    expect(getState().arrangeEdits).toEqual([{ section: "B", nth: 0, part: "chord", on: false }]);
    const before = buildDefaultArrangement("EDM", 4, 32, null).chord;
    const back = Array.from({ length: 32 }, (_, bar) => findBlock(before, bar) !== undefined);
    expect(currentEditsWithPartBlocks("chord", toBlocks(back))).toEqual([]);
  });

  it("小節単位の変えた所も、小節数を延ばしても同じセクションに当て直す。ドラムのパターンは残す", () => {
    setState({ genre: "EDM", chordPattern: chordById("chord_001"), bars: 32, sections: null,
               arrangeEdits: [{ section: "B", nth: 0, part: "drum", drum: "drum_002" }] });
    const want = Array.from({ length: 32 }, (_, bar) => findBlock(getArrangement().drum, bar) !== undefined);
    for (let bar = 16; bar < 24; bar++) want[bar] = bar < 20;  // サビ1回目の前半だけ
    const edits = currentEditsWithPartBlocks("drum", toBlocks(want));
    expect(findEdit(edits, currentUnits()[2], "drum")).toEqual({ section: "B", nth: 0, part: "drum", drum: "drum_002", bars: [0, 1, 2, 3] });
    setState({ arrangeEdits: edits, bars: 48 });
    const drum = getArrangement().drum;
    for (let bar = 16; bar < 24; bar++) expect(findBlock(drum, bar) !== undefined, `小節${bar + 1}`).toBe(bar < 20);
  });
});

describe("構成のプリセット（ARRANGE_PRESETS）", () => {
  const presets = ARRANGE_PRESETS.map(p => p.id);

  it.each(GENRES.flatMap(g => presets.map(p => [g, p] as const)))("%s・%s：ブロックが重ならず、どの小節も何かが鳴る", (genre, preset) => {
    const arrangement = buildArrangement({ genre, loopBars: 4, totalBars: 32, preset });
    for (const part of LAYERS) {
      arrangement[part].forEach((b, i, blocks) => {
        expect(b.start + b.length).toBeLessThanOrEqual(32);
        if (i > 0) expect(b.start).toBeGreaterThan(blocks[i - 1].start + blocks[i - 1].length);
      });
    }
    for (let bar = 0; bar < 32; bar++) {
      expect(LAYERS.some(p => findBlock(arrangement[p], bar)), `小節${bar + 1}`).toBe(true);
    }
  });

  it("短め は A → サビ をくり返す。ほかはセクションの並びを変えない", () => {
    for (const genre of GENRES) {
      expect(defaultSections(genre, 8, 4, "short")).toEqual(["A", "A", "B", "B", "A", "A", "B", "B"]);
      for (const p of presets.filter(p => p !== "short")) {
        expect(defaultSections(genre, 8, 4, p)).toEqual(defaultSections(genre, 8, 4));
      }
    }
  });

  it("静かに始まる は最初の小節がコード・パッドだけ", () => {
    for (const genre of GENRES) {
      const a = buildArrangement({ genre, loopBars: 4, totalBars: 32, preset: "quiet" });
      expect(LAYERS.filter(p => findBlock(a[p], 0)).sort()).toEqual(["chord", "pad"]);
    }
  });

  it("サビを強く はサビで全部のパート、直前のセクションの後半でドラム・ベースを抜く", () => {
    for (const genre of GENRES) {
      const a = buildArrangement({ genre, loopBars: 4, totalBars: 32, preset: "drop" });
      for (const p of LAYERS) expect(findBlock(a[p], 16), `${genre} ${p}`).toBeDefined();
      expect(findBlock(a.bass, 13)).toBeUndefined();
      expect(findBlock(a.drum, 13)).toBeUndefined();
      expect(findBlock(a.drum, 15)).toBeDefined();  // 最後の1小節でドラムを戻す（フィル）
    }
  });

  it("だんだん盛り上がる はセクションごとに鳴るパートが減らない", () => {
    for (const genre of GENRES) {
      const a = buildArrangement({ genre, loopBars: 4, totalBars: 48, preset: "buildup" });
      const count = (bar: number) => LAYERS.filter(p => findBlock(a[p], bar)).length;
      for (let bar = 1; bar < 48; bar++) expect(count(bar), `${genre} 小節${bar + 1}`).toBeGreaterThanOrEqual(count(bar - 1));
    }
  });
});

describe("editsFromLegacy（以前のブロックの並びからの読み替え）", () => {
  it("ジャンルの標準のままのブロックは、変えた所なし", () => {
    for (const genre of GENRES) {
      expect(editsFromLegacy(buildDefaultArrangement(genre, 4, 32), genre, 4, 32)).toEqual([]);
    }
  });

  it("セクション全体で鳴らした・抜いたパートを、足した・抜いたにする", () => {
    const legacy = buildDefaultArrangement("EDM", 4, 32);
    legacy.pad   = [...legacy.pad, { start: 0, length: 8 }].sort((a, b) => a.start - b.start);  // Aメロ1回目に足した
    legacy.chord = legacy.chord.filter(b => b.start + b.length <= 16 || b.start >= 24)       // サビ1回目から抜いた
      .flatMap(b => b.start < 16 && b.start + b.length > 16 ? [{ start: b.start, length: 16 - b.start }] : [b]);
    const edits = editsFromLegacy(legacy, "EDM", 4, 32);
    expect(edits).toContainEqual({ section: "A", nth: 0, part: "pad", on: true });
    expect(edits).toContainEqual({ section: "B", nth: 0, part: "chord", on: false });
  });
});
