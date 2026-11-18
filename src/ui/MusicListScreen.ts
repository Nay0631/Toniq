import { getState, setState, MusicListSort } from "../engine/AppState";
import {
  listSongs, findSong, saveCurrentSong, renameSong, deleteSong, loadSong, newSong, toggleFavorite, SavedSong,
  songsToFile, songFileName, importSongFile, SongStorageError, currentSongFields, hasUnsavedChanges,
} from "../engine/SongLibrary";
import { songBeforeRating } from "./RatingScreen";
import { hasOutputFolder, openOutputFolder } from "../engine/OutputFiles";
import * as Playback from "../engine/Playback";
import { onRender, render as renderAll, showScreen } from "./Router";
import { formatTime, SCALE_LABELS } from "./format";
import { beatsPerBar } from "../engine/Meter";

const $ = (id: string) => document.getElementById(id);

// 並び順の選択肢（index.html の #ml-sort の option と同じ値）
const SORT_VALUES: readonly MusicListSort[] = ["newest", "oldest", "name"];
const MODE_LABELS = { simple: "シンプルモード", custom: "カスタムモード" };

const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;
const ICON_STAR = `<svg class="icon-star" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`;
const ICON_MORE = `<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/></svg>`;

// 表示上の一時的な状態：⋮ メニューを開いている曲と、名前を変更中の曲
let menuSongId:   string | null = null;
let renameSongId: string | null = null;

// ===== 状態の更新 =====

// 保存していない変更があるか。サンプルの試聴・メロディの評価で一時的に差し替えているときは、差し替える前の内容で比べる
function unsaved(): boolean {
  const fields = { ...(songBeforeRating() ?? currentSongFields()), ...Playback.sampleOriginal() };
  return hasUnsavedChanges(fields);
}

// 失われる変更の説明（リストにある曲なら保存したあとの変更、ない曲なら曲そのもの）
function lossMessage(): string {
  return findSong(getState().songId)
    ? "最後に保存したあとの変更は失われます。"
    : "この曲はミュージックリストに保存されていないため失われます。";
}

// 保存していない変更を、別の曲の読み込みで捨ててよいか確かめる
function confirmDiscard(nextId: string): boolean {
  if (getState().songId === nextId || !unsaved()) return true;
  return confirm(`別の曲を開きますか？\n編集中の曲の${lossMessage()}`);
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

// ミュージックリストに書き込めなかったときの案内
const STORAGE_HINT = "不要な曲を削除するか、ミュージックリストの「すべて書き出す」でファイルに残してから整理してください。";

// ミュージックリストを書き換える操作を行う。書き込めなかったら知らせて false を返す
function withStorage(action: () => void): boolean {
  try {
    action();
    return true;
  } catch (e) {
    if (!(e instanceof SongStorageError)) throw e;
    alert(`${e.message}。変更は保存されていません。\n${STORAGE_HINT}`);
    return false;
  }
}

// 今の曲をミュージックリストに保存する。書き込めなければ知らせる（編集中の曲は消えないので、整理してから保存し直せる）
function saveToList(): boolean {
  try {
    saveCurrentSong();
    return true;
  } catch (e) {
    if (!(e instanceof SongStorageError)) throw e;
    alert(`${e.message}。この曲はミュージックリストに保存されていません。\n${STORAGE_HINT}\n`
        + "編集中の曲は消えていないので、整理したあとにもう一度「♪ 保存」してください。");
    return false;
  }
}

function removeSong(id: string): void {
  const song = findSong(id);
  if (!song || !confirm(`「${song.name}」をミュージックリストから削除しますか？`)) return;
  if (isPlayingSong(id)) Playback.stop();
  withStorage(() => deleteSong(id));
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
  if (commit) { const id = renameSongId; withStorage(() => renameSong(id, input.value)); }
  renameSongId = null;
  render();
}

// キーとスケール（例：A ナチュラルマイナー）。キー名は CDE 表記のまま
function keyLabel(song: SavedSong): string {
  const scale = song.chordPattern?.base_scale;
  return scale ? `${song.key} ${SCALE_LABELS[scale] ?? scale}` : song.key;
}

// 検索・お気に入りの条件に合うか（ジャンルの絞り込みは別。ジャンルのチップの曲数に使う）。
// 曲名・ジャンル・雰囲気・キーから探し、スペース（全角も）で区切った言葉はすべて含むものに絞る
function matchesQuery(song: SavedSong): boolean {
  const s = getState();
  if (s.musicListFavorites && !song.favorite) return false;
  const words = s.musicListQuery.toLowerCase().split(/[\s　]+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [song.name, song.genre, song.mood, keyLabel(song)].join(" ").toLowerCase();
  return words.every(w => text.includes(w));
}

// 絞り込みと並び替えをした一覧
function visibleSongs(songs: SavedSong[]): SavedSong[] {
  const s = getState();
  const filtered = songs.filter(song =>
    matchesQuery(song) && (!s.musicListGenre || song.genre === s.musicListGenre));

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
  // 拍子のない古い曲は 4/4（loadSong と同じ）
  const seconds = (song.bars * beatsPerBar(song.meter ?? "4/4") * 60) / song.bpm;
  // 曲名の下に出す情報（似た名前の曲を見分けられるように）。小節数とモードは曲名のツールチップに出す
  const meta = `${song.genre}・${song.mood}・${keyLabel(song)}・${song.bpm} BPM`;
  const name = renameSongId === song.id
    ? `<input class="song-name-input" data-action="rename" value="${escapeHtml(song.name)}" aria-label="曲名" spellcheck="false">`
    : `<span class="song-name" title="${song.bars}小節・${MODE_LABELS[song.mode]}（ダブルクリックで編集）">${escapeHtml(song.name)}</span>`;

  return `
    <li class="song-row${playing ? " is-playing" : ""}${menuSongId === song.id ? " is-menu-open" : ""}" data-id="${song.id}">
      <button class="song-play" data-action="play" aria-label="${playing ? "停止" : "再生"}">
        ${playing ? ICON_STOP : ICON_PLAY}
      </button>
      <div class="song-main">
        ${name}
        <span class="song-meta">${escapeHtml(meta)}</span>
        <div class="song-progress" ${playing ? "" : "hidden"}><span></span></div>
      </div>
      <span class="song-time">${formatTime(seconds)}</span>
      <span class="song-date">${formatDate(song.updatedAt)}</span>
      <button class="btn song-edit" data-action="open" title="${MODE_LABELS[song.mode]}で開いて続きを編集します">
        ${ICON_EDIT}<span>編集</span>
      </button>
      <button class="song-icon-btn song-fav${song.favorite ? " is-on" : ""}" data-action="favorite"
        aria-label="お気に入り" aria-pressed="${!!song.favorite}">${ICON_STAR}</button>
      <div class="song-more">
        <button class="song-icon-btn" data-action="menu" aria-label="メニュー">${ICON_MORE}</button>
        <div class="song-menu" ${menuSongId === song.id ? "" : "hidden"}>
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

// ジャンルのチップ：検索・お気に入りの条件に合う曲の数を添え、0 曲のジャンルは押せなくする（空振りを防ぐ）。
// 選んでいるジャンルは 0 曲でも押せるままにする
function renderGenreChips(songs: SavedSong[]): void {
  const genre = getState().musicListGenre;
  const matched = songs.filter(matchesQuery);
  document.querySelectorAll<HTMLButtonElement>("[data-ml-genre]").forEach(chip => {
    const chipGenre = chip.dataset.mlGenre ?? "";
    const count = chipGenre ? matched.filter(song => song.genre === chipGenre).length : matched.length;
    let badge = chip.querySelector<HTMLElement>(".ml-genre-count");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ml-genre-count";
      chip.append(badge);
    }
    badge.textContent = String(count);
    const active = chipGenre === genre;
    chip.classList.toggle("is-active", active);
    chip.disabled = count === 0 && !active;
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
  ($("ml-sort") as HTMLSelectElement).value = s.musicListSort;
  const favorites = $("ml-favorites")!;
  favorites.classList.toggle("is-active", s.musicListFavorites);
  favorites.setAttribute("aria-pressed", String(s.musicListFavorites));
  renderGenreChips(songs);

  $("ml-empty")!.hidden    = songs.length > 0;
  $("ml-no-match")!.hidden = songs.length === 0 || visible.length > 0;
  $("ml-list")!.innerHTML  = visible.map(songRow).join("");
  renderProgress();
}

// ===== イベント =====

export function initMusicListScreen(): void {
  onRender(render);

  // 保存していない変更があれば、ウィンドウを閉じる・読み込み直す前に確かめる。
  // ブラウザは標準の確認を出し、Electron はメインプロセス（will-prevent-unload）が確認のダイアログを出す
  window.addEventListener("beforeunload", e => {
    if (!unsaved()) return;
    e.preventDefault();
    e.returnValue = "";  // 古いブラウザ・Electron は returnValue で止める
  });

  document.querySelectorAll<HTMLButtonElement>("[data-save-song]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!saveToList()) return;
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
      // 保存していない変更がなければ、失うものがないので確かめない
      if (unsaved() && !confirm(`設定をリセットして新しい曲をつくりますか？\n${lossMessage()}`)) return;
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
  $("ml-sort")?.addEventListener("change", e => {
    const value = (e.target as HTMLSelectElement).value as MusicListSort;
    if (!SORT_VALUES.includes(value)) return;
    setState({ musicListSort: value });
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

  // 出力フォルダ（Electron のときだけ）
  const outputFolder = $("ml-output-folder");
  if (outputFolder) {
    outputFolder.hidden = !hasOutputFolder();
    outputFolder.addEventListener("click", () => { void openOutputFolder(); });
  }

  // 曲の操作
  const list = $("ml-list")!;
  // 曲名のダブルクリックでも開いて編集する
  list.addEventListener("dblclick", e => {
    const name = (e.target as HTMLElement).closest(".song-name");
    const id = name?.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id) openSong(id);
  });
  list.addEventListener("click", e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const id = target?.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!target || !id) return;
    const action = target.dataset.action;
    if (action === "rename") return;

    e.stopPropagation();  // ⋮ メニューを開くクリックで、外側クリックの「閉じる」が走らないようにする
    menuSongId = action === "menu" && menuSongId !== id ? id : null;

    if (action === "play")         togglePlay(id);
    if (action === "favorite")     { withStorage(() => toggleFavorite(id)); render(); }
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
