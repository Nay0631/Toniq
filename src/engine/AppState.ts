import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import type { LayerName } from "./LayerManager";
import type { DrumSource } from "./SynthFactory";

// 表示中の画面
export type Screen = "menu" | "simple" | "custom" | "musiclist" | "quiz" | "settings";

// 画面内のタブ
export type Tab = "settings" | "arranger" | "pianoroll";

// コードを鳴らすリズム（whole = コードの長さいっぱいに伸ばす）
export type ChordRhythm = "whole" | "half" | "quarter" | "eighth";

// メロディの音色（auto = ジャンルの標準。melody_params.json の instrument。
// grow = 内部シンセ grow（初期値。Grow.ts。wasm がないときはジャンルの標準で鳴る））
export type MelodyInstrument =
  "auto" | "soft" | "lead" | "square" | "pluck" | "supersaw" | "epiano" | "bell" | "acid" | "grow";

// コードの音色。いつも grow（growChordPreset / growChordParams で鳴らす。wasm がないときは Tone.js のソフトパッド）。
// 以前の Tone.js の音色（soft / epiano / strings / organ / square / supersaw）は、同じ音の grow のプリセットに読み替える（SongLibrary.ts）
export type ChordInstrument = "grow";

// FX / SE の種類（auto = ジャンルの標準。定義は FxPlayer.ts の FX_DEFS / GENRE_FX）
export type FxType = "auto" | "riser" | "build" | "impact" | "downlifter" | "reverse" | "chip";

// grow で鳴らすベース・パッド・アルペジオ・シグネチャー・カウンターメロディの音作り。preset はコアのプリセットの ID（null = ジャンルの標準。Grow.ts）、
// params はそこから変えた値（パラメーターの ID → 値。null = プリセットのまま）
export type GrowPartName = "bass" | "pad" | "arp" | "signature" | "counter";
export interface GrowSound {
  preset: string | null;
  params: Record<string, number> | null;
}

// ピアノロールで入力する音符の長さ
export type PianoRollLength = "2n" | "4n" | "8n" | "16n";

// ミュージックリストの並び順
export type MusicListSort = "newest" | "oldest" | "name";

// 音名の表記（CDE／ドレミ）。ピアノロール・ルート音・音楽クイズの単音に使う
export type NoteNames = "cde" | "doremi";

// 画面の配色（ライト／ダーク）
export type Theme = "light" | "dark";

// 配色の選び方（system = OS の設定に合わせる）
export type ThemeMode = Theme | "system";

// カスタムモードの画面のスキン（default = ほかの画面と同じ見た目、flat = フラットなプラグイン風、studio = 少し暗い制作スタジオ（DAW）風、pop = 色分けしたポップなグルーヴボックス風）
export type Skin = "default" | "flat" | "studio" | "pop";

// アレンジャーのブロック（小節は 0 始まり）
export interface ArrangeBlock {
  start:  number;
  length: number;
  fx?:    FxType;  // FX のブロックだけ：このブロックで鳴らす種類（なし・"auto" = 曲の設定 AppState.fxType）
  drum?:  string;  // ドラムのブロックだけ：このブロックで鳴らすパターンの ID（なし = 曲の設定 AppState.drumPattern）
}

// パートごとのブロックの並び（開始小節順・重なりなし）。AppState には持たず、
// 構成のプリセット（arrangePreset）と変えた所（arrangeEdits）から LoopArranger.getArrangement() が毎回組み立てる
export type Arrangement = Record<LayerName, ArrangeBlock[]>;

// 曲のセクション（A = Aメロ、B = サビ）。周回（コード進行1周）ごとに決める
export type Section = "A" | "B";

// スウィングでずらす単位（16n = 裏の16分音符、8n = 裏の8分音符。8n で量を上げると3連符のシャッフルになる）
export type SwingUnit = "16n" | "8n";

// 転調する範囲（last = 最後のサビから曲の終わりまで、chorus = サビだけ（Aメロで元のキーに戻る））
export type ModulationScope = "last" | "chorus";

// 構成のプリセット（LoopArranger.ts の ARRANGE_PRESETS。ジャンルの標準の構成 LOOP_SCHEDULE に変形を足したもの）
// standard = 標準、quiet = 静かに始まる、drop = サビを強く、short = 短く繰り返す、buildup = だんだん盛り上がる
export type ArrangePreset = "standard" | "quiet" | "drop" | "short" | "buildup";

// アレンジの「変えた所」。セクション単位（何回目の Aメロ／サビか）で、パートを足す・抜く、ドラムのパターン・FX の種類を変える。
// 標準（プリセット）を組み直してから当て直すので、ジャンル・小節数・進行の長さを変えても追従する
export interface ArrangeEdit {
  section: Section;    // どのセクションの
  nth:     number;     // 何回目（0 始まり。同じ種類のセクションを先頭から数える）
  part:    LayerName;
  on?:     boolean;    // true = セクション全体で鳴らす（足す）、false = 鳴らさない（抜く）、なし = 標準のまま
  bars?:   number[];   // セクションの一部だけで鳴らす：鳴らす小節（セクションの頭からの位置。0 始まり）。on より後に当てる。アレンジャーのドラッグ・長さ変更で作る
  splits?: number[];   // ブロックの切れ目：前の小節から続いていても、この小節（セクションの頭からの位置）で別のブロックにする（アレンジャーで隣に置いたブロックを結合しない）
  drum?:   string;     // ドラムだけ：このセクションで鳴らすパターンの ID
  fx?:     FxType;     // FX だけ：このセクションで鳴らす種類
}

// アプリ全体の状態を一元管理する
export interface AppState {
  // 表示中の画面とタブ
  screen: Screen;
  tab:    Tab;

  // 画面の配色（曲の内容ではないので SONG_FIELDS には入れない。端末ごとに Theme.ts が保存する）
  theme: Theme;
  // 配色の選び方（設定画面。theme はこれと OS の設定から決まる実際の配色）
  themeMode: ThemeMode;
  // カスタムモードのスキン（theme と同じく端末ごとに Theme.ts が保存する）
  skin: Skin;
  // 用語のツールチップを出すか（設定画面。端末ごとに Glossary.ts が保存する。SONG_FIELDS には入れない）
  tooltips: boolean;

  // 曲を生成済みか（シンプルモードの設定画面／生成結果画面の切り替え）
  generated: boolean;

  // ミュージックリストのどの曲を編集中か（null = 未保存の曲。保存すると新しく追加される）
  songId: string | null;

  // ミュージックリストの絞り込み（曲名の検索・ジャンル（"" = すべて）・お気に入りだけ）と並び順
  musicListQuery:     string;
  musicListGenre:     string;
  musicListFavorites: boolean;
  musicListSort:      MusicListSort;

  // 音楽クイズで選んでいる出題モード（QuizModes.ts の id）
  quizMode:      string;

  // 端末ごとの設定（設定画面。Preferences.ts が localStorage に保存する。曲には保存しない）
  noteNames:     NoteNames;  // 音名の表記（音楽クイズの切り替えとも共通）
  loopPlayback:  boolean;    // ON なら曲の終わりで止めずに先頭へ戻って繰り返す

  // モード
  mode:   "simple" | "custom";

  // 共通パラメータ
  genre:  string;
  mood:   string;
  key:    string;
  bpm:    number;
  tempoPreset: "ゆっくり" | "普通" | "速い" | "custom";
  bars:   number;  // 曲全体の最大の長さ（小節）

  // 選択中のパターン
  chordPattern:  ChordProgression | null;
  drumPattern:   DrumPattern      | null;
  melodyNotes:   MelodyNote[];

  // サビ（セクション B）のコード進行とメロディ。
  // chorusPattern は chordPattern と同じ長さ・スケールのものだけ使う（null・合わないときは chordPattern で鳴らす）。
  // chorusMelodyNotes が空なら、サビでも melodyNotes を鳴らす
  chorusPattern:     ChordProgression | null;
  chorusMelodyNotes: MelodyNote[];
  // 周回ごとのセクション（null = ジャンルの標準。LoopArranger の LOOP_SCHEDULE）
  sections:          Section[] | null;
  // 転調：キーを上げる量（半音。0 = しない）と、上げる範囲（last = 最後のサビから曲の終わりまで、chorus = サビだけ（Aメロで戻る））
  modulation:        number;
  modulationScope:   ModulationScope;

  // テスト中の機能の ON/OFF（カスタムモードの設定タブのドラムの「もっと調整」で切り替える。Preferences.ts が端末ごとに保存する。曲には保存しない）
  endingEnabled: boolean;  // 曲の最後の小節を主和音で終わらせる（エンディング）
  drumFill:      boolean;  // セクションの継ぎ目でドラムのフィルを入れる
  drumHumanize:  boolean;  // ドラムの強さ・タイミングを少し揺らし、ゴーストノートを入れる

  // メロディの入力方法（自動生成／ピアノロールで自分で入力）と自動生成の回数
  melodyMethod:  "auto" | "manual";
  melodyVersion: number;  // 0 = フレーズA, 1 = フレーズB …

  // カスタムモードの設定
  melodyInstrument: MelodyInstrument;
  chordRhythm:      ChordRhythm;
  chordInstrument:  ChordInstrument;
  fxType:           FxType;  // FX / SE の種類
  // グルーヴ（0〜100。null = ジャンルの標準。mix_presets.json の swing / sidechain）
  swing:            number | null;  // 裏の16分音符を後ろへずらす量（跳ねたノリ）
  swingUnit:        SwingUnit;      // ずらす単位（16n = 裏の16分音符、8n = 裏の8分音符（シャッフル））
  sidechain:        number | null;  // キックに合わせてベース・コードなどを沈める量（ポンピング）
  scaleLock:        boolean;  // ON のときはコード進行を選択中のスケールのものに絞る
  drumCategory:     string;   // ドラムパターンの絞り込み（drum_patterns.json の genre タグ）
  // ドラムの音源（grow = grow（初期値）、synth = Tone.js のシンセ、sample = ワンショット音源）。テスト中の切り替え。
  // 設定画面で選び、Preferences.ts が端末ごとに保存する（曲には保存しない）
  drumSource:       DrumSource;
  // grow の音作り（曲に保存する）。プリセットの ID（grow のコアの GrowPresets.cpp の id）と、
  // そこから変えた値（パラメーターの ID → 実際の値。null = プリセットのまま）
  growPreset:       string | null;  // null = ジャンルの標準（Grow.ts の MELODY_STANDARD）
  growParams:       Record<string, number> | null;
  // コードを grow で鳴らすときの音作り（メロディとは別に持つ。形は growPreset / growParams と同じ）
  growChordPreset:  string | null;  // null = ジャンルの標準（Grow.ts の CHORD_STANDARD）
  growChordParams:  Record<string, number> | null;
  // ベース・パッド・アルペジオ・シグネチャー・カウンターメロディの grow の音作り（どれも grow で鳴らす。wasm がないときは Tone.js の音色）
  growSounds:       Record<GrowPartName, GrowSound>;
  // ベースにサブベース（低いサイン）を重ねるか（null = ジャンルの標準。bass_params.json の sub）
  bassSub:          boolean | null;

  // アレンジ：構成のプリセットと、そこから変えた所（空 = プリセットのまま）。
  // どちらもジャンル・コード進行・小節数・セクションに合わせて組み直す（ブロックの並びは LoopArranger.getArrangement()）
  arrangePreset: ArrangePreset;
  arrangeEdits:  ArrangeEdit[];
  startBar:    number;  // アレンジャーでの再生開始位置（小節・0始まり）

  // ピアノロールの入力設定（スケールロックはコード進行の scaleLock とは別）
  pianoRollLength:    PianoRollLength;
  pianoRollScaleLock: boolean;  // ON のときはスケール外の音を置けない
  pianoRollOctave:    number;   // 鍵盤入力（A〜K）のオクターブ

  // パートのON/OFF
  parts: {
    drum:    boolean;
    chord:   boolean;
    bass:    boolean;
    arp:     boolean;
    pad:     boolean;
    signature: boolean;
    melody:  boolean;
    counter: boolean;  // カウンターメロディ（サビはハモり、Aメロは合いの手。CounterPlayer.ts）
    perc:    boolean;  // パーカッション（シェイカー・タンバリン・コンガ・ライド。PercPlayer.ts）
    fx:      boolean;
  };

  volumes: {
    drum:    number;  // 0〜100
    chord:   number;
    bass:    number;
    arp:     number;
    pad:     number;
    signature: number;
    melody:  number;
    counter: number;
    perc:    number;
    fx:      number;
  };
}

// 初期状態
export const defaultState: AppState = {
  screen:      "menu",
  tab:         "settings",
  theme:       "light",
  themeMode:   "system",
  skin:        "default",
  tooltips:    true,
  generated:   false,
  songId:      null,

  musicListQuery:     "",
  musicListGenre:     "",
  musicListFavorites: false,
  musicListSort:      "newest",

  quizMode:      "doremi_cde",
  noteNames:     "cde",
  loopPlayback:  false,

  mode:      "simple",
  genre:       "EDM",
  mood:        "明るい",
  key:         "A",
  bpm:         128,
  tempoPreset: "普通",
  bars:        32,

  chordPattern: null,
  drumPattern:  null,
  melodyNotes:  [],
  chorusPattern:     null,
  chorusMelodyNotes: [],
  sections:          null,
  modulation:        0,
  modulationScope:   "last",
  endingEnabled: true,
  drumFill:      true,
  drumHumanize:  true,
  melodyMethod:  "auto",
  melodyVersion: 0,

  melodyInstrument: "grow",
  chordRhythm:      "whole",
  chordInstrument:  "grow",
  fxType:           "auto",
  swing:            null,
  swingUnit:        "16n",
  sidechain:        null,
  scaleLock:        true,
  drumCategory:     "EDM",
  drumSource:       "grow",
  growPreset:       null,  // ジャンルの標準
  growParams:       null,
  growChordPreset:  null,  // ジャンルの標準
  growChordParams:  null,
  growSounds: {
    bass:      { preset: null, params: null },
    pad:       { preset: null, params: null },
    arp:       { preset: null, params: null },
    signature: { preset: null, params: null },
    counter:   { preset: null, params: null },
  },
  bassSub:          null,  // ジャンルの標準

  arrangePreset: "standard",
  arrangeEdits:  [],
  startBar:    0,

  pianoRollLength:    "4n",
  pianoRollScaleLock: true,
  pianoRollOctave:    4,

  parts: {
    drum:   true,
    chord:  true,
    bass:   true,
    arp:    true,
    pad:    true,
    signature: true,
    melody: true,
    counter: true,
    perc:   true,
    fx:     true,
  },

  volumes: {
    drum:   80,
    chord:  65,
    bass:   70,
    arp:    60,
    pad:    50,
    signature: 60,
    melody: 75,
    counter: 65,
    perc:   55,
    fx:     55,
  },
};

// 曲として保存する AppState の項目（画面・タブ・ピアノロールの入力設定などの表示上の状態は含めない）。
// ミュージックリスト（SongLibrary.ts）・曲ファイル・元に戻す／やり直す（History.ts）で使う
export const SONG_FIELDS = [
  "mode", "genre", "mood", "key", "bpm", "tempoPreset", "bars",
  "chordPattern", "drumPattern", "melodyNotes", "chorusPattern", "chorusMelodyNotes", "sections",
  "modulation", "modulationScope",
  "melodyMethod", "melodyVersion",
  "melodyInstrument", "chordRhythm", "chordInstrument", "fxType", "swing", "swingUnit", "sidechain", "scaleLock", "drumCategory",
  "growPreset", "growParams", "growChordPreset", "growChordParams", "growSounds", "bassSub",
  "arrangePreset", "arrangeEdits", "parts", "volumes",
] as const;

export type SongFields = Pick<AppState, typeof SONG_FIELDS[number]>;

// 状態をシングルトンで保持
let state: AppState = { ...defaultState, parts: { ...defaultState.parts } };

export function getState(): AppState {
  return state;
}

// 状態が変わる直前に呼ぶ関数（History.ts が元に戻す／やり直すの履歴を取るのに使う）
let beforeChange: ((prev: AppState, partial: Partial<AppState>) => void) | null = null;

export function onBeforeSetState(fn: (prev: AppState, partial: Partial<AppState>) => void): void {
  beforeChange = fn;
}

export function setState(partial: Partial<AppState>): void {
  beforeChange?.(state, partial);
  state = { ...state, ...partial };
}

// シンプルモードの結果をカスタムモードに引き継ぐ
export function applySimpleToCustom(): void {
  state = {
    ...state,
    mode: "custom",
    // シンプルモードで決定したパラメータはそのままカスタムモードに引き継がれる
    // ドラムの絞り込みはシンプルモードで選んだジャンルに合わせる
    drumCategory: state.genre,
  };
  console.log("シンプル→カスタム引き継ぎ完了:", state);
}
