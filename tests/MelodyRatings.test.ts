import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveRating, listRatings, findRating, songKey, summarize, comparePairs,
  ratingsToJson, ratingsToCsv, importRatings, deleteLabel, type MelodyRating,
} from "../src/engine/MelodyRatings";
import { generateBatchSong } from "../src/engine/QualityBatch";
import { getState, setState } from "../src/engine/AppState";
import { MemoryStorage, resetState } from "./helpers";

// メロディの評価（人が付ける 1〜5 の点数）の保存と集計

type NewRating = Omit<MelodyRating, "id" | "ratedAt">;

function rating(label: string, run: number, score: MelodyRating["score"], extra: Partial<NewRating> = {}): NewRating {
  return {
    label, seed: 1, genre: "EDM", mood: "明るい", run, key: "C", score,
    tags: [], memo: "", auto: { passed: 6, judged: 6 }, signature: `${label === "変更後" ? "new" : "old"}${run}`,
    ...extra,
  };
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("保存", () => {
  it("同じ条件・同じ曲は付け直しになる（条件が違えば別に残る）", () => {
    const first = saveRating(rating("変更前", 0, 2));
    saveRating(rating("変更前", 0, 4));
    saveRating(rating("変更後", 0, 5));
    const list = listRatings();
    expect(list).toHaveLength(2);
    expect(findRating("変更前", songKey(first))?.score).toBe(4);
    expect(findRating("変更前", songKey(first))?.id).toBe(first.id);
  });

  it("条件ごとに消せる", () => {
    saveRating(rating("変更前", 0, 3));
    saveRating(rating("変更後", 0, 3));
    deleteLabel("変更前");
    expect(listRatings().map(r => r.label)).toEqual(["変更後"]);
  });

  it("保存領域が壊れていても空の一覧として読む", () => {
    localStorage.setItem("toniq.ratings", "{壊れた");
    expect(listRatings()).toEqual([]);
  });
});

describe("集計", () => {
  it("条件ごとの平均・分布・ジャンル・自動チェックとの関係を出す", () => {
    saveRating(rating("変更前", 0, 2, { tags: ["monotone"] }));
    saveRating(rating("変更前", 1, 4, { genre: "8bit", auto: { passed: 4, judged: 6 } }));
    const [s] = summarize(listRatings());
    expect(s.label).toBe("変更前");
    expect(s.count).toBe(2);
    expect(s.mean).toBe(3);
    expect(s.dist).toEqual([0, 1, 0, 1, 0]);
    expect(s.tags).toEqual({ monotone: 1 });
    expect(s.genres).toEqual([{ genre: "EDM", count: 1, mean: 2 }, { genre: "8bit", count: 1, mean: 4 }]);
    expect(s.autoAllPass).toEqual({ count: 1, mean: 2 });
    expect(s.autoFailed).toEqual({ count: 1, mean: 4 });
  });

  it("同じ曲どうしで点数の差を比べる（片方しか聴いていない曲は数えない）", () => {
    saveRating(rating("変更前", 0, 2));
    saveRating(rating("変更前", 1, 4));
    saveRating(rating("変更前", 2, 3));
    saveRating(rating("変更後", 0, 4));
    saveRating(rating("変更後", 1, 3));
    saveRating(rating("変更後", 2, 3, { signature: "old2" }));  // メロディが変わらなかった曲
    saveRating(rating("変更後", 3, 5));
    const c = comparePairs(listRatings(), "変更前", "変更後");
    expect(c).toEqual({ pairs: 3, meanDiff: (2 - 1 + 0) / 3, better: 1, worse: 1, same: 1, unchanged: 1 });
  });
});

describe("ファイル", () => {
  it("JSON に書き出して別の端末で読み込める", () => {
    saveRating(rating("変更前", 0, 2));
    saveRating(rating("変更前", 1, 5, { memo: "サビが良い" }));
    const json = ratingsToJson(listRatings());
    vi.stubGlobal("localStorage", new MemoryStorage());
    saveRating(rating("変更前", 0, 4));  // 同じ曲は読み込んだほうで置き換える
    expect(importRatings(json)).toBe(2);
    expect(listRatings()).toHaveLength(2);
    expect(listRatings().map(r => r.score).sort()).toEqual([2, 5]);
  });

  it("評価のファイルでなければ読み込まない", () => {
    expect(() => importRatings(JSON.stringify({ format: "toniq-song", songs: [] }))).toThrow();
  });

  it("CSV はカンマ・引用符を含むメモを囲む", () => {
    saveRating(rating("変更前", 0, 3, { memo: "跳躍が大きい, \"Aメロ\"", tags: ["leapy", "noPeak"] }));
    const csv = ratingsToCsv(listRatings());
    expect(csv.startsWith("﻿条件,")).toBe(true);
    expect(csv).toContain("\"跳躍が大きい, \"\"Aメロ\"\"\"");
    expect(csv).toContain("跳びすぎ 山がない");
    expect(csv).toContain(",1,C,3,");  // 番号は 1 始まり
  });
});

describe("評価画面の曲（一括計測と同じ曲）", () => {
  beforeEach(() => resetState());

  it("同じシード・番号なら同じ曲になり、乱数と画面の設定は元のまま", () => {
    setState({ screen: "rating", noteNames: "doremi" });
    const random = Math.random;
    generateBatchSong(1, "EDM", "明るい", 3);
    const first = structuredClone({ melody: getState().melodyNotes, chorus: getState().chorusMelodyNotes, key: getState().key });
    generateBatchSong(1, "EDM", "明るい", 3);
    expect({ melody: getState().melodyNotes, chorus: getState().chorusMelodyNotes, key: getState().key }).toEqual(first);
    expect(first.key).toBe("D#");  // 12 のキーを順に使う（3 曲目 = D#）
    expect(first.melody.length).toBeGreaterThan(0);
    expect(Math.random).toBe(random);
    expect(getState().screen).toBe("rating");
    expect(getState().noteNames).toBe("doremi");
  });
});
