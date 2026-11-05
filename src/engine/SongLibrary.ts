import { getState, setState, AppState, defaultState } from "./AppState";
import { applyAllVolumes } from "./VolumeManager";
import { resolveSimpleMode, resolveTempoPreset } from "./SimpleModeResolver";
import { emptyArrangement } from "./LoopArranger";

// ミュージックリスト：保存した曲を localStorage に置く
const STORAGE_KEY = "toniq.songs";

// 曲として保存する AppState の項目（画面・タブ・ピアノロールの入力設定などの表示上の状態は含めない）
const SONG_FIELDS = [
  "mode", "genre", "mood", "key", "bpm", "tempoPreset", "bars",
  "chordPattern", "drumPattern", "melodyNotes", "melodyMethod", "melodyVersion",
  "melodyInstrument", "chordRhythm", "chordInstrument", "fxType", "scaleLock", "drumCategory",
  "arrangement", "parts", "volumes",
] as const;

type SongFields = Pick<AppState, typeof SONG_FIELDS[number]>;

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

// 保存した曲を今の曲として読み込む（再生中なら呼び出し側で止めておく）
export function loadSong(id: string): boolean {
  const song = findSong(id);
  if (!song) return false;

  const fields = {} as Record<string, unknown>;
  SONG_FIELDS.forEach(f => { fields[f] = song[f]; });
  const loaded = structuredClone(fields) as SongFields;
  setState({
    ...loaded,
    fxType:      loaded.fxType ?? defaultState.fxType,  // FX の種類がなかったころの曲はジャンルの標準
    // あとから増えたパート（シグネチャーなど）は、古い曲では初期値で補う
    parts:       { ...defaultState.parts,   ...loaded.parts },
    volumes:     { ...defaultState.volumes, ...loaded.volumes },
    arrangement: loaded.arrangement ? { ...emptyArrangement(), ...loaded.arrangement } : null,
    songId:    song.id,
    generated: true,  // シンプルモードで開いたときは生成結果の画面を出す
    startBar:  0,
  });
  applyAllVolumes();
  return true;
}

// 曲の内容を初期状態に戻して、未保存の新しい曲にする（モードはそのまま。再生中なら呼び出し側で止めておく）
export function newSong(): void {
  const fields = {} as Record<string, unknown>;
  SONG_FIELDS.forEach(f => { fields[f] = defaultState[f]; });
  setState({
    ...structuredClone(fields) as SongFields,
    mode:      getState().mode,
    songId:    null,
    generated: false,  // シンプルモードは設定画面に戻る
    startBar:  0,
  });

  // カスタムモードはパターンがないと編集できないので、起動時と同じく初期のジャンル・雰囲気で決めておく
  const s = getState();
  const result = resolveSimpleMode(s.genre, s.mood);
  setState({
    bpm:          resolveTempoPreset(s.genre, s.tempoPreset as "ゆっくり" | "普通" | "速い"),
    chordPattern: result.chordPattern,
    drumPattern:  result.drumPattern,
  });
  // メロディは空のまま（自動生成ボタンを押したときに初めて作る）
  applyAllVolumes();
}
