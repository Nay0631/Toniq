import { describe, it, expect, beforeEach, vi } from "vitest";

// 音量ノード（Tone.js）と元に戻す／やり直す（読み込み時に window のイベントを登録する）は使わない
vi.mock("../src/engine/VolumeManager", () => ({ applyAllVolumes: vi.fn() }));
vi.mock("../src/engine/History", () => ({ resetHistory: vi.fn() }));

import { getState, setState, defaultState, SONG_FIELDS } from "../src/engine/AppState";
import {
  listSongs, loadSong, saveCurrentSong, renameSong, importSongFile, deleteSong, newSong,
  SongStorageError, SavedSong, markSongClean, hasUnsavedChanges, hasHandmadeContent, currentSongFields,
} from "../src/engine/SongLibrary";
import { LEGACY_PRESET_IDS } from "../src/engine/Grow";
import { volumeFromLegacy, volumeToDb } from "../src/engine/VolumeCurve";
import { getArrangement } from "../src/engine/LoopArranger";
import { customDrumPattern, withDrumHit } from "../src/engine/DrumEngine";
import { chordById, chords, drums, resetState, MemoryStorage } from "./helpers";

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
    // メロディを grow で鳴らしていた曲（toniq の曲はメロディのプリセットを使わない）
    storeRaw([legacySong({ melodyInstrument: "grow" })]);
    loadSong("song_old");
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

  it("旧 grow（melodyInstrument: toniq）は grow のジャンルの標準にし、toniqSynth は読み捨てる", () => {
    expect(getState().melodyInstrument).toBe("grow");
    expect(getState().growPreset).toBeNull();  // 保存していた growPreset（鳴っていなかった）は使わない
    expect("toniqSynth" in getState()).toBe(false);
  });

  it("あとから増えたパートの ON/OFF・音量・アレンジを初期値で補い、保存した値はそのまま", () => {
    const s = getState();
    expect(s.parts).toEqual({ ...defaultState.parts, drum: true, chord: true, bass: false, arp: false, pad: true, melody: true });
    expect(s.volumes.signature).toBe(defaultState.volumes.signature);
    expect(s.volumes.fx).toBe(defaultState.volumes.fx);
    // 保存した音量は以前のカーブ（100 で 0dB）の値なので、同じ大きさで鳴る今のカーブ（75 で 0dB）の値に読み替える
    expect(s.volumes.melody).toBe(volumeFromLegacy(80));
    expect(s.volumes.melody).toBe(67);
    expect(volumeToDb(s.volumes.melody)).toBeCloseTo(20 * Math.log10(80 / 100), 0);
    expect(s.volumes.counter).toBe(defaultState.volumes.counter);
    // 定位（パン）は以前はなかった（初期値）
    expect(s.pans).toEqual(defaultState.pans);
    expect(s.volumes.perc).toBe(defaultState.volumes.perc);
    expect(s.parts.counter).toBe(defaultState.parts.counter);
    expect(s.parts.perc).toBe(defaultState.parts.perc);
  });

  it("以前のブロックの並びのアレンジ（arrangement）を、構成の標準＋変えた所に読み替える", () => {
    const s = getState();
    expect(s.arrangePreset).toBe("standard");
    expect("arrangement" in s).toBe(false);
    // 4 小節の進行・16 小節のローファイ：Aメロ1回目（0〜7）・2回目（8〜15）
    expect(s.arrangeEdits).toContainEqual({ section: "A", nth: 0, part: "drum", on: true });    // 全部の小節で鳴らしていた
    expect(s.arrangeEdits).toContainEqual({ section: "A", nth: 0, part: "melody", on: true });  // 後半から → 半分以上なのでセクション全体
    expect(s.arrangeEdits).toContainEqual({ section: "A", nth: 0, part: "chord", on: false });  // 鳴らしていなかった
    const a = getArrangement();
    expect(a.drum).toEqual([{ start: 0, length: 16 }]);
    expect(a.melody).toEqual([{ start: 0, length: 16 }]);
    // 保存した曲にブロックが無いパート（あとから増えたパートも）は鳴らさない
    for (const part of ["chord", "bass", "arp", "pad", "signature", "fx", "counter", "perc"] as const) {
      expect(a[part], part).toEqual([]);
    }
  });

  it("定位（pans）のある曲は今のカーブで保存した曲なので、音量を読み替えない。無いパートの定位は初期値", () => {
    storeRaw([legacySong({ volumes: { drum: 70, melody: 80 }, pans: { melody: -20, arp: 40 } })]);
    expect(loadSong("song_old")).toBe(true);
    const s = getState();
    expect(s.volumes.drum).toBe(70);
    expect(s.volumes.melody).toBe(80);
    expect(s.volumes.bass).toBe(defaultState.volumes.bass);
    expect(s.pans).toEqual({ ...defaultState.pans, melody: -20, arp: 40 });
  });

  it("今の形式（arrangeEdits）で保存した曲は、そのまま読む", () => {
    storeRaw([legacySong({ arrangement: undefined, arrangePreset: "drop",
                           arrangeEdits: [{ section: "B", nth: 0, part: "pad", on: false }] })]);
    expect(loadSong("song_old")).toBe(true);
    expect(getState().arrangePreset).toBe("drop");
    expect(getState().arrangeEdits).toEqual([{ section: "B", nth: 0, part: "pad", on: false }]);
  });

  it("無い項目（スウィング・サビ・FX の種類・転調・跳ねる単位など）は初期値、曲の情報はそのまま", () => {
    const s = getState();
    expect(s.swing).toBe(defaultState.swing);
    expect(s.swingUnit).toBe("16n");  // シャッフル（8分音符）は以前はなかった
    expect(s.bassSub).toBe(defaultState.bassSub);  // サブベースはジャンルの標準（null）
    expect(s.chorusPattern).toBe(defaultState.chorusPattern);
    expect(s.fxType).toBe(defaultState.fxType);
    expect(s.sections).toBe(defaultState.sections);
    expect(s.modulation).toBe(0);  // 転調は以前はなかった（しない）
    expect(s.modulationScope).toBe(defaultState.modulationScope);
    expect(s.meter).toBe("4/4");  // 拍子は以前はなかった（4/4）
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

  it.each([
    ["supersaw", "supersaw"], ["epiano", "epiano"], ["bell", "bell"], ["square", "chip_lead"],
    ["lead", "lead"], ["pluck", "pluck"], ["soft", "soft_pad"], ["acid", null], ["auto", null],
  ])("以前の Tone.js のメロディの音色 %s は grow のプリセット %s にし、音作りの値は捨てる", (instrument, preset) => {
    storeRaw([legacySong({ melodyInstrument: instrument, growPreset: "pluck", growParams: { 3: 0.5 } })]);
    loadSong("song_old");
    expect(getState().melodyInstrument).toBe("grow");
    expect(getState().growPreset).toBe(preset);
    expect(getState().growParams).toBeNull();
  });

  it("grow で鳴らしていた曲のメロディの音作りの値はそのまま", () => {
    storeRaw([legacySong({ melodyInstrument: "grow", growPreset: "pluck", growParams: { 3: 0.5 } })]);
    loadSong("song_old");
    expect(getState().growPreset).toBe("pluck");
    expect(getState().growParams).toEqual({ 3: 0.5 });
  });

  it("範囲外の番号のプリセットは初期値（ジャンルの標準）にする", () => {
    storeRaw([legacySong({ growPreset: 9999 })]);
    loadSong("song_old");
    expect(getState().growPreset).toBe(defaultState.growPreset);
    expect(getState().growPreset).toBeNull();
  });

  it("メロディのプリセットが無い・null の曲はジャンルの標準（null）、以前の初期値の lead はそのまま", () => {
    storeRaw([legacySong({ melodyInstrument: "grow", growPreset: undefined })]);
    loadSong("song_old");
    expect(getState().growPreset).toBeNull();

    storeRaw([legacySong({ melodyInstrument: "grow", growPreset: null })]);
    loadSong("song_old");
    expect(getState().growPreset).toBeNull();

    // メロディの標準がまだ無かった頃の曲（初期値の "lead" を保存している）は、保存した音のまま鳴らす
    storeRaw([legacySong({ melodyInstrument: "grow", growPreset: "lead" })]);
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

  it("ピアノロールで作ったオリジナルのドラムも保存・読み込みで同じになる", () => {
    const drumPattern = withDrumHit(customDrumPattern(drums[0], 2), "rim", 21, 0.45);
    setState({ chordPattern: chordById("chord_001"), drumPattern });
    const { id } = saveCurrentSong();
    resetState();
    expect(loadSong(id)).toBe(true);
    expect(getState().drumPattern).toEqual(drumPattern);
  });
});

describe("曲ファイル", () => {
  it("FILE_VERSION 1 の曲ファイルを読み込み、古い値を読み替えて一覧に足す", () => {
    const file = { format: "toniq-song", version: 1, exportedAt: 0, songs: [legacySong(), { name: "壊れた曲" }] };
    const result = importSongFile(JSON.stringify(file));
    expect(result).toEqual({ added: 1, skipped: 1 });
    const [song] = listSongs();
    expect(song.name).toBe("古い曲");
    expect(song.id).not.toBe("song_old");  // 新しい ID で追加する
    expect(song.growPreset).toBeNull();  // 旧 grow（toniq）のメロディは grow のジャンルの標準
    expect(song.growChordPreset).toBe("epiano");
    expect(song.melodyInstrument).toBe("grow");
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

  it("ミュージックリストに保存した曲を開き直すと同じ曲になる", () => {
    setState({ genre: "8bit", key: "G", chordPattern: chordById("chord_012"), drumPattern: drums[1], bars: 8 });
    const before = Object.fromEntries(SONG_FIELDS.map(f => [f, structuredClone(getState()[f])]));
    const { id } = saveCurrentSong();
    resetState();
    expect(loadSong(id)).toBe(true);
    for (const f of SONG_FIELDS) expect(getState()[f], f).toEqual(before[f]);
  });
});

describe("曲ファイル：中身の確認（鳴らすときに例外になる値を読み込まない）", () => {
  const importOne = (overrides: Record<string, unknown>) => {
    const result = importSongFile(JSON.stringify({ format: "toniq-song", version: 4, exportedAt: 0, songs: [legacySong(overrides)] }));
    return { result, song: listSongs()[0] };
  };
  const chord = () => structuredClone(chordById("chord_007"));

  it("知らないキー・ディグリー・コードの種類・スケールの曲は飛ばす", () => {
    expect(importOne({ key: "H" }).result).toEqual({ added: 0, skipped: 1 });
    const badDegree = chord(); badDegree.progression[0].degree = "IX";
    expect(importOne({ chordPattern: badDegree }).result).toEqual({ added: 0, skipped: 1 });
    const badType = chord(); badType.progression[1].type = "power";
    expect(importOne({ chordPattern: badType }).result).toEqual({ added: 0, skipped: 1 });
    expect(importOne({ chordPattern: { ...chord(), base_scale: "blues??" } }).result).toEqual({ added: 0, skipped: 1 });
    expect(importOne({ chordPattern: { ...chord(), progression: [{ bar: "1", degree: "I", type: "major" }] } }).result)
      .toEqual({ added: 0, skipped: 1 });
    expect(listSongs()).toEqual([]);
  });

  it("形の違うメロディの音は落とし、正しい音は残す（3連符の長さも読める）", () => {
    const { result, song } = importOne({
      melodyNotes: [
        { note: "D5", duration: "4n", time: "0:0:0" },
        { note: "X9", duration: "4n", time: "0:1:0" },      // 知らない音名
        { note: "E5", duration: "soon", time: "0:2:0" },    // 知らない長さ
        { note: "F5", duration: "8n", time: "たぶん2小節目" },  // 位置が読めない
        { note: null, duration: "4n", time: "0:3:0" },      // 休符はそのまま
        { note: "A5", duration: "8t", time: "1:0:1.3333" },
        "ゴミ", 42, null,
      ],
      chorusMelodyNotes: "なし",
    });
    expect(result.added).toBe(1);
    expect(song.melodyNotes).toEqual([
      { note: "D5", duration: "4n", time: "0:0:0" },
      { note: null, duration: "4n", time: "0:3:0" },
      { note: "A5", duration: "8t", time: "1:0:1.3333" },
    ]);
    expect(song.chorusMelodyNotes).toEqual([]);
  });

  it("範囲外・型の違う値は、範囲の中の値や初期値にする", () => {
    const { song } = importOne({
      pans: { melody: 999, arp: "左" }, volumes: { drum: -5, melody: "大きめ", bass: 140 },
      parts: { drum: "yes", bass: false }, swing: 250, sidechain: "強", modulation: 40,
      fxType: "explosion", chordRhythm: "triplet", arrangePreset: "wild", swingUnit: "4n", melodyMethod: "ai",
      sections: ["A", "C"], arrangeEdits: [{ section: "B", nth: 0, part: "pad", on: false }, { section: "Z", nth: 0, part: "pad" }, "x"],
      melodyInstrument: "grow", growParams: { 1: 0.5, 2: "x" }, bassSub: "on", meter: "7/8",
    });
    expect(song.pans.melody).toBe(100);
    expect(song.pans.arp).toBe(defaultState.pans.arp);
    expect(song.volumes.drum).toBe(0);
    expect(song.volumes.melody).toBe(defaultState.volumes.melody);
    expect(song.volumes.bass).toBe(100);
    expect(song.parts.drum).toBe(defaultState.parts.drum);
    expect(song.parts.bass).toBe(false);
    expect(song.swing).toBe(100);
    expect(song.sidechain).toBe(0);
    expect(song.modulation).toBe(12);
    expect(song.fxType).toBe("auto");
    expect(song.chordRhythm).toBe(defaultState.chordRhythm);
    expect(song.arrangePreset).toBe("standard");
    expect(song.swingUnit).toBe("16n");
    expect(song.melodyMethod).toBe("manual");
    expect(song.sections).toBeNull();
    expect(song.arrangeEdits).toEqual([{ section: "B", nth: 0, part: "pad", on: false }]);
    expect(song.growParams).toEqual({ 1: 0.5 });
    expect(song.bassSub).toBeNull();
    expect(song.meter).toBe("4/4");
  });

  it("サビの進行は Aメロと長さ・スケールが合うものだけ残し、形の違うものは「なし」にする", () => {
    const base = chordById("chord_007");
    const partner = chords.find(c => c.id !== base.id && c.length_bars === base.length_bars && c.base_scale === base.base_scale)!;
    const other   = chords.find(c => c.length_bars !== base.length_bars)!;
    expect(importOne({ chorusPattern: partner }).song.chorusPattern?.id).toBe(partner.id);
    expect(importOne({ chorusPattern: other }).song.chorusPattern).toBeNull();
    expect(importOne({ chorusPattern: { id: "x", progression: "?" } }).song.chorusPattern).toBeNull();
  });

  it("ドラムのトラックは、ステップ数ちょうどの on/off と強さにそろえる（形の違うトラックは落とす）", () => {
    const { song } = importOne({
      drumPattern: {
        id: "custom", name: "オリジナル", steps: 12, meter: "3/4",
        tracks: {
          kick:  { pattern: [1, 0, 0, 0, "x", 0], velocity: [5, 0, 0, 0] },  // 短い・強さが範囲外・強さがない
          snare: "なし",
        },
      },
    });
    const drum = song.drumPattern!;
    expect(Object.keys(drum.tracks)).toEqual(["kick"]);
    expect(drum.tracks.kick.pattern).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(drum.tracks.kick.velocity).toEqual([1, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0]);
    expect(drum.meter).toBe("3/4");
    expect(drum.genre).toEqual([]);
  });

  it("正しい曲はそのまま読める（書き出して読み込むと同じ内容）", () => {
    setState({
      genre: "ハウス", key: "F#", bpm: 124, bars: 16, meter: "3/4",
      chordPattern: chordById("chord_007"), drumPattern: drums[2],
      melodyNotes: [{ note: "F#4", duration: "8n", time: "1:2:2" }], swing: 30, modulation: 2,
      arrangeEdits: [{ section: "A", nth: 1, part: "drum", bars: [0, 1], splits: [1], drum: "drum_003" }],
    });
    const saved = saveCurrentSong();
    storage.clear();
    importSongFile(JSON.stringify({ format: "toniq-song", version: 4, exportedAt: 0, songs: [saved] }));
    const [song] = listSongs();
    for (const f of SONG_FIELDS) expect(song[f], f).toEqual(saved[f]);
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

describe("保存していない変更（hasUnsavedChanges）", () => {
  beforeEach(() => {
    setState({ mode: "custom", chordPattern: chordById("chord_007"), drumPattern: drums[0] });
    markSongClean();
  });

  it("保存したあとに変えると変更あり、元の値に戻すと変更なし", () => {
    saveCurrentSong();
    expect(hasUnsavedChanges()).toBe(false);
    const bpm = getState().bpm;
    setState({ bpm: bpm + 1 });
    expect(hasUnsavedChanges()).toBe(true);
    setState({ bpm });
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("古い形式の曲は、開いたときの読み替えだけでは変更にしない", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify([legacySong()]));
    loadSong("song_old");
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("モードを移っただけ・キーの順が違うだけでは変更にしない", () => {
    saveCurrentSong();
    const parts = getState().parts;
    const reversed = Object.fromEntries(Object.entries(parts).reverse()) as typeof parts;
    setState({ mode: "simple", generated: true, parts: reversed });
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("今の曲をリストから消すと、変えていなくても変更あり", () => {
    const saved = saveCurrentSong();
    deleteSong(saved.id);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it("新規作成した直後は変更なし", () => {
    setState({ bpm: 200 });
    newSong();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("シンプルモードの生成前は、ピアノロールで作った内容だけを守る", () => {
    setState({ mode: "simple", generated: false, genre: "テクノ", mood: "暗い" });
    expect(hasUnsavedChanges()).toBe(false);
    setState({ melodyMethod: "manual", melodyNotes: [{ note: "C5", duration: "4n", time: "0:0:0" }] });
    expect(hasHandmadeContent()).toBe(true);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it("差し替える前の内容を渡すと、その内容で比べる", () => {
    saveCurrentSong();
    const original = currentSongFields();
    setState({ melodyNotes: [{ note: "C5", duration: "4n", time: "0:0:0" }] });  // サンプルの試聴などの一時的な差し替え
    expect(hasUnsavedChanges()).toBe(true);
    expect(hasUnsavedChanges(original)).toBe(false);
  });
});
