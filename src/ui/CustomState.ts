import { getState, setState } from "../engine/AppState";
import { pickChorus } from "../engine/SimpleModeResolver";
import { chorusFits, generateChorusMelody, generateSongMelodies } from "../engine/SongForm";
import { applySwing, swingAmount, sidechainAmount } from "../engine/Groove";
import * as Playback from "../engine/Playback";
import chordDB from "../data/chord_progressions.json";
import drumDB  from "../data/drum_patterns.json";
import { ChordProgression, DrumPattern } from "../data/types";

// カスタムモード画面の状態の更新（DOM は触らない）と、選択肢の元になるデータ。
// 表示は CustomRender.ts、イベントの登録は CustomScreen.ts

export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const BAR_OPTIONS = [8, 16, 24, 32, 48, 64];
export const APP_GENRES  = ["EDM", "8bit", "ローファイ", "ゲームBGM", "テクノ", "ハウス", "トランス", "アンビエント"];

export const chords = chordDB as unknown as ChordProgression[];
export const drums  = drumDB  as unknown as DrumPattern[];

// DB にあるスケール（スケール選択肢）
export const SCALES = [...new Set(chords.map(c => c.base_scale))];

// ドラムのカテゴリ：アプリのジャンルを先に、それ以外の DB のタグを後ろに並べる
export const DRUM_CATEGORIES = [
  ...APP_GENRES.filter(g => drums.some(d => d.genre.includes(g))),
  ...[...new Set(drums.flatMap(d => d.genre))].filter(g => !APP_GENRES.includes(g)),
];

// ===== 状態の更新 =====

// Aメロとサビのメロディを作る（サビは高めの音域）
export function makeMelody(): void {
  const s = getState();
  if (!s.chordPattern) return;
  setState(s.melodyMethod === "auto" ? generateSongMelodies() : { melodyNotes: [], chorusMelodyNotes: [] });
}

// 自動生成したメロディがあるか（空のときはまだ作っていないので、設定を変えても勝手に作らない）
export function hasAutoMelody(): boolean {
  const s = getState();
  return s.melodyMethod === "auto" && s.melodyNotes.length > 0;
}

// コード進行を変えたら、スケールや長さが変わることがあるので自動生成のメロディは作り直す。
// サビの進行が新しい進行と長さ・スケールが合わなくなったら、合うものを選び直す（「なし」にしていればそのまま）
export function setChordPattern(next: ChordProgression): void {
  const s = getState();
  if (next.id === s.chordPattern?.id) return;
  const regenerate = hasAutoMelody();
  const chorusPattern = s.chorusPattern === null || chorusFits(s.chorusPattern, next)
    ? s.chorusPattern
    : pickChorus(next, s.genre, s.mood);
  setState({ chordPattern: next, chorusPattern });
  if (regenerate) {
    setState({ melodyVersion: s.melodyVersion + 1 });
    makeMelody();
  }
}

// サビの進行を変える。メロディがあればサビのメロディだけ作り直す（Aメロのメロディはそのまま）
export function setChorusPattern(next: ChordProgression | null): void {
  setState({ chorusPattern: next });
  if (getState().melodyNotes.length > 0) setState({ chorusMelodyNotes: generateChorusMelody() });
}

// グルーヴのノブ（スウィング・サイドチェイン）
export const GROOVE = [
  { key: "swing",     id: "c-swing",     label: "スウィング",     amount: swingAmount },
  { key: "sidechain", id: "c-sidechain", label: "サイドチェイン", amount: sidechainAmount },
] as const;

// グルーヴの量を変える。サイドチェインはキックのたびに AppState を読むので、スウィングだけ Transport に当て直す
export function setGroove(key: "swing" | "sidechain", value: number | null): void {
  setState(key === "swing" ? { swing: value } : { sidechain: value });
  if (key === "swing") applySwing();
}

// アレンジャータブでは再生開始位置から、それ以外のタブでは先頭から再生する
export function playFromBar(): number {
  const s = getState();
  return s.tab === "arranger" ? Math.min(s.startBar, s.bars - 1) : 0;
}

export function setBpm(bpm: number): void {
  if (!Number.isFinite(bpm)) return;
  const clamped = Math.max(20, Math.min(240, Math.round(bpm)));
  setState({ bpm: clamped, tempoPreset: "custom" });
  if (Playback.isPlaying()) Playback.applyBpm();
}

// 選択中のカテゴリ（雰囲気）とスケールロックで絞ったコード進行
export function chordCandidates(): ChordProgression[] {
  const s = getState();
  const scale = s.chordPattern?.base_scale;
  return chords.filter(c =>
    c.mood.includes(s.mood) && (!s.scaleLock || c.base_scale === scale));
}

export function drumCandidates(): DrumPattern[] {
  return drums.filter(d => d.genre.includes(getState().drumCategory));
}
