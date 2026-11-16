import { getState, setState, SONG_FIELDS, type SongFields } from "../engine/AppState";
import type { LayerName } from "../engine/LayerManager";
import { generateBatchSong, judge, melodySignature } from "../engine/QualityBatch";
import { songMetrics } from "../engine/QualityCheck";
import { sectionAt } from "../engine/SongForm";
import { withoutHistory } from "../engine/History";
import * as Playback from "../engine/Playback";
import {
  RATING_TAGS, type RatingTag, type RatingScore, type MelodyRating,
  listRatings, saveRating, findRating, songKey, summarize, comparePairs,
  ratingsToCsv, ratingsToJson, importRatings, deleteLabel,
} from "../engine/MelodyRatings";
import { saveOutput } from "../engine/OutputFiles";
import { onRender, onScreenChange, render as renderAll } from "./Router";
import { bindSpaceToPlay, isTyping, modalOpen } from "./SpaceKey";
import easyTable from "../data/easy_mode_table.json";

// メロディの評価画面（開発用。設定画面の「開発用」から開く）。
// 一括計測（npm run quality）と同じ手順・シードで曲を作って鳴らし、人が 1〜5 の点数を付ける（MelodyRatings.ts に保存）。
// 聴いている間だけ AppState の曲の内容を差し替え、画面を離れたら元の曲に戻す（元に戻す／やり直すの履歴にも残さない）。
// 条件名・シード・絞り込み・鳴らすパートは localStorage の toniq.ratings.settings、
// 今の曲の番号・選んだタグは表示上の一時的な状態としてこのモジュールに持つ

type PartsMode = "all" | "accomp" | "melody";

interface Settings {
  label: string;
  seed:  number;
  genre: string;  // "" = すべて
  mood:  string;  // "" = すべて
  parts: PartsMode;
}

const SETTINGS_KEY = "toniq.ratings.settings";
const ALL = "";

// 一括計測と同じ順のジャンル×雰囲気
const TABLE = easyTable as Record<string, Record<string, unknown>>;
const COMBOS = Object.keys(TABLE).flatMap(genre => Object.keys(TABLE[genre]).map(mood => ({ genre, mood })));
const GENRES = Object.keys(TABLE);
const MOODS = [...new Set(COMBOS.map(c => c.mood))];

// 伴奏を減らして聴くときに鳴らすパート
const PARTS_ON: Record<Exclude<PartsMode, "all">, LayerName[]> = {
  accomp: ["melody", "chord", "bass"],
  melody: ["melody"],
};

let settings: Settings = loadSettings();
let index = 0;                        // 今の曲の番号（絞り込んだ並びの何曲目か。0 始まり）
let tags = new Set<RatingTag>();      // 今の曲に付けるタグ
let lastResult = "";                  // 直前に点数を付けた曲の結果（自動チェック）
let restore: SongFields | null = null;  // 画面に入る前の曲の内容
let playheadFrame = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSettings(): Settings {
  const fallback: Settings = { label: "変更前", seed: 1, genre: ALL, mood: ALL, parts: "all" };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return saved ? { ...fallback, ...saved } : fallback;
  } catch {
    return fallback;
  }
}

function saveSettings(): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 保存できなくても今の画面には反映する */ }
}

// 絞り込んだジャンル×雰囲気（一括計測と同じ順）
function combos(): { genre: string; mood: string }[] {
  return COMBOS.filter(c => (settings.genre === ALL || c.genre === settings.genre)
    && (settings.mood === ALL || c.mood === settings.mood));
}

// index 曲目の曲（ジャンル×雰囲気を順に回し、1周するごとに一括計測の番号 run を1つ進める）
function songAt(i: number): { genre: string; mood: string; run: number } | null {
  const list = combos();
  if (list.length === 0) return null;
  return { ...list[i % list.length], run: Math.floor(i / list.length) };
}

function currentKey(): string | null {
  const song = songAt(index);
  return song ? songKey({ seed: settings.seed, ...song }) : null;
}

// 今の条件でまだ点数を付けていない最初の曲
function firstUnrated(from = 0): number {
  const rated = new Set(listRatings().filter(r => r.label === settings.label).map(songKey));
  for (let i = from; i < from + 10000; i++) {
    const song = songAt(i);
    if (!song || !rated.has(songKey({ seed: settings.seed, ...song }))) return i;
  }
  return from;
}

// ===== 曲の差し替え =====

function snapshot(): SongFields {
  const s = getState();
  return structuredClone(Object.fromEntries(SONG_FIELDS.map(f => [f, s[f]]))) as SongFields;
}

// index 曲目を AppState に作る
function loadSong(): void {
  const song = songAt(index);
  Playback.stop();
  if (!song) return;
  withoutHistory(() => {
    generateBatchSong(settings.seed, song.genre, song.mood, song.run);
    applyParts();
  });
  const saved = findRating(settings.label, currentKey()!);
  tags = new Set(saved?.tags ?? []);
  $<HTMLInputElement>("rt-memo").value = saved?.memo ?? "";
}

function applyParts(): void {
  const parts = { ...getState().parts };
  for (const layer of Object.keys(parts) as LayerName[]) {
    parts[layer] = settings.parts === "all" || PARTS_ON[settings.parts].includes(layer);
  }
  withoutHistory(() => setState({ parts }));
}

function enter(): void {
  restore = snapshot();
  index = firstUnrated();
  lastResult = "";
  loadSong();
}

function leave(): void {
  Playback.stop();
  cancelAnimationFrame(playheadFrame);
  if (restore) {
    const saved = restore;
    withoutHistory(() => setState(saved));
    restore = null;
  }
}

// ===== 再生 =====

function chorusStartBar(): number {
  const bars = getState().bars;
  for (let bar = 0; bar < bars; bar++) if (sectionAt(bar) === "B") return bar;
  return 0;
}

async function play(fromBar = 0): Promise<void> {
  await Playback.play({ fromBar, onEnded: render });
  startPlayhead();
  render();
}

function togglePlay(): void {
  if (Playback.isPlaying()) {
    Playback.stop();
    render();
  } else {
    void play();
  }
}

function startPlayhead(): void {
  cancelAnimationFrame(playheadFrame);
  const tick = () => {
    renderPosition();
    if (Playback.isPlaying() && getState().screen === "rating") playheadFrame = requestAnimationFrame(tick);
  };
  tick();
}

function renderPosition(): void {
  const s = getState();
  const pos = $("rt-pos");
  if (!Playback.isPlaying()) {
    pos.textContent = `${s.bars} 小節・BPM ${s.bpm}`;
    return;
  }
  const bar = Math.min(s.bars - 1, Math.floor(Playback.getPositionBars()));
  pos.textContent = `${bar + 1} / ${s.bars} 小節（${sectionAt(bar) === "B" ? "サビ" : "Aメロ"}）`;
}

// ===== 点数 =====

function rate(score: RatingScore): void {
  const song = songAt(index);
  const s = getState();
  if (!song) return;
  const verdict = judge(songMetrics());
  const judged = Object.values(verdict).filter(v => v !== null);
  const auto = { passed: judged.filter(v => v).length, judged: judged.length };
  try {
    saveRating({
      label: settings.label, seed: settings.seed, ...song, key: s.key, score,
      tags: [...tags], memo: $<HTMLInputElement>("rt-memo").value.trim(), auto,
      signature: `${melodySignature(s.melodyNotes, s.key)}|${melodySignature(s.chorusMelodyNotes, s.key)}`,
    });
  } catch (e) {
    console.error("評価を保存できませんでした:", e);
    alert("評価を保存できませんでした（保存領域がいっぱいかもしれません）。CSV / JSON に書き出してから古い条件を消してください。");
    return;
  }
  const failed = Object.entries(verdict).filter(([, v]) => v === false).map(([k]) => k);
  lastResult = `No.${index + 1} を ${score} 点で保存しました。自動チェック ${auto.passed} / ${auto.judged} 合格`
    + (failed.length > 0 ? `（不合格：${failed.join("・")}）` : "");
  const wasPlaying = Playback.isPlaying();
  index = firstUnrated(index + 1);
  loadSong();
  if (wasPlaying) void play();
  render();
}

function move(delta: number): void {
  index = Math.max(0, index + delta);
  lastResult = "";
  loadSong();
  render();
}

// ===== 表示 =====

function fillSelect(id: string, values: string[], selected: string, allLabel?: string): void {
  const el = $<HTMLSelectElement>(id);
  const options = (allLabel !== undefined ? [[ALL, allLabel]] : []).concat(values.map(v => [v, v]));
  el.replaceChildren(...options.map(([value, text]) => new Option(text, value, false, value === selected)));
  el.value = selected;
}

function labels(list: MelodyRating[]): string[] {
  return summarize(list).map(x => x.label);
}

function render(): void {
  if (getState().screen !== "rating") return;
  const s = getState();
  const song = songAt(index);
  const list = listRatings();

  const labelInput = $<HTMLInputElement>("rt-label");
  if (document.activeElement !== labelInput) labelInput.value = settings.label;
  $("rt-labels").replaceChildren(...labels(list).map(l => new Option(l)));
  const seedInput = $<HTMLInputElement>("rt-seed");
  if (document.activeElement !== seedInput) seedInput.value = String(settings.seed);
  document.querySelectorAll<HTMLElement>("[data-rt-parts]").forEach(btn => {
    const on = btn.dataset.rtParts === settings.parts;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-checked", String(on));
  });

  // 今の曲
  const ratedCount = list.filter(r => r.label === settings.label && r.seed === settings.seed
    && combos().some(c => c.genre === r.genre && c.mood === r.mood)).length;
  $("rt-no").textContent = song ? `No.${index + 1}` : "曲がありません";
  $("rt-info").textContent = song
    ? `${song.genre} / ${song.mood} ・ キー ${s.key} ・ ${song.run + 1} 周目 ・ 条件「${settings.label}」で評価済み ${ratedCount} 曲`
    : "ジャンル・雰囲気の組み合わせがありません";
  const saved = song ? findRating(settings.label, currentKey()!) : undefined;
  document.querySelectorAll<HTMLElement>("[data-rt-score]").forEach(btn => {
    const on = Number(btn.dataset.rtScore) === saved?.score;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-checked", String(on));
  });
  document.querySelectorAll<HTMLElement>("[data-rt-tag]").forEach(btn => {
    btn.classList.toggle("is-active", tags.has(btn.dataset.rtTag as RatingTag));
  });
  $<HTMLButtonElement>("rt-prev-song").disabled = index === 0;
  $("rt-play").textContent = Playback.isPlaying() ? "■ 停止" : "▷ 再生";
  $("rt-result").textContent = lastResult || (saved ? `この曲は ${saved.score} 点を付けています（押し直すと付け直します）` : "");
  renderPosition();

  renderSummary(list);
}

function renderSummary(list: MelodyRating[]): void {
  const summaries = summarize(list);
  const names = summaries.map(x => x.label);
  const a = $<HTMLSelectElement>("rt-cmp-a"), b = $<HTMLSelectElement>("rt-cmp-b");
  // 初めは古い条件 → 新しい条件。同じ条件どうしになったら（条件が1つだったときなど）新しいほうに付け直す
  const valueA = names.includes(a.value) ? a.value : names[0] ?? "";
  let valueB = names.includes(b.value) ? b.value : names[names.length - 1] ?? "";
  if (valueB === valueA) valueB = [...names].reverse().find(n => n !== valueA) ?? valueA;
  fillSelect("rt-cmp-a", names, valueA);
  fillSelect("rt-cmp-b", names, valueB);

  const compare = $("rt-compare");
  if (names.length < 2 || a.value === b.value) {
    compare.textContent = names.length < 2 ? "条件が2つ以上になると比べられます" : "";
  } else {
    const c = comparePairs(list, a.value, b.value);
    compare.textContent = c.pairs === 0
      ? "同じ曲（同じシード・番号）を両方で聴いたものがありません"
      : `同じ曲 ${c.pairs} 曲：平均 ${c.meanDiff >= 0 ? "+" : ""}${c.meanDiff.toFixed(2)} 点`
        + `（上がった ${c.better}・下がった ${c.worse}・同じ ${c.same}`
        + (c.unchanged > 0 ? `。メロディが同じだった曲 ${c.unchanged}` : "") + "）";
  }

  const wrap = $("rt-summary");
  const genresWrap = $("rt-genres");
  if (summaries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rating-empty";
    empty.textContent = "まだ評価がありません。";
    wrap.replaceChildren(empty);
    genresWrap.replaceChildren();
    return;
  }

  const fmt = (n: number, count: number) => count === 0 ? "—" : n.toFixed(2);
  const table = document.createElement("table");
  table.className = "rating-table";
  table.innerHTML = "<thead><tr><th>条件</th><th class=\"num\">曲数</th><th class=\"num\">平均</th><th>分布（1〜5）</th>"
    + "<th class=\"num\">自動チェック全合格</th><th class=\"num\">不合格あり</th><th>多かったタグ</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const x of summaries) {
    const tr = document.createElement("tr");
    const max = Math.max(1, ...x.dist);
    const topTags = (Object.entries(x.tags) as [RatingTag, number][])
      .sort((p, q) => q[1] - p[1]).slice(0, 3).map(([t, n]) => `${RATING_TAGS[t] ?? t} ${n}`).join("・");
    const cells: (string | Node)[] = [
      x.label, String(x.count), x.mean.toFixed(2), distBars(x.dist, max),
      `${fmt(x.autoAllPass.mean, x.autoAllPass.count)}（${x.autoAllPass.count}）`,
      `${fmt(x.autoFailed.mean, x.autoFailed.count)}（${x.autoFailed.count}）`,
      topTags || "—",
    ];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      if ([1, 2, 4, 5].includes(i)) td.className = "num";
      td.append(c);
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body);
  wrap.replaceChildren(table);

  // ジャンルごとの平均（条件を列に並べる）
  const genres = GENRES.filter(g => summaries.some(x => x.genres.some(y => y.genre === g)));
  const gTable = document.createElement("table");
  gTable.className = "rating-table";
  const head = document.createElement("tr");
  ["ジャンル", ...names].forEach((t, i) => {
    const th = document.createElement("th");
    th.textContent = t;
    if (i > 0) th.className = "num";
    head.append(th);
  });
  const gHead = document.createElement("thead");
  gHead.append(head);
  const gBody = document.createElement("tbody");
  for (const g of genres) {
    const tr = document.createElement("tr");
    const th = document.createElement("td");
    th.textContent = g;
    tr.append(th);
    for (const x of summaries) {
      const y = x.genres.find(v => v.genre === g);
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = y ? `${y.mean.toFixed(2)}（${y.count}）` : "—";
      tr.append(td);
    }
    gBody.append(tr);
  }
  gTable.append(gHead, gBody);
  genresWrap.replaceChildren(gTable);
}

function distBars(dist: number[], max: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "rating-dist";
  el.title = dist.map((n, i) => `${i + 1}点：${n}`).join(" / ");
  for (const n of dist) {
    const bar = document.createElement("i");
    bar.style.height = `${Math.round((n / max) * 100)}%`;
    el.append(bar);
  }
  return el;
}

// ===== イベント =====

function changeSettings(partial: Partial<Settings>): void {
  settings = { ...settings, ...partial };
  saveSettings();
  lastResult = "";
  index = firstUnrated();
  loadSong();
  render();
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function initRatingScreen(): void {
  onRender(render);
  onScreenChange((prev, next) => {
    if (prev === "rating") leave();
    if (next === "rating") enter();
  });

  fillSelect("rt-genre", GENRES, settings.genre, "すべて");
  fillSelect("rt-mood", MOODS, settings.mood, "すべて");
  $("rt-tags").replaceChildren(...(Object.entries(RATING_TAGS) as [RatingTag, string][]).map(([tag, text]) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.rtTag = tag;
    btn.textContent = text;
    btn.addEventListener("click", () => {
      if (tags.has(tag)) tags.delete(tag); else tags.add(tag);
      render();
    });
    return btn;
  }));

  $<HTMLInputElement>("rt-label").addEventListener("change", e => {
    const label = (e.target as HTMLInputElement).value.trim();
    if (label) changeSettings({ label }); else render();
  });
  $<HTMLInputElement>("rt-seed").addEventListener("change", e => {
    const seed = Math.trunc(Number((e.target as HTMLInputElement).value));
    if (Number.isFinite(seed)) changeSettings({ seed }); else render();
  });
  $<HTMLSelectElement>("rt-genre").addEventListener("change", e => changeSettings({ genre: (e.target as HTMLSelectElement).value }));
  $<HTMLSelectElement>("rt-mood").addEventListener("change", e => changeSettings({ mood: (e.target as HTMLSelectElement).value }));
  document.querySelectorAll<HTMLElement>("[data-rt-parts]").forEach(btn => btn.addEventListener("click", () => {
    settings = { ...settings, parts: btn.dataset.rtParts as PartsMode };
    saveSettings();
    applyParts();
    if (Playback.isPlaying()) void play();  // パートは読み込み時に決まるので鳴らし直す
    render();
  }));

  $("rt-play").addEventListener("click", togglePlay);
  $("rt-play-chorus").addEventListener("click", () => void play(chorusStartBar()));
  $("rt-prev-song").addEventListener("click", () => move(-1));
  $("rt-next-song").addEventListener("click", () => move(1));
  $("rt-next-unrated").addEventListener("click", () => {
    index = firstUnrated();
    lastResult = "";
    loadSong();
    render();
  });
  document.querySelectorAll<HTMLElement>("[data-rt-score]").forEach(btn =>
    btn.addEventListener("click", () => rate(Number(btn.dataset.rtScore) as RatingScore)));

  $("rt-cmp-a").addEventListener("change", render);
  $("rt-cmp-b").addEventListener("change", render);

  $("rt-export-csv").addEventListener("click", () =>
    void saveOutput("quality", new Blob([ratingsToCsv(listRatings())], { type: "text/csv" }), `toniq_ratings_${today()}.csv`));
  $("rt-export-json").addEventListener("click", () =>
    void saveOutput("quality", new Blob([ratingsToJson(listRatings())], { type: "application/json" }), `toniq_ratings_${today()}.json`));
  $("rt-import").addEventListener("click", () => $<HTMLInputElement>("rt-import-file").click());
  $<HTMLInputElement>("rt-import-file").addEventListener("change", async e => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const count = importRatings(await file.text());
      alert(`${count} 件の評価を読み込みました。`);
    } catch (err) {
      alert(`読み込めませんでした：${err instanceof Error ? err.message : String(err)}`);
    }
    render();
  });
  $("rt-delete-label").addEventListener("click", () => {
    const count = listRatings().filter(r => r.label === settings.label).length;
    if (count === 0) return alert(`条件「${settings.label}」の評価はありません。`);
    if (!confirm(`条件「${settings.label}」の評価 ${count} 件を消します。元に戻せません。よろしいですか？`)) return;
    try { deleteLabel(settings.label); } catch (err) { console.error(err); }
    index = firstUnrated();
    loadSong();
    renderAll();
  });

  bindSpaceToPlay(() => getState().screen === "rating", () => play());
  document.addEventListener("keydown", e => {
    if (getState().screen !== "rating" || isTyping(e.target) || modalOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (/^[1-5]$/.test(e.key)) rate(Number(e.key) as RatingScore);
    else if (e.key === "c" || e.key === "C") void play(chorusStartBar());
    else if (e.key === "ArrowLeft") move(-1);
    else if (e.key === "ArrowRight") move(1);
    else return;
    e.preventDefault();
  });
}
