import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";

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

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
