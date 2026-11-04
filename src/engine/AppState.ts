import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import type { LayerName } from "./LayerManager";

// 表示中の画面
export type Screen = "menu" | "simple" | "custom" | "musiclist" | "quiz";

// 画面内のタブ
export type Tab = "settings" | "arranger" | "pianoroll";

// コードを鳴らすリズム（whole = コードの長さいっぱいに伸ばす）
export type ChordRhythm = "whole" | "half" | "quarter" | "eighth";

// メロディの音色
export type MelodyInstrument = "soft" | "lead" | "square" | "pluck";

// コードの音色
export type ChordInstrument = "soft" | "epiano" | "strings" | "organ" | "square";

// アレンジャーのブロック（小節は 0 始まり）
export interface ArrangeBlock {
  start:  number;
  length: number;
}

// パートごとのブロックの並び（開始小節順・重なりなし）
export type Arrangement = Record<LayerName, ArrangeBlock[]>;

// アプリ全体の状態を一元管理する
export interface AppState {
  // 表示中の画面とタブ
  screen: Screen;
  tab:    Tab;

  // 曲を生成済みか（シンプルモードの設定画面／生成結果画面の切り替え）
  generated: boolean;

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

  // メロディの入力方法（自動生成／ピアノロールで自分で入力）と自動生成の回数
  melodyMethod:  "auto" | "manual";
  melodyVersion: number;  // 0 = フレーズA, 1 = フレーズB …

  // カスタムモードの設定
  melodyInstrument: MelodyInstrument;
  chordRhythm:      ChordRhythm;
  chordInstrument:  ChordInstrument;
  scaleLock:        boolean;  // ON のときはコード進行を選択中のスケールのものに絞る
  drumCategory:     string;   // ドラムパターンの絞り込み（drum_patterns.json の genre タグ）

  // アレンジ（null = ジャンルの標準アレンジ。ジャンル・コード進行・小節数に合わせて自動で組まれる）
  arrangement: Arrangement | null;
  startBar:    number;  // アレンジャーでの再生開始位置（小節・0始まり）

  // パートのON/OFF
  parts: {
    drum:    boolean;
    chord:   boolean;
    bass:    boolean;
    arp:     boolean;
    pad:     boolean;
    melody:  boolean;
    fx:      boolean;
  };

  volumes: {
    drum:    number;  // 0〜100
    chord:   number;
    bass:    number;
    arp:     number;
    pad:     number;
    melody:  number;
    fx:      number;
  };
}

// 初期状態
export const defaultState: AppState = {
  screen:      "menu",
  tab:         "settings",
  generated:   false,
  mode:        "simple",
  genre:       "EDM",
  mood:        "明るい",
  key:         "A",
  bpm:         128,
  tempoPreset: "普通",
  bars:        16,

  chordPattern: null,
  drumPattern:  null,
  melodyNotes:  [],
  melodyMethod:  "auto",
  melodyVersion: 0,

  melodyInstrument: "soft",
  chordRhythm:      "whole",
  chordInstrument:  "soft",
  scaleLock:        true,
  drumCategory:     "EDM",

  arrangement: null,
  startBar:    0,

  parts: {
    drum:   true,
    chord:  true,
    bass:   true,
    arp:    false,  // アルペジオは初期状態で OFF
    pad:    true,
    melody: true,
    fx:     true,
  },

  volumes: {
    drum:   80,
    chord:  65,
    bass:   70,
    arp:    60,
    pad:    50,
    melody: 75,
    fx:     55,
  },
};

// 状態をシングルトンで保持
let state: AppState = { ...defaultState, parts: { ...defaultState.parts } };

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
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
