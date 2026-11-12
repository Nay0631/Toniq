import { describe, it, expect, beforeEach, vi } from "vitest";

// 音量ノード（Tone.js）と元に戻す／やり直す（読み込み時に window のイベントを登録する）は使わない
vi.mock("../src/engine/VolumeManager", () => ({ applyAllVolumes: vi.fn() }));
vi.mock("../src/engine/History", () => ({ resetHistory: vi.fn() }));

import { getState, setState, defaultState, SONG_FIELDS } from "../src/engine/AppState";
import {
  listSongs, loadSong, saveCurrentSong, renameSong, importSongFile, loadProjectFile, projectFileText,
  SongStorageError, SavedSong,
} from "../src/engine/SongLibrary";
import { LEGACY_PRESET_IDS } from "../src/engine/Grow";
import { chordById, drums, resetState, MemoryStorage } from "./helpers";

const STORAGE_KEY = "toniq.songs";
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  resetState();
});

// 以前の版で保存した曲（今の項目がいくつか無く、古い書き方の値を持つ）
function legacySong(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "song_old", name: "古い曲", createdAt: 1, updatedAt: 2,
    mode: "custom", genre: "ローファイ", mood: "落ち着いた", key: "D", bpm: 85, tempoPreset: "普通", bars: 16,
    chordPattern: chordById("chord_007"), drumPattern: drums[0],
    melodyNotes: [{ note: "D5", duration: "4n", time: "0:0:0" }],
    melodyMethod: "manual", melodyVersion: 3,
    // grow のプリセットを番号で保存していた（FILE_VERSION 1）
    growPreset: 4,  // = "acid"（初期値の "lead" と違う番号にして、読み替えずに初期値になったのと区別する）
    growSounds: { bass: { preset: 6, params: { 3: 0.5 } } },  // pad / arp / signature / counter は無い
    // 以前の Tone.js のコードの音色・旧 grow（Tone.js 版）のメロディの音色
    chordInstrument: "epiano",
    melodyInstrument: "toniq",
    toniqSynth: { cutoff: 1200 },
    // パートを増やす前の曲（signature / fx / counter / perc が無い）。サブベースの設定（bassSub）も無い
    parts:   { drum: true, chord: true, bass: false, arp: false, pad: true, melody: true },
    volumes: { drum: 70, chord: 60, bass: 65, arp: 55, pad: 45, melody: 80 },
    arrangement: { drum: [{ start: 0, length: 16 }], chord: [], bass: [], arp: [], pad: [], melody: [{ start: 4, length: 12 }] },
    ...overrides,
  };
}

function storeRaw(songs: unknown[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

describe("loadSong：古い形式の曲の読み替え", () => {
  beforeEach(() => {
    storeRaw([legacySong()]);
    expect(loadSong("song_old")).toBe(true);
  });

  it("番号で保存した grow のプリセットを ID に読み替える（LEGACY_PRESET_IDS）", () => {
    const s = getState();
    expect(s.growPreset).toBe(LEGACY_PRESET_IDS[4]);
    expect(s.growPreset).toBe("acid");
    expect(s.growSounds.bass).toEqual({ preset: LEGACY_PRESET_IDS[6], params: { 3: 0.5 } });
    expect(s.growSounds.bass.preset).toBe("sub_bass");
  });

  it("無いパートの grow の音作りは初期値で補う", () => {
    const s = getState();
    expect(s.growSounds.pad).toEqual(defaultState.growSounds.pad);
    expect(s.growSounds.arp).toEqual(defaultState.growSounds.arp);
    expect(s.growSounds.signature).toEqual(defaultState.growSounds.signature);
    expect(s.growSounds.counter).toEqual(defaultState.growSounds.counter);
  });

  it("以前の Tone.js のコードの音色は、同じ音の grow のプリセットにする（LEGACY_CHORD_PRESETS）", () => {
    expect(getState().chordInstrument).toBe("grow");
    expect(getState().growChordPreset).toBe("epiano");
  });

  it("旧 grow（melodyInstrument: toniq）はジャンルの標準（auto）にし、toniqSynth は読み捨てる", () => {
    expect(getState().melodyInstrument).toBe("auto");
    expect("toniqSynth" in getState()).toBe(false);
  });

  it("あとから増えたパートの ON/OFF・音量・アレンジを初期値で補い、保存した値はそのまま", () => {
    const s = getState();
    expect(s.parts).toEqual({ ...defaultState.parts, drum: true, chord: true, bass: false, arp: false, pad: true, melody: true });
    expect(s.volumes.signature).toBe(defaultState.volumes.signature);
    expect(s.volumes.fx).toBe(defaultState.volumes.fx);
    expect(s.volumes.melody).toBe(80);
    expect(s.arrangement?.signature).toEqual([]);
    expect(s.arrangement?.fx).toEqual([]);
    expect(s.volumes.counter).toBe(defaultState.volumes.counter);
    expect(s.volumes.perc).toBe(defaultState.volumes.perc);
    expect(s.parts.counter).toBe(defaultState.parts.counter);
    expect(s.parts.perc).toBe(defaultState.parts.perc);
    // アレンジを編集して保存した曲には、カウンターメロディ・パーカッションのブロックは無い（鳴らない）
    expect(s.arrangement?.counter).toEqual([]);
    expect(s.arrangement?.perc).toEqual([]);
    expect(s.arrangement?.melody).toEqual([{ start: 4, length: 12 }]);
  });

  it("無い項目（スウィング・サビ・FX の種類など）は初期値、曲の情報はそのまま", () => {
    const s = getState();
    expect(s.swing).toBe(defaultState.swing);
    expect(s.bassSub).toBe(defaultState.bassSub);  // サブベースはジャンルの標準（null）
    expect(s.chorusPattern).toBe(defaultState.chorusPattern);
    expect(s.fxType).toBe(defaultState.fxType);
    expect(s.sections).toBe(defaultState.sections);
    expect(s.key).toBe("D");
    expect(s.bpm).toBe(85);
    expect(s.melodyNotes).toEqual([{ note: "D5", duration: "4n", time: "0:0:0" }]);
    expect(s.songId).toBe("song_old");
  });
});

describe("loadSong：そのほかの読み替え", () => {
  it("ID で保存した今の形式のプリセットはそのまま", () => {
    storeRaw([legacySong({ growPreset: "pluck", growChordPreset: "organ", chordInstrument: "grow", melodyInstrument: "grow" })]);
    loadSong("song_old");
    expect(getState().growPreset).toBe("pluck");
    expect(getState().growChordPreset).toBe("organ");
    expect(getState().melodyInstrument).toBe("grow");
  });

  it("範囲外の番号のプリセットは初期値（ジャンルの標準）にする", () => {
    storeRaw([legacySong({ growPreset: 9999 })]);
    loadSong("song_old");
    expect(getState().growPreset).toBe(defaultState.growPreset);
    expect(getState().growPreset).toBeNull();
  });

  it("メロディのプリセットが無い・null の曲はジャンルの標準（null）、以前の初期値の lead はそのまま", () => {
    storeRaw([legacySong({ growPreset: undefined })]);
    loadSong("song_old");
    expect(getState().growPreset).toBeNull();

    storeRaw([legacySong({ growPreset: null })]);
    loadSong("song_old");
    expect(getState().growPreset).toBeNull();

    // メロディの標準がまだ無かった頃の曲（初期値の "lead" を保存している）は、保存した音のまま鳴らす
    storeRaw([legacySong({ growPreset: "lead" })]);
    loadSong("song_old");
    expect(getState().growPreset).toBe("lead");
  });

  it("無い曲は false を返し、今の曲は変えない", () => {
    setState({ key: "F#" });
    expect(loadSong("song_none")).toBe(false);
    expect(getState().key).toBe("F#");
  });

  it("保存して読み込むと曲の内容（SONG_FIELDS）が同じになる", () => {
    setState({
      genre: "テクノ", key: "E", bpm: 133, bars: 24,
      chordPattern: chordById("chord_036"), drumPattern: drums[3],
      melodyNotes: [{ note: "E4", duration: "8n", time: "0:1:0" }],
      swing: 40, growSounds: { ...defaultState.growSounds, bass: { preset: "acid", params: { 1: 2 } } },
    });
    const before = Object.fromEntries(SONG_FIELDS.map(f => [f, structuredClone(getState()[f])]));
    const saved = saveCurrentSong();
    resetState();
    loadSong(saved.id);
    for (const f of SONG_FIELDS) expect(getState()[f], f).toEqual(before[f]);
  });
});

describe("曲ファイル・作業ファイル", () => {
  it("FILE_VERSION 1 の曲ファイルを読み込み、古い値を読み替えて一覧に足す", () => {
    const file = { format: "toniq-song", version: 1, exportedAt: 0, songs: [legacySong(), { name: "壊れた曲" }] };
    const result = importSongFile(JSON.stringify(file));
    expect(result).toEqual({ added: 1, skipped: 1 });
    const [song] = listSongs();
    expect(song.name).toBe("古い曲");
    expect(song.id).not.toBe("song_old");  // 新しい ID で追加する
    expect(song.growPreset).toBe("acid");
    expect(song.growChordPreset).toBe("epiano");
    expect(song.melodyInstrument).toBe("auto");
    expect(song.parts.fx).toBe(defaultState.parts.fx);
  });

  it("BPM・小節数は範囲に収める", () => {
    importSongFile(JSON.stringify(legacySong({ bpm: 999.4, bars: 0.2 })));
    const [song] = listSongs();
    expect(song.bpm).toBe(240);
    expect(song.bars).toBe(1);
  });

  it("Toniq の曲ファイルでなければ例外", () => {
    expect(() => importSongFile("{")).toThrow(/JSON/);
    expect(() => importSongFile(JSON.stringify({ hello: 1 }))).toThrow(/Toniq の曲ファイルではありません/);
  });

  it("作業ファイルを開くと古い値を読み替え、ミュージックリストには追加しない", () => {
    const name = loadProjectFile(JSON.stringify({ format: "toniq-song", version: 1, exportedAt: 0, songs: [legacySong()] }), "C:/x.toniq.json");
    expect(name).toBe("古い曲");
    expect(getState().growPreset).toBe("acid");
    expect(getState().songId).toBeNull();
    expect(getState().projectPath).toBe("C:/x.toniq.json");
    expect(listSongs()).toEqual([]);
  });

  it("作業ファイルに保存した内容を開き直すと同じ曲になる", () => {
    setState({ genre: "8bit", key: "G", chordPattern: chordById("chord_012"), drumPattern: drums[1], bars: 8 });
    const before = Object.fromEntries(SONG_FIELDS.map(f => [f, structuredClone(getState()[f])]));
    const text = projectFileText();
    resetState();
    loadProjectFile(text, null);
    for (const f of SONG_FIELDS) {
      if (f === "mode") continue;  // 作業ファイルを開くとモードは simple / custom にそろえる（同じ値）
      expect(getState()[f], f).toEqual(before[f]);
    }
  });
});

describe("ミュージックリストに書き込めないとき", () => {
  beforeEach(() => {
    setState({ chordPattern: chordById("chord_001"), drumPattern: drums[0] });
  });

  it("容量オーバーなら SongStorageError（quota）を投げ、songId と一覧は変えない", () => {
    const first = saveCurrentSong();
    setState({ songId: null });
    storage.quotaAfter = 10;  // これより長い書き込みは容量オーバー
    let error: unknown;
    try { saveCurrentSong(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(SongStorageError);
    expect((error as SongStorageError).quota).toBe(true);
    expect(getState().songId).toBeNull();
    expect(listSongs().map(s => s.id)).toEqual([first.id]);
  });

  it("容量オーバー以外の失敗は quota: false", () => {
    storage.setItem = () => { throw new Error("SecurityError"); };
    let error: unknown;
    try { saveCurrentSong(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(SongStorageError);
    expect((error as SongStorageError).quota).toBe(false);
  });

  it("名前の変更も書き込めなければ SongStorageError", () => {
    const saved: SavedSong = saveCurrentSong();
    storage.quotaAfter = 10;
    expect(() => renameSong(saved.id, "新しい名前")).toThrow(SongStorageError);
    storage.quotaAfter = Infinity;
    expect(listSongs()[0].name).toBe(saved.name);
  });

  it("曲ファイルの読み込みも書き込めなければ SongStorageError（一覧は変えない）", () => {
    storage.quotaAfter = 10;
    expect(() => importSongFile(JSON.stringify(legacySong()))).toThrow(SongStorageError);
    expect(listSongs()).toEqual([]);
  });
});
