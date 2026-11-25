import { getState, setState, type MusicListFileType, type MusicListSort } from "../engine/AppState";
import {
  hasOutputFolder, listOutputFiles, openOutputFolder, outputFileType, outputFileUrl, showOutputFile, trashOutputFile,
  type OutputFileInfo, type OutputFileType,
} from "../engine/OutputFiles";
import * as Playback from "../engine/Playback";
import { formatTime } from "./format";

// ミュージックリストの「書き出したファイル」：output/audio・output/midi にある WAV・MP3・MIDI の一覧。
// 種類で絞り込み、WAV・MP3 はその場で聴ける（曲の再生（Tone.js）とは別に <audio> で鳴らす）。
// 一覧は出力フォルダから読むので Electron のときだけ。ブラウザでは書き出しがダウンロードになるため案内だけ出す

const $ = (id: string) => document.getElementById(id);

const TYPE_LABELS: Record<OutputFileType, string> = { wav: "WAV", mp3: "MP3", midi: "MIDI" };
const TYPE_VALUES: readonly MusicListFileType[] = ["", "wav", "mp3", "midi"];
const SORT_VALUES: readonly MusicListSort[] = ["newest", "oldest", "name"];

const ICON_PLAY   = `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
const ICON_STOP   = `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;
const ICON_MIDI   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v8M12 5v8M16 5v8"/></svg>`;
const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>`;
const ICON_TRASH  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>`;

// 表示上の一時的な状態：読み込んだ一覧（null = まだ読んでいない）と、聴いているファイル
let files: OutputFileInfo[] | null = null;
let loadError: string | null = null;
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let playingPath: string | null = null;
const durations = new Map<string, number>();  // 聴いたファイルの長さ（秒）。読み込んだときに分かる

let rerender: () => void = () => {};

// 出力フォルダを読み直す（画面に入ったとき・書き出したあと・「↻ 更新」）
export async function refreshOutputFiles(): Promise<void> {
  if (!hasOutputFolder()) return;
  try {
    files = await listOutputFiles();
    loadError = null;
  } catch (e) {
    console.error("書き出したファイルの一覧を読めませんでした:", e);
    loadError = e instanceof Error ? e.message : String(e);
  }
  rerender();
}

// 聴いているファイルを止める（曲の再生を始めたとき・画面や表示を切り替えたとき）
export function stopFilePlayback(): void {
  if (audio) {
    audio.pause();
    audio.src = "";
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audio = null;
  audioUrl = null;
  if (playingPath !== null) {
    playingPath = null;
    rerender();
  }
}

export function isFilePlaying(): boolean {
  return playingPath !== null;
}

async function togglePlay(file: OutputFileInfo): Promise<void> {
  const same = playingPath === file.path;
  stopFilePlayback();
  if (same) return;
  Playback.stop();  // 曲の再生とは重ねない
  rerender();
  playingPath = file.path;
  try {
    const url = await outputFileUrl(file);
    if (playingPath !== file.path) {  // 読み込んでいる間に別の操作があった
      URL.revokeObjectURL(url);
      return;
    }
    audioUrl = url;
    audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => {
      if (audio && Number.isFinite(audio.duration)) durations.set(file.path, audio.duration);
    });
    audio.addEventListener("ended", stopFilePlayback);
    await audio.play();
    rerender();
    startProgressLoop();
  } catch (e) {
    console.error("ファイルを再生できませんでした:", e);
    stopFilePlayback();
    alert(`「${file.name}」を再生できませんでした。\nファイルが移動・削除されていないか確かめてください。`);
    await refreshOutputFiles();
  }
}

async function trash(file: OutputFileInfo): Promise<void> {
  if (!confirm(`「${file.name}」をごみ箱へ移しますか？\n（ごみ箱から元に戻せます）`)) return;
  if (playingPath === file.path) stopFilePlayback();
  try {
    await trashOutputFile(file);
  } catch (e) {
    alert(`ごみ箱へ移せませんでした。\n${e instanceof Error ? e.message : String(e)}`);
  }
  await refreshOutputFiles();
}

// ===== 表示 =====

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function visibleFiles(all: OutputFileInfo[]): OutputFileInfo[] {
  const s = getState();
  const filtered = all.filter(f => !s.musicListFileType || outputFileType(f) === s.musicListFileType);
  if (s.musicListSort === "oldest") return filtered.sort((a, b) => a.mtime - b.mtime);
  if (s.musicListSort === "name")   return filtered.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return filtered.sort((a, b) => b.mtime - a.mtime);
}

function fileRow(file: OutputFileInfo): string {
  const type    = outputFileType(file) ?? "wav";
  const playing = playingPath === file.path;
  const time    = durations.get(file.path);
  const play = type === "midi"
    ? `<span class="song-play file-midi" title="MIDI は DAW などの作曲ソフトで開いて使います（ここでは再生できません）">${ICON_MIDI}</span>`
    : `<button class="song-play" data-file-action="play" aria-label="${playing ? "停止" : "再生"}">${playing ? ICON_STOP : ICON_PLAY}</button>`;
  return `
    <li class="song-row file-row${playing ? " is-playing" : ""}" data-path="${escapeHtml(file.path)}">
      ${play}
      <div class="song-main">
        <span class="song-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="song-meta"><span class="file-badge file-badge-${type}">${TYPE_LABELS[type]}</span>${formatSize(file.size)}</span>
        <div class="song-progress" ${playing ? "" : "hidden"}><span></span></div>
      </div>
      <span class="song-time" data-file-time>${time !== undefined ? formatTime(time) : ""}</span>
      <span class="song-date">${formatDateTime(file.mtime)}</span>
      <button class="btn song-edit file-show" data-file-action="show" title="エクスプローラーでこのファイルの場所を開きます">
        ${ICON_FOLDER}<span>場所を開く</span>
      </button>
      <button class="song-icon-btn" data-file-action="trash" aria-label="ごみ箱へ移す" title="ごみ箱へ移す">${ICON_TRASH}</button>
    </li>`;
}

function renderProgress(): void {
  const row = document.querySelector<HTMLElement>(".file-row.is-playing");
  if (!row || !audio) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const bar = row.querySelector<HTMLElement>(".song-progress span");
  if (bar && duration > 0) bar.style.width = `${Math.min(1, audio.currentTime / duration) * 100}%`;
  const time = row.querySelector<HTMLElement>("[data-file-time]");
  if (time && duration > 0) time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
}

let rafId: number | null = null;
function startProgressLoop(): void {
  if (rafId !== null) return;
  const tick = () => {
    renderProgress();
    rafId = playingPath !== null ? requestAnimationFrame(tick) : null;
  };
  rafId = requestAnimationFrame(tick);
}

// 種類のチップ：それぞれのファイル数を添え、0 個の種類は押せなくする（選んでいる種類は押せるまま）
function renderTypeChips(all: OutputFileInfo[]): void {
  const selected = getState().musicListFileType;
  document.querySelectorAll<HTMLButtonElement>("[data-ml-type]").forEach(chip => {
    const type  = (chip.dataset.mlType ?? "") as MusicListFileType;
    const count = type ? all.filter(f => outputFileType(f) === type).length : all.length;
    let badge = chip.querySelector<HTMLElement>(".ml-genre-count");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ml-genre-count";
      chip.append(badge);
    }
    badge.textContent = String(count);
    const active = type === selected;
    chip.classList.toggle("is-active", active);
    chip.disabled = count === 0 && !active;
  });
}

// 一覧を描く（ミュージックリストで「書き出したファイル」を見ているとき）。ファイルの数を返す（パンくずに出す）
export function renderOutputFiles(): number {
  const s = getState();
  const available = hasOutputFolder();
  const all = files ?? [];
  const visible = visibleFiles([...all]);

  ($("ml-file-sort") as HTMLSelectElement).value = s.musicListSort;
  renderTypeChips(all);
  $("ml-file-browser")!.hidden  = available;
  $("ml-file-empty")!.hidden    = !available || files === null || all.length > 0;
  $("ml-file-no-match")!.hidden = all.length === 0 || visible.length > 0;
  if (loadError) {
    $("ml-file-no-match")!.hidden = false;
    $("ml-file-no-match")!.textContent = `一覧を読めませんでした（${loadError}）`;
  } else {
    $("ml-file-no-match")!.textContent = "この種類のファイルはありません";
  }
  $("ml-file-refresh")!.hidden = !available;
  $("ml-file-folder")!.hidden  = !available;
  $("ml-file-list")!.innerHTML = visible.map(fileRow).join("");
  renderProgress();
  return all.length;
}

// ===== イベント =====

export function initOutputFileList(onChange: () => void): void {
  rerender = onChange;

  document.querySelectorAll<HTMLButtonElement>("[data-ml-type]").forEach(chip =>
    chip.addEventListener("click", () => {
      const type = (chip.dataset.mlType ?? "") as MusicListFileType;
      if (!TYPE_VALUES.includes(type)) return;
      setState({ musicListFileType: type });
      rerender();
    }));
  $("ml-file-sort")?.addEventListener("change", e => {
    const value = (e.target as HTMLSelectElement).value as MusicListSort;
    if (!SORT_VALUES.includes(value)) return;
    setState({ musicListSort: value });
    rerender();
  });
  $("ml-file-refresh")?.addEventListener("click", () => { void refreshOutputFiles(); });
  $("ml-file-folder")?.addEventListener("click", () => { void openOutputFolder(); });

  $("ml-file-list")?.addEventListener("click", e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-file-action]");
    const path = target?.closest<HTMLElement>("[data-path]")?.dataset.path;
    const file = files?.find(f => f.path === path);
    if (!target || !file) return;
    const action = target.dataset.fileAction;
    if (action === "play")  void togglePlay(file);
    if (action === "show")  void showOutputFile(file);
    if (action === "trash") void trash(file);
  });
}
