// メロディの評価（人が聴いて 1〜5 で付ける点数）の保存と集計。
// 曲は一括計測（npm run quality）と同じ手順・同じシードで作るので（QualityBatch.ts の generateBatchSong）、
// 生成ルールを変える前に「条件名」を変更前にして聴き、変えたあと変更後にして同じ番号の曲を聴くと、
// 同じ曲どうし（同じシード・ジャンル・雰囲気・番号）で点数を比べられる。
// 保存先は localStorage の toniq.ratings（開発用の記録。曲には保存しない）

export type RatingScore = 1 | 2 | 3 | 4 | 5;

// 気になった点・よかった点（任意。生成ルールの改善の項目に合わせる）
export const RATING_TAGS = {
  catchy:    "覚えやすい",
  natural:   "流れが自然",
  monotone:  "単調",
  leapy:     "跳びすぎ",
  noPeak:    "山がない",
  rhythm:    "リズムが不自然",
  ending:    "終わり方が不自然",
  chorus:    "サビが弱い",
} as const;
export type RatingTag = keyof typeof RATING_TAGS;

export interface MelodyRating {
  id:        string;
  label:     string;   // 条件名（変更前・変更後など）
  seed:      number;
  genre:     string;
  mood:      string;
  run:       number;   // 一括計測の何曲目か（0 始まり）
  key:       string;
  score:     RatingScore;
  tags:      RatingTag[];
  memo:      string;
  auto:      { passed: number; judged: number };  // 自動チェックの合格数（比べる参考）
  signature: string;   // メロディの中身。同じ番号でも条件で変わったかを見る
  ratedAt:   number;
}

// 同じ曲（条件が違っても同じ番号の曲）を表す文字列
export function songKey(r: Pick<MelodyRating, "seed" | "genre" | "mood" | "run">): string {
  return `${r.seed}/${r.genre}/${r.mood}/${r.run}`;
}

const STORAGE_KEY = "toniq.ratings";
const FILE_FORMAT = "toniq-ratings";

export function listRatings(): MelodyRating[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isRating) : [];
  } catch {
    return [];
  }
}

// 書き込めない（容量オーバーなど）ときは例外をそのまま投げる（画面側で知らせる）
function writeRatings(list: MelodyRating[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function isRating(v: unknown): v is MelodyRating {
  const r = v as MelodyRating;
  return !!r && typeof r === "object" && typeof r.label === "string" && typeof r.genre === "string"
    && typeof r.mood === "string" && typeof r.run === "number" && typeof r.seed === "number"
    && [1, 2, 3, 4, 5].includes(r.score);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 同じ条件名・同じ曲の点数があれば付け直す
export function saveRating(rating: Omit<MelodyRating, "id" | "ratedAt">): MelodyRating {
  const list = listRatings();
  const i = list.findIndex(r => r.label === rating.label && songKey(r) === songKey(rating));
  const saved: MelodyRating = { ...rating, id: i >= 0 ? list[i].id : newId(), ratedAt: Date.now() };
  if (i >= 0) list[i] = saved; else list.push(saved);
  writeRatings(list);
  return saved;
}

export function findRating(label: string, key: string): MelodyRating | undefined {
  return listRatings().find(r => r.label === label && songKey(r) === key);
}

export function deleteRating(id: string): void {
  writeRatings(listRatings().filter(r => r.id !== id));
}

export function deleteLabel(label: string): void {
  writeRatings(listRatings().filter(r => r.label !== label));
}

// ===== 集計 =====

export interface LabelSummary {
  label:  string;
  count:  number;
  mean:   number;
  dist:   number[];  // 1〜5 点の数（添字 0 = 1 点）
  tags:   Partial<Record<RatingTag, number>>;
  genres: { genre: string; count: number; mean: number }[];
  autoAllPass: { count: number; mean: number };  // 自動チェックがすべて合格した曲
  autoFailed:  { count: number; mean: number };  // 1つ以上不合格の曲
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

// 条件名ごとの点数（記録の古い順に条件を並べる）
export function summarize(list: MelodyRating[]): LabelSummary[] {
  const labels = [...new Set([...list].sort((a, b) => a.ratedAt - b.ratedAt).map(r => r.label))];
  return labels.map(label => {
    const rs = list.filter(r => r.label === label);
    const dist = [0, 0, 0, 0, 0];
    const tags: LabelSummary["tags"] = {};
    for (const r of rs) {
      dist[r.score - 1]++;
      for (const t of r.tags) tags[t] = (tags[t] ?? 0) + 1;
    }
    const genres = [...new Set(rs.map(r => r.genre))].map(genre => {
      const scores = rs.filter(r => r.genre === genre).map(r => r.score);
      return { genre, count: scores.length, mean: mean(scores) };
    });
    const allPass = rs.filter(r => r.auto.judged > 0 && r.auto.passed === r.auto.judged).map(r => r.score);
    const failed  = rs.filter(r => r.auto.passed < r.auto.judged).map(r => r.score);
    return {
      label, count: rs.length, mean: mean(rs.map(r => r.score)), dist, tags, genres,
      autoAllPass: { count: allPass.length, mean: mean(allPass) },
      autoFailed:  { count: failed.length,  mean: mean(failed) },
    };
  });
}

export interface PairComparison {
  pairs:     number;  // 両方の条件で聴いた曲の数
  meanDiff:  number;  // b − a の点数の平均
  better:    number;  // b のほうが高い
  worse:     number;
  same:      number;
  unchanged: number;  // メロディが同じだった曲（ルールの変更が届いていない）
}

// 同じ曲を2つの条件で聴いた点数を比べる（b − a）
export function comparePairs(list: MelodyRating[], a: string, b: string): PairComparison {
  const before = new Map(list.filter(r => r.label === a).map(r => [songKey(r), r]));
  const result: PairComparison = { pairs: 0, meanDiff: 0, better: 0, worse: 0, same: 0, unchanged: 0 };
  let sum = 0;
  for (const r of list.filter(x => x.label === b)) {
    const base = before.get(songKey(r));
    if (!base) continue;
    result.pairs++;
    const diff = r.score - base.score;
    sum += diff;
    if (diff > 0) result.better++; else if (diff < 0) result.worse++; else result.same++;
    if (r.signature === base.signature) result.unchanged++;
  }
  result.meanDiff = result.pairs === 0 ? 0 : sum / result.pairs;
  return result;
}

// ===== ファイル =====

export function ratingsToJson(list: MelodyRating[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), ratings: list }, null, 2);
}

function csvCell(v: string | number): string {
  const text = String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function ratingsToCsv(list: MelodyRating[]): string {
  const head = ["条件", "シード", "ジャンル", "雰囲気", "番号", "キー", "点数", "タグ", "メモ", "自動チェック合格", "自動チェック判定", "日時"];
  const rows = list.map(r => [
    r.label, r.seed, r.genre, r.mood, r.run + 1, r.key, r.score,
    r.tags.map(t => RATING_TAGS[t] ?? t).join(" "), r.memo, r.auto.passed, r.auto.judged,
    new Date(r.ratedAt).toISOString(),
  ].map(csvCell).join(","));
  // Excel で文字化けしないよう BOM を付ける
  return `﻿${[head.join(","), ...rows].join("\r\n")}\r\n`;
}

// 書き出した JSON を読み込んで足す（同じ ID・同じ条件と曲の点数は読み込んだほうで置き換える）。足した数を返す
export function importRatings(text: string): number {
  const data = JSON.parse(text);
  if (data?.format !== FILE_FORMAT || !Array.isArray(data.ratings)) throw new Error("評価のファイルではありません");
  const incoming = (data.ratings as unknown[]).filter(isRating);
  const list = listRatings();
  for (const r of incoming) {
    const i = list.findIndex(x => x.id === r.id || (x.label === r.label && songKey(x) === songKey(r)));
    const rating = { ...r, tags: Array.isArray(r.tags) ? r.tags : [], memo: r.memo ?? "", auto: r.auto ?? { passed: 0, judged: 0 } };
    if (i >= 0) list[i] = rating; else list.push(rating);
  }
  writeRatings(list);
  return incoming.length;
}
