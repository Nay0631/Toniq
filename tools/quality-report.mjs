// 自動チェックをまとめて測り、生成ルールの良し悪しを数字で比べる（npm run quality）。
// シンプルモードの「生成する」と同じ手順で、ジャンル×雰囲気ごとに何曲も作り（src/engine/QualityBatch.ts）、
// 自動チェック（src/engine/QualityCheck.ts の songMetrics / QUALITY_RULES）の合格率と、曲どうしの多様さを出す。
// 乱数はシードで決まるので、同じシード・回数なら生成ルールを変えた前後で同じ条件で比べられる。
//
//   npm run quality                        全ジャンル×雰囲気を 100 曲ずつ測ってジャンルごとの表を出す（数秒）
//   npm run quality -- --runs 20           1 組あたりの曲数
//   npm run quality -- --seed 7            乱数のシード（初期値 1）
//   npm run quality -- --key A             キーを固定（初期値は 12 のキーを順に使う）
//   npm run quality -- --genre EDM,ハウス  ジャンルを絞る（カンマ区切り）
//   npm run quality -- --detail            ジャンル×雰囲気ごとの表も出す
//   npm run quality -- --save before       結果を output/quality/before.json に保存する
//   npm run quality -- --compare before    保存した結果との差を出す（同じシード・回数・キーで測ること）
//   npm run quality -- --json              結果を JSON で出す
//
// 総合点 = 合否のある項目（強拍・フレーズの終わり・跳躍・サビの高さ・セクション・抜き差し）の合格率の平均（0〜100）。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const OUT = join(root, "output", "quality");

// ===== 引数 =====
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const options = {
  runs:   Number(value("--runs") ?? 100),  // 100 曲ならシードによる総合点のぶれは ±0.2 点ほど（20 曲だと ±1〜2 点）
  seed:   Number(value("--seed") ?? 1),
  key:    value("--key") ?? null,
  genres: value("--genre")?.split(",").map(s => s.trim()).filter(Boolean) ?? null,
};
if (!(options.runs > 0) || !Number.isFinite(options.seed)) {
  console.error("--runs は 1 以上、--seed は数で指定してください");
  process.exit(1);
}

// ===== 測る =====
// Vite で TypeScript・JSON をそのまま読む。vite.config.ts（Electron の起動）は使わない。
// tone は測る処理では使わない（LoopArranger.ts が読み込むだけ）ので、Node で読まないよう空のモジュールにする
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { tone: join(here, "quality-tone-stub.mjs") } },
});
let result;
try {
  const batch = await server.ssrLoadModule("/src/engine/QualityBatch.ts");
  const started = Date.now();
  result = batch.runBatch(options);
  result.elapsedMs = Date.now() - started;
  result.ruleNames = batch.RULE_NAMES;
} finally {
  await server.close();
}

// ===== 集計 =====
const RULE_LABELS = {
  strongFit: "強拍", phraseEnd: "終わり", leap: "跳躍", chorusLift: "サビ高", section: "セクション", drops: "抜き差し",
};

// 複数の組（ジャンル×雰囲気）をまとめる。合格率は数の合計から、平均は組の平均、種類はジャンル内で数え直す
function summarize(combos, label) {
  const pass = {};
  for (const r of result.ruleNames) {
    const ok = combos.reduce((s, c) => s + c.pass[r].ok, 0);
    const judged = combos.reduce((s, c) => s + c.pass[r].judged, 0);
    pass[r] = judged === 0 ? null : ok / judged;
  }
  const rates = Object.values(pass).filter(v => v !== null);
  const mean = f => combos.reduce((s, c) => s + f(c), 0) / Math.max(1, combos.length);
  return {
    label,
    score: rates.length === 0 ? 0 : (rates.reduce((a, b) => a + b, 0) / rates.length) * 100,
    pass,
    strongFit:  mean(c => c.avg.strongFit),
    stepRatio:  mean(c => c.avg.stepRatio),
    maxLeap:    mean(c => c.avg.maxLeap),
    range:      mean(c => c.avg.range),
    chorusLift: mean(c => c.avg.chorusLift),
    notesPerBar: mean(c => c.avg.notesPerBar),
    chords:     mean(c => c.variety.chords),
    melodyUnique: mean(c => c.variety.melodies / c.runs),
    rhythms:    new Set(combos.flatMap(c => c.rhythmSet)).size,
  };
}

const genres = [...new Set(result.combos.map(c => c.genre))];
const rows = genres.map(g => summarize(result.combos.filter(c => c.genre === g), g));
const total = summarize(result.combos, "全体");
const detailRows = result.combos.map(c => summarize([c], `${c.genre}/${c.mood}`));

// ===== 表示 =====
// 全角文字を 2 文字分として幅をそろえる
const width = s => [...String(s)].reduce((w, ch) => w + (/[ᄀ-ￜ]/.test(ch) && !/[｡-ﾟ]/.test(ch) ? 2 : 1), 0);
const pad = (s, n, right = false) => {
  const fill = " ".repeat(Math.max(0, n - width(s)));
  return right ? fill + s : s + fill;
};
const pctText = v => v === null || v === undefined ? "-" : `${Math.round(v * 100)}%`;

const COLUMNS = [
  { head: "",           w: 22, get: r => r.label, left: true },
  { head: "総合点",     w: 6,  get: r => r.score.toFixed(1) },
  ...Object.entries(RULE_LABELS).map(([k, head]) => ({ head, w: Math.max(6, width(head)), get: r => pctText(r.pass[k]) })),
  { head: "順次進行",   w: 8,  get: r => pctText(r.stepRatio) },
  { head: "平均跳躍max", w: 11, get: r => r.maxLeap.toFixed(1) },
  { head: "音域",       w: 5,  get: r => r.range.toFixed(1) },
  { head: "サビ差",     w: 6,  get: r => `${r.chorusLift >= 0 ? "+" : ""}${r.chorusLift.toFixed(1)}` },
  { head: "音/小節",    w: 7,  get: r => r.notesPerBar.toFixed(1) },
  { head: "進行の種類", w: 10, get: r => r.chords.toFixed(1) },
  { head: "リズムの種類", w: 12, get: r => String(r.rhythms) },
  { head: "メロ重複なし", w: 12, get: r => pctText(r.melodyUnique) },
];

function printTable(list) {
  console.log(COLUMNS.map(c => pad(c.head, c.w, !c.left)).join("  "));
  for (const r of list) console.log(COLUMNS.map(c => pad(c.get(r), c.w, !c.left)).join("  "));
}

// 保存した結果との差（総合点・合格率・多様さ）
function printCompare(name) {
  const file = join(OUT, `${name}.json`);
  if (!existsSync(file)) {
    console.error(`比べる結果がありません：${file}（先に --save ${name} で保存してください）`);
    return;
  }
  const base = JSON.parse(readFileSync(file, "utf8"));
  const o = base.options;
  if (o.runs !== options.runs || o.seed !== options.seed || o.key !== options.key) {
    console.log(`※ 条件が違います（保存時：runs ${o.runs}・seed ${o.seed}・key ${o.key ?? "12キー"}）。差は参考です`);
  }
  const baseRows = new Map(base.rows.map(r => [r.label, r]));
  const sign = (v, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
  console.log(`\n■ ${name} との差（今 − 保存時）`);
  const head = ["", "総合点", ...Object.values(RULE_LABELS), "順次進行", "リズムの種類", "メロ重複なし"];
  const ws = [22, 8, ...Object.values(RULE_LABELS).map(h => Math.max(6, width(h))), 8, 12, 12];
  console.log(head.map((h, i) => pad(h, ws[i], i > 0)).join("  "));
  for (const r of [...rows, total]) {
    const b = baseRows.get(r.label);
    if (!b) continue;
    const pts = (a, c) => a === null || c === null ? "-" : sign((a - c) * 100, 0);
    const cells = [
      r.label,
      sign(r.score - b.score),
      ...Object.keys(RULE_LABELS).map(k => pts(r.pass[k], b.pass[k])),
      pts(r.stepRatio, b.stepRatio),
      sign(r.rhythms - b.rhythms, 0),
      pts(r.melodyUnique, b.melodyUnique),
    ];
    console.log(cells.map((c, i) => pad(c, ws[i], i > 0)).join("  "));
  }
  console.log("（総合点は点、合格率・順次進行・メロ重複なしはポイント、リズムの種類は数の差）");
}

const saved = { options, rows: [...rows, total], detail: detailRows, chordDB: result.chordDB, combos: result.combos };

if (flag("--json")) {
  console.log(JSON.stringify(saved, null, 2));
} else {
  console.log(`自動チェックの一括計測：${result.combos.length} 組 × ${options.runs} 曲（seed ${options.seed}・キー ${options.key ?? "12キーを順に"}・${(result.elapsedMs / 1000).toFixed(1)} 秒）\n`);
  printTable([...rows, total]);
  if (flag("--detail")) {
    console.log("");
    printTable(detailRows);
  }
  const db = result.chordDB;
  console.log(`\nコード進行DB：${db.total} 件・変換できない進行 ${db.broken.length} 件${db.broken.length ? `（${db.broken.join(", ")}）` : ""}・サビの相方がない進行 ${db.alone.length} 件${db.alone.length ? `（${db.alone.join(", ")}）` : ""}`);
  console.log("合格率の基準：強拍 = 1・3拍目の頭のコード構成音が 75% 以上／終わり = 各周の最後が主音か構成音（主音が1回以上）／跳躍 = 9 半音以内／サビ高 = サビの平均がAメロより高い／セクション = サビの進行がある／抜き差し = パートが抜ける所がある");
  console.log("多様さ：進行の種類 = 1 組で使われたコード進行の数（平均）／リズムの種類 = メロディの小節のリズムの数（ジャンル内）／メロ重複なし = 同じ Aメロが出なかった割合");
}

if (value("--compare")) printCompare(value("--compare"));

if (value("--save")) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${value("--save")}.json`);
  writeFileSync(file, JSON.stringify(saved, null, 2));
  if (!flag("--json")) console.log(`\n保存しました：${file}`);
}
