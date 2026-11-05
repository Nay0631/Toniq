import { getState, setState, MusicListSort } from "../engine/AppState";
import {
  listSongs, findSong, saveCurrentSong, renameSong, deleteSong, loadSong, newSong, toggleFavorite, SavedSong,
  songsToFile, songFileName, importSongFile,
} from "../engine/SongLibrary";
import * as Playback from "../engine/Playback";
import { onRender, render as renderAll, showScreen } from "./Router";
import { formatTime } from "./format";

const $ = (id: string) => document.getElementById(id);

const SORT_LABELS: Record<MusicListSort, string> = { newest: "新しい順", oldest: "古い順", name: "名前順" };
const SORT_ORDER: MusicListSort[] = ["newest", "oldest", "name"];
const MODE_LABELS = { simple: "シンプルモード", custom: "カスタムモード" };

const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;
const ICON_STAR = `<svg class="icon-star" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`;
const ICON_MORE = `<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/></svg>`;

// 表示上の一時的な状態：⋮ メニューを開いている曲と、名前を変更中の曲
let menuSongId:   string | null = null;
let renameSongId: string | null = null;

// ===== 状態の更新 =====

// リストに保存していない曲を読み込みで上書きしてよいか確かめる
function confirmDiscard(nextId: string): boolean {
  const s = getState();
  if (s.songId === nextId || findSong(s.songId)) return true;
  // シンプルモードは生成前なら捨てるものがない
  if (s.mode === "simple" && !s.generated) return true;
  return confirm("編集中の曲はミュージックリストに保存されていません。読み込むと失われますが、よろしいですか？");
}

// 今の曲がその曲でなければ読み込む
function useSong(id: string): boolean {
  if (getState().songId === id) return true;
  if (!confirmDiscard(id)) return false;
  Playback.stop();
  return loadSong(id);
}

function isPlayingSong(id: string): boolean {
  return Playback.isPlaying() && getState().songId === id;
}

async function togglePlay(id: string): Promise<void> {
  if (isPlayingSong(id)) {
    Playback.stop();
    render();
    return;
  }
  if (!useSong(id)) return;
  await Playback.play({ onEnded: render });
  startProgressLoop();
  render();
}

function openSong(id: string): void {
  const song = findSong(id);
  if (!song || !useSong(id)) return;
  Playback.stop();
  showScreen(song.mode);
}

function removeSong(id: string): void {
  const song = findSong(id);
  if (!song || !confirm(`「${song.name}」をミュージックリストから削除しますか？`)) return;
  if (isPlayingSong(id)) Playback.stop();
  deleteSong(id);
  render();
}

// ===== 曲ファイル =====

function exportSong(id: string): void {
  const song = findSong(id);
  if (song) Playback.downloadBlob(songsToFile([song]), songFileName(song.name));
}

function exportAllSongs(): void {
  const songs = listSongs();
  if (songs.length === 0) {
    alert("書き出す曲がありません");
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  Playback.downloadBlob(songsToFile(songs), songFileName(`toniq_ミュージックリスト_${date}`));
}

async function importFiles(files: FileList): Promise<void> {
  let added = 0, skipped = 0;
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    try {
      const result = importSongFile(await file.text());
      added   += result.added;
      skipped += result.skipped;
    } catch (e) {
      errors.push(`${file.name}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const lines = [];
  if (added > 0)   lines.push(`${added}曲をミュージックリストに追加しました。`);
  if (skipped > 0) lines.push(`${skipped}曲は内容が足りないため読み込めませんでした。`);
  lines.push(...errors);
  alert(lines.join("\n") || "読み込める曲がありませんでした。");
  render();
}

function startRename(id: string): void {
  renameSongId = id;
  render();
  const input = document.querySelector<HTMLInputElement>(`[data-id="${id}"] .song-name-input`);
  input?.focus();
  input?.select();
}

function finishRename(input: HTMLInputElement, commit: boolean): void {
  if (renameSongId === null) return;
  if (commit) renameSong(renameSongId, input.value);
  renameSongId = null;
  render();
}

// 絞り込みと並び替えをした一覧
function visibleSongs(songs: SavedSong[]): SavedSong[] {
  const s = getState();
  const query = s.musicListQuery.trim().toLowerCase();
  const filtered = songs.filter(song =>
    (!query || song.name.toLowerCase().includes(query)) &&
    (!s.musicListGenre || song.genre === s.musicListGenre) &&
    (!s.musicListFavorites || song.favorite));

  if (s.musicListSort === "oldest") return filtered.sort((a, b) => a.updatedAt - b.updatedAt);
  if (s.musicListSort === "name")   return filtered.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ===== 表示 =====

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function songRow(song: SavedSong): string {
  const playing = isPlayingSong(song.id);
  const seconds = (song.bars * 4 * 60) / song.bpm;
  const detail  = `${song.genre}・${song.mood}・${song.key}・${song.bpm} BPM・${song.bars}小節（${MODE_LABELS[song.mode]}）`;
  const name = renameSongId === song.id
    ? `<input class="song-name-input" data-action="rename" value="${escapeHtml(song.name)}" aria-label="曲名" spellcheck="false">`
    : `<span class="song-name" title="${escapeHtml(detail)}">${escapeHtml(song.name)}</span>`;

  return `
    <li class="song-row${playing ? " is-playing" : ""}${menuSongId === song.id ? " is-menu-open" : ""}" data-id="${song.id}">
      <button class="song-play" data-action="play" aria-label="${playing ? "停止" : "再生"}">
        ${playing ? ICON_STOP : ICON_PLAY}
      </button>
      <div class="song-main">
        ${name}
        <div class="song-progress" ${playing ? "" : "hidden"}><span></span></div>
      </div>
      <span class="song-time">${formatTime(seconds)}</span>
      <span class="song-date">${formatDate(song.updatedAt)}</span>
      <button class="song-icon-btn song-fav${song.favorite ? " is-on" : ""}" data-action="favorite"
        aria-label="お気に入り" aria-pressed="${!!song.favorite}">${ICON_STAR}</button>
      <div class="song-more">
        <button class="song-icon-btn" data-action="menu" aria-label="メニュー">${ICON_MORE}</button>
        <div class="song-menu" ${menuSongId === song.id ? "" : "hidden"}>
          <button data-action="open">${MODE_LABELS[song.mode]}で開く</button>
          <button data-action="start-rename">名前を変更</button>
          <button data-action="export">ファイルに書き出す</button>
          <button class="is-danger" data-action="delete">削除</button>
        </div>
      </div>
    </li>`;
}

function renderProgress(): void {
  const bar = document.querySelector<HTMLElement>(".song-row.is-playing .song-progress span");
  if (!bar) return;
  const progress = Math.min(1, Playback.getPositionSeconds() / Playback.getSongSeconds());
  bar.style.width = `${progress * 100}%`;
}

let rafId: number | null = null;
function startProgressLoop(): void {
  if (rafId !== null) return;
  const tick = () => {
    renderProgress();
    rafId = Playback.isPlaying() ? requestAnimationFrame(tick) : null;
    if (rafId === null) render();
  };
  rafId = requestAnimationFrame(tick);
}

// 保存ボタン（シンプルモード・カスタムモードの情報バー）。リストから開いた曲は上書き保存になる
function renderSaveButtons(): void {
  const overwrite = !!findSong(getState().songId);
  document.querySelectorAll<HTMLButtonElement>("[data-save-song]").forEach(btn => {
    if (btn.dataset.saved) return;  // 「保存しました」の表示中
    btn.textContent = overwrite ? "♪ 上書き保存" : "♪ 保存";
    btn.title = overwrite ? "ミュージックリストの曲を上書きします" : "ミュージックリストに追加します";
  });
}

function render(): void {
  renderSaveButtons();
  const s = getState();
  const onList = s.screen === "musiclist";
  document.querySelectorAll<HTMLElement>("[data-musiclist-only]").forEach(el => { el.hidden = !onList; });
  if (!onList) return;

  const songs   = listSongs();
  const visible = visibleSongs(songs);
  $("ml-count")!.textContent = `${songs.length}曲`;

  const search = $("ml-search") as HTMLInputElement;
  if (search.value !== s.musicListQuery) search.value = s.musicListQuery;
  $("ml-sort-label")!.textContent = SORT_LABELS[s.musicListSort];
  $("ml-favorites")!.classList.toggle("is-active", s.musicListFavorites);
  document.querySelectorAll<HTMLElement>("[data-ml-genre]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.mlGenre === s.musicListGenre));

  $("ml-empty")!.hidden    = songs.length > 0;
  $("ml-no-match")!.hidden = songs.length === 0 || visible.length > 0;
  $("ml-list")!.innerHTML  = visible.map(songRow).join("");
  renderProgress();
}

// ===== イベント =====

export function initMusicListScreen(): void {
  onRender(render);

  document.querySelectorAll<HTMLButtonElement>("[data-save-song]").forEach(btn =>
    btn.addEventListener("click", () => {
      saveCurrentSong();
      btn.dataset.saved = "1";
      btn.textContent = "✓ 保存しました";
      setTimeout(() => {
        delete btn.dataset.saved;
        renderSaveButtons();
      }, 1500);
      renderAll();
    }));

  // 新規作成（シンプルモード・カスタムモードの情報バー）：曲の内容を初期状態に戻す
  document.querySelectorAll<HTMLButtonElement>("[data-new-song]").forEach(btn =>
    btn.addEventListener("click", () => {
      const s = getState();
      const message = findSong(s.songId)
        ? "設定をリセットして新しい曲をつくりますか？\n最後に保存したあとの変更は失われます。"
        : "設定をリセットして新しい曲をつくりますか？\nこの曲はミュージックリストに保存されていないため失われます。";
      if (!confirm(message)) return;
      Playback.stop();
      newSong();
      setState({ tab: "settings" });
      renderAll();
    }));

  // 絞り込み・並び替え
  $("ml-search")?.addEventListener("input", e => {
    setState({ musicListQuery: (e.target as HTMLInputElement).value });
    render();
  });
  $("ml-sort")?.addEventListener("click", () => {
    const next = SORT_ORDER[(SORT_ORDER.indexOf(getState().musicListSort) + 1) % SORT_ORDER.length];
    setState({ musicListSort: next });
    render();
  });
  $("ml-favorites")?.addEventListener("click", () => {
    setState({ musicListFavorites: !getState().musicListFavorites });
    render();
  });
  document.querySelectorAll<HTMLElement>("[data-ml-genre]").forEach(el =>
    el.addEventListener("click", () => {
      setState({ musicListGenre: el.dataset.mlGenre ?? "" });
      render();
    }));

  // 曲ファイルの読み込み・すべて書き出す
  const fileInput = $("ml-import-file") as HTMLInputElement | null;
  $("ml-import")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    if (fileInput.files && fileInput.files.length > 0) await importFiles(fileInput.files);
    fileInput.value = "";  // 同じファイルをもう一度選んでも change が起きるようにする
  });
  $("ml-export-all")?.addEventListener("click", exportAllSongs);

  // 曲の操作
  const list = $("ml-list")!;
  list.addEventListener("click", e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const id = target?.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!target || !id) return;
    const action = target.dataset.action;
    if (action === "rename") return;

    e.stopPropagation();  // ⋮ メニューを開くクリックで、外側クリックの「閉じる」が走らないようにする
    menuSongId = action === "menu" && menuSongId !== id ? id : null;

    if (action === "play")         togglePlay(id);
    if (action === "favorite")     { toggleFavorite(id); render(); }
    if (action === "menu")         render();
    if (action === "open")         openSong(id);
    if (action === "start-rename") startRename(id);
    if (action === "export")       { exportSong(id); render(); }
    if (action === "delete")       removeSong(id);
  });
  document.addEventListener("click", () => {
    if (menuSongId === null) return;
    menuSongId = null;
    render();
  });

  // 曲名の変更：Enter かフォーカスを外したときに確定、Esc で取り消す
  list.addEventListener("keydown", e => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.action !== "rename") return;
    if (e.key === "Enter")  finishRename(input, true);
    if (e.key === "Escape") finishRename(input, false);
  });
  list.addEventListener("focusout", e => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.action === "rename") finishRename(input, true);
  });
}
