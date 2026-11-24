import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// grow のプリセット（Git に入れた public/grow/grow.wasm をそのまま読む）：ID・カテゴリと、
// Toniq のパートごとのカテゴリ・ジャンルの標準の候補がそろっているか
const WASM = fileURLToPath(new URL("../public/grow/grow.wasm", import.meta.url));
const bytes = readFileSync(WASM);
vi.mock("../src/engine/DrumSamples", () => ({
  fetchArrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}));

import {
  loadGrow, growPresetIds, growPresetCategories, growPresetChoices, growCategoryName, growStandardCandidates,
  GROW_CATEGORIES, PART_CATEGORIES, FALLBACK_CATEGORIES, LEGACY_PRESET_IDS, type GrowPart,
} from "../src/engine/Grow";
import melodyParams from "../src/data/melody_params.json";
import { TERMS } from "../src/ui/Glossary";

const PARTS = Object.keys(PART_CATEGORIES) as GrowPart[];
const GENRES = Object.keys(melodyParams);

beforeAll(async () => {
  expect(await loadGrow()).toBe(true);
});

describe("grow のプリセット", () => {
  it("ID は空でない ASCII で、重ならない", () => {
    const ids = growPresetIds();
    expect(ids.length).toBeGreaterThan(0);
    ids.forEach(id => expect(id).toMatch(/^[a-z0-9_]+$/));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("番号で保存していた頃の ID（LEGACY_PRESET_IDS）がすべて残っている", () => {
    LEGACY_PRESET_IDS.forEach(id => expect(growPresetIds()).toContain(id));
  });

  it("すべてのプリセットが Toniq の知っているカテゴリを持ち、初期化だけが init", () => {
    const ids = growPresetIds();
    growPresetCategories().forEach((category, i) => {
      expect(GROW_CATEGORIES).toContain(category);
      expect(category === "init").toBe(ids[i] === "init");
    });
  });

  it("カテゴリの表示名を wasm から読む", () => {
    expect(growCategoryName("chord")).toBe("和音");
    expect(growCategoryName("texture")).toBe("質感（ノイズ）");
  });

  it("古い wasm 用のカテゴリの表（FALLBACK_CATEGORIES）は wasm のカテゴリと同じ", () => {
    const ids = growPresetIds(), categories = growPresetCategories();
    Object.entries(FALLBACK_CATEGORIES).forEach(([id, category]) => {
      const index = ids.indexOf(id);
      expect(index, id).toBeGreaterThanOrEqual(0);
      expect(categories[index], id).toBe(category);
    });
  });
});

describe("パートごとのカテゴリ", () => {
  it("ジャンルの標準の候補はどれも wasm にあり、そのパートで選べるカテゴリ", () => {
    const ids = growPresetIds(), categories = growPresetCategories();
    PARTS.forEach(part => GENRES.forEach(genre => {
      growStandardCandidates(part, genre).forEach(id => {
        const index = ids.indexOf(id);
        expect(index, `${part} / ${genre} / ${id}`).toBeGreaterThanOrEqual(0);
        expect(PART_CATEGORIES[part], `${part} / ${genre} / ${id}`).toContain(categories[index]);
      });
    }));
  });

  it("選択肢はパートのカテゴリの順に、そのカテゴリのプリセットだけを並べる", () => {
    const categories = growPresetCategories();
    PARTS.forEach(part => {
      const groups = growPresetChoices(part);
      expect(groups.map(g => g.category)).toEqual(PART_CATEGORIES[part].filter(c => categories.includes(c)));
      groups.forEach(g => g.presets.forEach(i => expect(categories[i]).toBe(g.category)));
      // ドラム・パーカッション・初期化はどのパートの選択肢にも出さない
      groups.forEach(g => expect(["drum", "perc", "init"]).not.toContain(g.category));
    });
  });

  it("音作りのパネル用（withInit）は最後に初期化を足す", () => {
    const groups = growPresetChoices("bass", true);
    const last = groups[groups.length - 1];
    expect(last.category).toBe("init");
    expect(last.presets).toEqual([growPresetIds().indexOf("init")]);
  });

  it("コードの音色の選択肢は和音とパッド（以前の選択肢をすべて含む）", () => {
    const ids = growPresetIds();
    const chord = growPresetChoices("chord").flatMap(g => g.presets.map(i => ids[i]));
    ["soft_pad", "wide_pad", "epiano", "strings", "organ", "square", "supersaw", "hard_pad"].forEach(id => expect(chord).toContain(id));
    expect(chord).not.toContain("saw_bass");
  });
});

describe("用語の説明（音作りのパネルのツールチップ）", () => {
  it("パネルの一覧に出るプリセットには、すべて説明（sound.<ID>）がある", () => {
    const ids = growPresetIds();
    const shown = new Set(PARTS.flatMap(part => growPresetChoices(part, true).flatMap(g => g.presets.map(i => ids[i]))));
    const missing = [...shown].filter(id => !TERMS[`sound.${id}`]);
    expect(missing).toEqual([]);
  });

  it("一覧の行の名前（カテゴリ・標準・その他）には、すべて説明（growCategory.<カテゴリ>）がある", () => {
    const rows = new Set(PARTS.flatMap(part => growPresetChoices(part, true).map(g => g.category as string)));
    const missing = [...rows, "standard", "other"].filter(c => !TERMS[`growCategory.${c}`]);
    expect(missing).toEqual([]);
  });
});
