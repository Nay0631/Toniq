import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";

// アプリ全体の状態を一元管理する
export interface AppState {
  // モード
  mode:   "simple" | "custom";

  // 共通パラメータ
  genre:  string;
  mood:   string;
  key:    string;
  bpm:    number;

  // 選択中のパターン
  chordPattern:  ChordProgression | null;
  drumPattern:   DrumPattern      | null;
  melodyNotes:   MelodyNote[];

  // パートのON/OFF
  parts: {
    drum:    boolean;
    chord:   boolean;
    bass:    boolean;
    arp:     boolean;
    pad:     boolean;
    melody:  boolean;
  };
}

// 初期状態
export const defaultState: AppState = {
  mode:  "simple",
  genre: "EDM",
  mood:  "明るい",
  key:   "A",
  bpm:   128,

  chordPattern: null,
  drumPattern:  null,
  melodyNotes:  [],

  parts: {
    drum:   true,
    chord:  true,
    bass:   true,
    arp:    true,
    pad:    true,
    melody: true,
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
  };
  console.log("シンプル→カスタム引き継ぎ完了:", state);
}