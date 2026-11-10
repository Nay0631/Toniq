import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { getState } from "../engine/AppState";

// 音名の表記（AppState.noteNames）。単音の名前だけを変え、コード名・キー名は CDE 表記のまま
const CDE    = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DOREMI = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];

export function toDoremi(note: string): string {
  return DOREMI[CDE.indexOf(note)] ?? note;
}

// "C#" や "C#4"（オクターブ付き）を今の表記にする（ドレミなら "ド#4"）
export function displayNote(note: string): string {
  if (getState().noteNames !== "doremi") return note;
  const m = /^([A-G]#?)(-?\d+)?$/.exec(note);
  return m ? toDoremi(m[1]) + (m[2] ?? "") : note;
}

export const SCALE_LABELS: Record<string, string> = {
  major:    "メジャー",
  minor:    "マイナー",
  phrygian: "フリジアン",
  dorian:   "ドリアン",
};

const CHORD_SUFFIX: Record<string, string> = {
  major: "", minor: "m", dim: "dim", aug: "aug", maj7: "maj7", min7: "m7", dom7: "7",
};

// コード進行をキーに合わせた実音名で表示する（例：F - G - Em - Am）
export function chordNames(pattern: ChordProgression, key: string): string {
  return pattern.progression
    .map(c => {
      const r = resolveChord(c.degree, c.type, c.inversion, key, pattern.base_scale);
      return r.root + (CHORD_SUFFIX[c.type] ?? "");
    })
    .join(" - ");
}

// コードごとの位置（小節・0始まり）と実音名（ピアノロールの目盛りに表示する）
export function chordSpans(pattern: ChordProgression, key: string): { bar: number; bars: number; name: string }[] {
  return pattern.progression.map(c => {
    const r = resolveChord(c.degree, c.type, c.inversion, key, pattern.base_scale);
    return { bar: c.bar - 1, bars: c.duration_bars, name: r.root + (CHORD_SUFFIX[c.type] ?? "") };
  });
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 再生位置などの時間（分:秒.1/100秒。例 1:00.00）
export function formatTimePrecise(sec: number): string {
  const cs = Math.max(0, Math.floor(sec * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
