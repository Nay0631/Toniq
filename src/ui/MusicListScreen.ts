import { getState, setState, MusicListSort, type MusicListView } from "../engine/AppState";
import {
  listSongs, findSong, renameSong, deleteSong, loadSong, newSong, toggleFavorite, SavedSong,
  songsToFile, songFileName, importSongFile,
} from "../engine/SongLibrary";
import { hasOutputFolder, openOutputFolder } from "../engine/OutputFiles";
import * as Playback from "../engine/Playback";
import type { AudioFormat } from "../engine/Playback";
import { onRender, onScreenChange, render as renderAll, renderBreadcrumb, showScreen } from "./Router";
import { formatTime, SCALE_LABELS } from "./format";
import { beatsPerBar } from "../engine/Meter";
import { hasUnsavedSong, isListedSong, lossMessage, saveToList, withStorage } from "./SongSave";
import { askChoice } from "./ChoiceDialog";
import { exportAudioWithProgress, exportMidiWithName } from "./ExportProgress";
import { initOutputFileList, refreshOutputFiles, renderOutputFiles, stopFilePlayback } from "./OutputFileList";

const $ = (id: string) => document.getElementById(id);

// 並び順の選択肢（index.html の #ml-sort の option と同じ値）
const SORT_VALUES: readonly MusicListSort[] = ["newest", "oldest", "name"];
const VIEW_VALUES: readonly MusicListView[] = ["songs", "files"];
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

// 保存していない変更を、別の曲の読み込みで捨ててよいか確かめる
function confirmDiscard(nextId: string): boolean {
  if (getState().songId === nextId || !hasUnsavedSong()) return true;
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
  stopFilePlayback();  // 書き出したファイルを聴いていたら止める
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

// 曲を WAV / MP3 / MIDI で書き出す（⋮ メニュー）。曲を今の曲として読み込んでから書き出し、書き出したファイルの一覧を読み直す
async function exportSongAs(id: string, format: AudioFormat | "midi"): Promise<void> {
  if (!useSong(id)) return;
  Playback.stop();
  stopFilePlayback();
  render();
  const saved = format === "midi" ? await exportMidiWithName() : await exportAudioWithProgress(format);
  if (saved) await refreshOutputFiles();
}

// 「＋ 新規作成」：今の曲の編集内容が消えることを、実行する前にダイアログで知らせる。
// 保存していない変更があれば「保存してから新規作成」も選べる。新規作成してよければ true
async function confirmNewSong(): Promise<boolean> {
  const unsaved   = hasUnsavedSong();
  const saveLabel = isListedSong() ? "上書き保存してから新規作成" : "保存してから新規作成";
  const choice = await askChoice(unsaved
    ? {
      title:   "新しい曲をつくりますか？",
      message: "今つくっている曲の編集内容は消え、設定が初めの状態に戻ります。",
      detail:  `${lossMessage()}\n残しておきたいときは「${saveLabel}」を選んでください（ミュージックリストに保存され、あとで続きを編集できます）。`,
      choices: [
        { id: "discard", label: "保存せずに新規作成", kind: "danger" },
        { id: "save",    label: saveLabel, kind: "primary" },
      ],
    }
    : {
      title:   "新しい曲をつくりますか？",
      message: "今の曲を閉じて、設定を初めの状態に戻します。",
      detail:  isListedSong()
        ? "この曲はミュージックリストに保存してあるので、あとでミュージックリストの「編集」から続きを編集できます。"
        : "保存していない変更はないので、消える内容はありません。",
      choices: [{ id: "new", label: "新規作成", kind: "primary" }],
    });
  if (choice === null) return false;
  if (choice === "save") return saveToList();
  return true;
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
          <button data-action="export-wav">WAV で書き出す</button>
          <button data-action="export-mp3">MP3 で書き出す</button>
          <button data-action="export-midi">MIDI で書き出す</button>
          <button data-action="export" title="Toniq の曲ファイル（.toniq.json）。ほかのパソコンの Toniq で読み込んで続きを編集できます">曲ファイルに書き出す</button>
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
  renderBreadcrumb();  // 「保存した曲／書き出したファイル」の段が変わる

  // 保存した曲／書き出したファイルの切り替え
  const filesView = s.musicListView === "files";
  document.querySelectorAll<HTMLElement>("[data-ml-view]").forEach(tab => {
    const active = tab.dataset.mlView === s.musicListView;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $("ml-songs-view")!.hidden = filesView;
  $("ml-files-view")!.hidden = !filesView;
  if (filesView) {
    const count = renderOutputFiles();
    $("ml-count")!.textContent = hasOutputFolder() ? `${count}ファイル` : "";
    return;
  }

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
    if (!hasUnsavedSong()) return;
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

  // 新規作成（シンプルモード・カスタムモードの情報バー）：曲の内容を初期状態に戻す。
  // 何が消えるかを、実行する前にいつもダイアログで知らせる
  document.querySelectorAll<HTMLButtonElement>("[data-new-song]").forEach(btn =>
    btn.addEventListener("click", async () => {
      if (!await confirmNewSong()) return;
      Playback.stop();
      newSong();
      setState({ tab: "settings" });
      renderAll();
    }));

  // 保存した曲／書き出したファイルの切り替え
  document.querySelectorAll<HTMLElement>("[data-ml-view]").forEach(tab =>
    tab.addEventListener("click", () => {
      const view = tab.dataset.mlView as MusicListView;
      if (!VIEW_VALUES.includes(view) || view === getState().musicListView) return;
      stopFilePlayback();
      menuSongId = null;
      setState({ musicListView: view });
      if (view === "files") void refreshOutputFiles();
      render();
    }));
  initOutputFileList(render);
  // ミュージックリストに入ったら書き出したファイルを読み直し、離れたら聴いているファイルを止める
  onScreenChange((prev, next) => {
    if (next === "musiclist" && getState().musicListView === "files") void refreshOutputFiles();
    if (prev === "musiclist" && next !== "musiclist") stopFilePlayback();
  });

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
    if (action === "export-wav")   void exportSongAs(id, "wav");
    if (action === "export-mp3")   void exportSongAs(id, "mp3");
    if (action === "export-midi")  void exportSongAs(id, "midi");
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
