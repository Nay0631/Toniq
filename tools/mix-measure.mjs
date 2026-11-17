// ミックスの一括計測（npm run mix:measure）。ジャンルごとに曲を作って書き出し、ピークと統合ラウドネスを測って、
// 全ジャンルの聞こえる大きさをそろえる mix_presets.json の gain を提案する。
// 一括計測（npm run quality）と同じ手順・シードで曲を作り（QualityBatch.ts の generateBatchSong）、
// アプリの書き出しと同じ手順（Playback.ts の renderSong）で合成するので、実際に書き出した WAV と同じ音を測る。
// 音の合成にはブラウザ（Web Audio・AudioWorklet）が要るので、Electron を起動しない Vite と、画面なしの Chrome（なければ Edge）を使う。
//
//   npm run mix:measure                          全ジャンル × 雰囲気（激しい・落ち着いた）を 1 曲ずつ（1 曲 20〜40 秒）
//   npm run mix:measure -- --genre EDM,ハウス    ジャンルを絞る（カンマ区切り）
//   npm run mix:measure -- --mood 激しい         雰囲気（カンマ区切り）
//   npm run mix:measure -- --runs 2              1 組あたりの曲数
//   npm run mix:measure -- --seed 7              乱数のシード（初期値 1）
//   npm run mix:measure -- --drum synth          ドラムの音源（grow（初期値）／ synth）
//   npm run mix:measure -- --parts chord,pad     鳴らすパートを絞る（カンマ区切り。パートごとの大きさ・左右の偏りを見る。gain の提案には使わない）
//   npm run mix:measure -- --target -16.5          そろえる統合ラウドネス（LUFS。初期値は下の TARGET_LUFS）
//   npm run mix:measure -- --save before         結果を output/quality/mix-before.json に保存する
//   npm run mix:measure -- --compare before      保存した結果との差を出す
//   npm run mix:measure -- --chrome <パス>       ブラウザの場所（環境変数 CHROME_PATH でも可）
//
// 提案の gain は「今の gain ＋（目標 − 測った統合ラウドネスの平均）」。gain（持ち上げ）はコンプのあと・リミッターの前なので、
// リミッターに当たらない範囲ではそのまま足し算になる。ピークが PEAK_LIMIT を超える見込みのジャンルには印を付ける。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const OUT  = join(root, "output", "quality");

// そろえる統合ラウドネス（LUFS）と、超えてはいけないピーク（dBFS）。docs/sound.md の「音量」
const TARGET_LUFS = -16.5;
const PEAK_LIMIT  = -1;

// ===== 引数 =====
const args  = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const list  = name => value(name)?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const options = {
  genres: list("--genre"),
  moods:  list("--mood") ?? ["激しい", "落ち着いた"],
  runs:   Number(value("--runs") ?? 1),
  seed:   Number(value("--seed") ?? 1),
  drum:   value("--drum") ?? "grow",
  parts:  list("--parts"),
  target: Number(value("--target") ?? TARGET_LUFS),
};
if (!(options.runs > 0) || !Number.isFinite(options.seed) || !Number.isFinite(options.target)) {
  console.error("--runs は 1 以上、--seed・--target は数で指定してください");
  process.exit(1);
}

function findBrowser() {
  const candidates = [
    value("--chrome"), process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return candidates.find(p => p && existsSync(p));
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error("Chrome / Edge が見つかりません。--chrome <パス> か環境変数 CHROME_PATH で場所を指定してください");
  process.exit(1);
}

const presets = JSON.parse(readFileSync(join(root, "src", "data", "mix_presets.json"), "utf8"));
const table   = JSON.parse(readFileSync(join(root, "src", "data", "easy_mode_table.json"), "utf8"));
const genres  = (options.genres ?? Object.keys(table)).filter(g => table[g]);

// ===== Vite（Electron を起動しないので vite.config.ts は使わない）とブラウザ =====
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  server: { port: 5199, hmr: false },
  optimizeDeps: { include: ["tone", "@tonejs/midi", "@breezystack/lamejs"] },
});
await server.listen();
const pageUrl = server.resolvedUrls.local[0];

const DEBUG_PORT = Number(value("--port") ?? 9333);
const profile = mkdtempSync(join(tmpdir(), "toniq-mix-"));
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--disable-extensions", pageUrl,
], { stdio: "ignore" });

async function cleanup() {
  browser.kill();
  await server.close();
  // ブラウザが閉じきるまでプロファイルのファイルを消せないことがあるので、少し待ってから消す（消せなくても続ける）
  await new Promise(resolve => setTimeout(resolve, 500));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 一時フォルダなので残っても困らない */ }
}

// ページにつなぐ（DevTools のプロトコル。Runtime.evaluate で式を実行して結果を受け取る）
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = targets.find(t => t.type === "page" && t.url.startsWith(pageUrl));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        return ws;
      }
    } catch { /* まだ起動していない */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("ブラウザにつなげませんでした");
}

let nextId = 1;
const waiting = new Map();
function evaluate(ws, expression) {
  const id = nextId++;
  // 書き出しは長くかかるので時間切れは付けない
  ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

// ページの中で 1 曲作って書き出し、測る
const measureInPage = (genre, mood, run) => `(async () => {
  const [State, Batch, Playback, Loud] = await Promise.all([
    import("/src/engine/AppState.ts"), import("/src/engine/QualityBatch.ts"),
    import("/src/engine/Playback.ts"), import("/tools/loudness.mjs"),
  ]);
  State.setState({ drumSource: ${JSON.stringify(options.drum)} });
  Batch.generateBatchSong(${options.seed}, ${JSON.stringify(genre)}, ${JSON.stringify(mood)}, ${run});
  const only = ${JSON.stringify(options.parts)};
  if (only) {
    const parts = { ...State.getState().parts };
    for (const part of Object.keys(parts)) parts[part] = only.includes(part);
    State.setState({ parts });
  }
  const buffer = await Playback.renderSong();
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  return Loud.analyze(L, R, buffer.sampleRate);
})()`;

const songs = [];
try {
  const ws = await connect();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    const failed = msg.error ?? msg.result?.exceptionDetails;
    if (failed) w.reject(new Error(failed.exception?.description ?? failed.text ?? failed.message ?? "ページでエラー"));
    else w.resolve(msg.result.result.value);
  };
  // アプリの読み込みが終わるまで待つ
  await evaluate(ws, `new Promise(resolve => document.readyState === "complete" ? resolve() : addEventListener("load", () => resolve()))`);

  const f = v => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : "  -inf");
  console.log(`ミックスの計測（シード ${options.seed}・ドラム ${options.drum}・目標 ${options.target} LUFS${options.parts ? `・パート ${options.parts.join(" / ")} だけ` : ""}）`);
  for (const genre of genres) {
    for (const mood of options.moods.filter(m => table[genre][m])) {
      for (let run = 0; run < options.runs; run++) {
        const r = await evaluate(ws, measureInPage(genre, mood, run));
        songs.push({ genre, mood, run, ...r });
        console.log(`  ${genre}・${mood} #${run}  ピーク ${f(r.peak)} dBFS  統合 ${f(r.integrated)} LUFS  最大 ${f(r.momentary)} LUFS  左右の差 ${f(r.balance)} dB`);
      }
    }
  }
  ws.close();
} finally {
  await cleanup();
}

// ===== 集計 =====
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const summary = genres.filter(g => songs.some(s => s.genre === g)).map(genre => {
  const own = songs.filter(s => s.genre === genre);
  const integrated = mean(own.map(s => s.integrated));
  const peak = Math.max(...own.map(s => s.peak));
  const gain = presets[genre]?.gain ?? 0;
  const delta = options.target - integrated;
  return { genre, songs: own.length, integrated, peak, gain, suggested: Math.round((gain + delta) * 2) / 2, peakAfter: peak + delta };
});

const prevPath = value("--compare") ? join(OUT, `mix-${value("--compare")}.json`) : null;
const prev = prevPath && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
if (prevPath && !prev) console.error(`比べる結果がありません：${prevPath}`);

const f = (v, sign = false) => (Number.isFinite(v) ? `${sign && v >= 0 ? "+" : ""}${v.toFixed(1)}` : "-inf").padStart(6);
console.log("\nジャンル        曲  統合LUFS  ピーク   gain → 提案  提案後のピーク" + (prev ? "   前回との差（統合 / ピーク）" : ""));
for (const s of summary) {
  const over = s.peakAfter > PEAK_LIMIT ? `（${PEAK_LIMIT}dB 超）` : "";
  const p = prev?.summary.find(x => x.genre === s.genre);
  const diff = p ? `   ${f(s.integrated - p.integrated, true)} / ${f(s.peak - p.peak, true)}` : "";
  console.log(`${s.genre.padEnd(10, "　")} ${String(s.songs).padStart(2)}   ${f(s.integrated)}  ${f(s.peak)}  ${f(s.gain)} → ${f(s.suggested)}   ${f(s.peakAfter)} ${over}${diff}`);
}
const spread = Math.max(...summary.map(s => s.integrated)) - Math.min(...summary.map(s => s.integrated));
console.log(`ジャンル間の差（統合ラウドネスの最大 − 最小）：${spread.toFixed(1)} LU`);

if (value("--save")) {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `mix-${value("--save")}.json`);
  writeFileSync(path, JSON.stringify({ options, songs, summary }, null, 2));
  console.log(`保存：${path}`);
}
