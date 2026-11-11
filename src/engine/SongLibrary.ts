import { getState, setState, defaultState, SONG_FIELDS, SongFields } from "./AppState";
import { applyAllVolumes } from "./VolumeManager";
import { resolveSimpleMode, resolveTempoPreset, pickChorus } from "./SimpleModeResolver";
import { emptyArrangement } from "./LoopArranger";
import { resetHistory } from "./History";
import { normalizeToniqSynth } from "./ToniqSynth";

export { SONG_FIELDS };
export type { SongFields };

// ミュージックリスト：保存した曲を localStorage に置く
const STORAGE_KEY = "toniq.songs";

export interface SavedSong extends SongFields {
  id:        string;
  name:      string;
  favorite?: boolean;
  createdAt: number;  // ミリ秒
  updatedAt: number;
}

// 保存した曲の一覧（新しく保存・更新したものが先頭）
export function listSongs(): SavedSong[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const songs = raw ? JSON.parse(raw) as SavedSong[] : [];
    return Array.isArray(songs) ? songs.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch (e) {
    console.error("ミュージックリストの読み込みに失敗:", e);
    return [];
  }
}

function writeSongs(songs: SavedSong[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export function findSong(id: string | null): SavedSong | undefined {
  return id === null ? undefined : listSongs().find(song => song.id === id);
}

// 今の曲の内容（ネストしたオブジェクトも複製して、保存後の編集と切り離す）
function snapshot(): SongFields {
  const s = getState();
  const fields = {} as Record<string, unknown>;
  SONG_FIELDS.forEach(f => { fields[f] = s[f]; });
  return structuredClone(fields) as SongFields;
}

function defaultName(songs: SavedSong[]): string {
  const s = getState();
  const base = `${s.genre}・${s.mood}`;
  let n = 1;
  while (songs.some(song => song.name === `${base} #${n}`)) n++;
  return `${base} #${n}`;
}

// 今の曲を保存する。リストから開いた曲（AppState.songId）なら上書き、そうでなければ新しく追加する
export function saveCurrentSong(): SavedSong {
  const songs = listSongs();
  const now   = Date.now();
  const index = songs.findIndex(song => song.id === getState().songId);

  let saved: SavedSong;
  if (index >= 0) {
    saved = { ...songs[index], ...snapshot(), updatedAt: now };
    songs[index] = saved;
  } else {
    saved = {
      ...snapshot(),
      id:        `song_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name:      defaultName(songs),
      createdAt: now,
      updatedAt: now,
    };
    songs.unshift(saved);
  }
  writeSongs(songs);
  setState({ songId: saved.id });
  console.log("ミュージックリストに保存:", saved.name);
  return saved;
}

export function renameSong(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  writeSongs(listSongs().map(song => song.id === id ? { ...song, name: trimmed } : song));
}

export function toggleFavorite(id: string): void {
  writeSongs(listSongs().map(song => song.id === id ? { ...song, favorite: !song.favorite } : song));
}

export function deleteSong(id: string): void {
  writeSongs(listSongs().filter(song => song.id !== id));
  if (getState().songId === id) setState({ songId: null });
}

// 保存した曲の内容を取り出す。あとから増えた項目（FX の種類・シグネチャーなど）は、古い曲では初期値で補う
function songFields(song: Partial<SongFields>): SongFields {
  const fields = {} as Record<string, unknown>;
  SONG_FIELDS.forEach(f => { fields[f] = song[f] ?? defaultState[f]; });
  const loaded = structuredClone(fields) as SongFields;
  return {
    ...loaded,
    parts:       { ...defaultState.parts,   ...loaded.parts },
    volumes:     { ...defaultState.volumes, ...loaded.volumes },
    toniqSynth:  normalizeToniqSynth(loaded.toniqSynth),
    arrangement: loaded.arrangement ? { ...emptyArrangement(), ...loaded.arrangement } : null,
  };
}

// 保存した曲を今の曲として読み込む（再生中なら呼び出し側で止めておく）
export function loadSong(id: string): boolean {
  const song = findSong(id);
  if (!song) return false;

  setState({
    ...songFields(song),
    songId:    song.id,
    projectPath: null,
    generated: true,  // シンプルモードで開いたときは生成結果の画面を出す
    startBar:  0,
  });
  applyAllVolumes();
  resetHistory();  // 別の曲の編集は元に戻せないようにする
  return true;
}

// ===== 曲ファイル（.toniq.json）の書き出し・読み込み =====
// ミュージックリストの曲を JSON ファイルにして、バックアップや別の PC への持ち運びに使う

const FILE_FORMAT  = "toniq-song";
const FILE_VERSION = 1;
export const SONG_FILE_EXT = ".toniq.json";

interface SongFile {
  format:     typeof FILE_FORMAT;
  version:    number;
  exportedAt: number;
  songs:      SavedSong[];
}

// 曲（1曲またはリスト全体）をファイルの中身にする
export function songsToFile(songs: SavedSong[]): Blob {
  const file: SongFile = { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: Date.now(), songs };
  return new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
}

// ファイル名に使えない文字を置き換える
export function songFileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|]/g, "_").trim() || "toniq"}${SONG_FILE_EXT}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 曲として最低限の形になっているか（コード進行とドラムがないと鳴らせない）
function isSongLike(v: unknown): v is Partial<SavedSong> {
  if (!isObject(v)) return false;
  const chord = v.chordPattern, drum = v.drumPattern;
  return isObject(chord) && Array.isArray(chord.progression) && typeof chord.length_bars === "number"
      && isObject(drum)  && isObject(drum.tracks) && typeof drum.steps === "number"
      && typeof v.genre === "string" && typeof v.key === "string"
      && typeof v.bpm === "number" && Number.isFinite(v.bpm)
      && typeof v.bars === "number" && Number.isFinite(v.bars)
      && (v.melodyNotes === undefined || Array.isArray(v.melodyNotes));
}

export interface ImportResult {
  added:   number;
  skipped: number;  // 形が正しくなく読み込めなかった曲の数
}

// ファイルの中身（JSON の文字列）から曲をミュージックリストに追加する。
// 同じ曲を2回読み込んでも上書きはせず、別の曲として追加する
export function importSongFile(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("ファイルの形式が正しくありません（JSON として読めません）");
  }
  // Toniq の曲ファイル。念のため曲1つだけの JSON も受け付ける
  const items: unknown[] = isObject(data) && data.format === FILE_FORMAT && Array.isArray(data.songs)
    ? data.songs
    : isSongLike(data) ? [data] : [];
  if (items.length === 0) throw new Error("Toniq の曲ファイルではありません");

  const songs = listSongs();
  const now   = Date.now();
  let added = 0;
  items.forEach((item, i) => {
    if (!isSongLike(item)) return;
    const fields = songFields(item);
    songs.unshift({
      ...fields,
      mode:      fields.mode === "simple" ? "simple" : "custom",
      bpm:       Math.max(20, Math.min(240, Math.round(fields.bpm))),
      bars:      Math.max(1, Math.min(256, Math.round(fields.bars))),
      id:        `song_${now.toString(36)}${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name:      typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 100) : defaultName(songs),
      favorite:  item.favorite === true,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
      updatedAt: now,  // 読み込んだ曲が一覧の先頭に来るようにする
    });
    added++;
  });
  if (added > 0) writeSongs(songs);
  return { added, skipped: items.length - added };
}

// ===== 作業ファイル（今の曲の構成を1曲分の .toniq.json に保存し、あとで開いて続きを編集する） =====
// 形式はミュージックリストの曲ファイルと同じ（曲1つ）なので、ミュージックリストの「ファイルを読み込む」でも追加できる

// 作業ファイルの曲名：リストの曲ならその名前、なければジャンル・雰囲気
export function currentSongName(): string {
  const s = getState();
  return findSong(s.songId)?.name ?? `${s.genre}・${s.mood}`;
}

// 今の曲を作業ファイルの中身（JSON の文字列）にする
export function projectFileText(): string {
  const s = getState();
  const now = Date.now();
  const listed = findSong(s.songId);
  const song: SavedSong = {
    ...snapshot(),
    id:        listed?.id ?? `song_${now.toString(36)}`,
    name:      currentSongName(),
    favorite:  listed?.favorite,
    createdAt: listed?.createdAt ?? now,
    updatedAt: now,
  };
  const file: SongFile = { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: now, songs: [song] };
  return JSON.stringify(file, null, 2);
}

// 作業ファイルの中身から曲を取り出して今の曲として読み込む（再生中なら呼び出し側で止めておく）。
// ミュージックリストには追加しない（未保存の曲として開く）。読み込んだ曲の名前を返す
export function loadProjectFile(text: string, path: string | null): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("ファイルの形式が正しくありません（JSON として読めません）");
  }
  // 曲が複数入ったファイル（すべて書き出す）なら最初の曲を開く
  const items: unknown[] = isObject(data) && data.format === FILE_FORMAT && Array.isArray(data.songs)
    ? data.songs
    : [data];
  const item = items.find(isSongLike);
  if (!item) throw new Error("Toniq の作業ファイルではありません");

  const fields = songFields(item);
  setState({
    ...fields,
    mode:        fields.mode === "simple" ? "simple" : "custom",
    bpm:         Math.max(20, Math.min(240, Math.round(fields.bpm))),
    bars:        Math.max(1, Math.min(256, Math.round(fields.bars))),
    songId:      null,
    projectPath: path,
    generated:   true,  // シンプルモードで開いたときは生成結果の画面を出す
    startBar:    0,
  });
  applyAllVolumes();
  resetHistory();  // 別の曲の編集は元に戻せないようにする
  return typeof item.name === "string" && item.name.trim() ? item.name.trim() : "作業ファイル";
}

// 曲の内容を初期状態に戻して、未保存の新しい曲にする（モードはそのまま。再生中なら呼び出し側で止めておく）
export function newSong(): void {
  const fields = {} as Record<string, unknown>;
  SONG_FIELDS.forEach(f => { fields[f] = defaultState[f]; });
  setState({
    ...structuredClone(fields) as SongFields,
    mode:      getState().mode,
    songId:    null,
    projectPath: null,
    generated: false,  // シンプルモードは設定画面に戻る
    startBar:  0,
  });

  // カスタムモードはパターンがないと編集できないので、起動時と同じく初期のジャンル・雰囲気で決めておく
  const s = getState();
  const result = resolveSimpleMode(s.genre, s.mood);
  setState({
    bpm:          resolveTempoPreset(s.genre, s.tempoPreset as "ゆっくり" | "普通" | "速い"),
    chordPattern: result.chordPattern,
    chorusPattern: pickChorus(result.chordPattern, s.genre, s.mood),
    drumPattern:  result.drumPattern,
  });
  // メロディは空のまま（自動生成ボタンを押したときに初めて作る）
  applyAllVolumes();
  resetHistory();
}
