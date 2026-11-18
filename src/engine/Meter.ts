import { getState } from "./AppState";

// 拍子（AppState.meter）と、1小節のマス（ステップ）の数え方。
//   "4/4"  = 4拍 × 16分音符4つ = 16 マス（今までどおり）
//   "3/4"  = 3拍 × 16分音符4つ = 12 マス
//   "4/4t" = 4拍 × 3連符3つ   = 12 マス（4/4 の3連符。12/8 のノリ）
// 各パートは「マス」の数で位置と長さを持ち（以前の「16分音符の数」。3連符では 1 マス = 8分3連符）、
// 鳴らすときに unitTime / barTime で Tone.js の時刻にする。
// パターンDB（ドラム・ベース・メロディのリズムなど）は 4/4 の 16 ステップで書いてあるので、fitPattern / sourceSteps で今の拍子のマスに直して使う

export type Meter = "4/4" | "3/4" | "4/4t";

export const METERS: readonly Meter[] = ["4/4", "3/4", "4/4t"];
export const METER_LABELS: Record<Meter, string> = { "4/4": "4/4", "3/4": "3/4", "4/4t": "4/4（3連符）" };

interface Grid { beats: number; perBeat: number }
const GRIDS: Record<Meter, Grid> = {
  "4/4":  { beats: 4, perBeat: 4 },
  "3/4":  { beats: 3, perBeat: 4 },
  "4/4t": { beats: 4, perBeat: 3 },
};

// 今の曲の拍子（知らない値なら 4/4）
export function currentMeter(): Meter {
  const m = getState().meter;
  return GRIDS[m] ? m : "4/4";
}

const grid = (m: Meter) => GRIDS[m] ?? GRIDS["4/4"];

// 1小節の拍の数・1拍のマスの数・1小節のマスの数
export function beatsPerBar(m: Meter = currentMeter()): number  { return grid(m).beats; }
export function unitsPerBeat(m: Meter = currentMeter()): number { return grid(m).perBeat; }
export function unitsPerBar(m: Meter = currentMeter()): number  { return grid(m).beats * grid(m).perBeat; }
export function isTriplet(m: Meter = currentMeter()): boolean   { return grid(m).perBeat === 3; }

// 1 マスの長さ（16分音符いくつ分か。3連符は 4/3）
function unitSixteenths(m: Meter): number { return 4 / grid(m).perBeat; }

// Tone.js の Sequence で 1 マスずつ回すときの刻み
export function stepSubdivision(m: Meter = currentMeter()): "16n" | "8t" {
  return isTriplet(m) ? "8t" : "16n";
}

// マスの数（ループの頭からの位置、または長さ）→ Tone.js の時刻。「0:0:16分音符の数」は拍子に関係なく同じ長さになる
export function unitTime(units: number, m: Meter = currentMeter()): string {
  return `0:0:${units * unitSixteenths(m)}`;
}

// 小節 bar（0 始まり）のマス unit → Tone.js の時刻（小節:拍:16分。小節の長さは Transport の拍子で決まる）
export function barTime(bar: number, unit: number, m: Meter = currentMeter()): string {
  return `${bar}:0:${unit * unitSixteenths(m)}`;
}

// 小節の中のマス unit が強拍か（4/4 は1・3拍目、3/4 は1拍目）
export function isStrongUnit(unit: number, m: Meter = currentMeter()): boolean {
  const bar = unitsPerBar(m);
  const pos = ((unit % bar) + bar) % bar;
  return pos === 0 || (grid(m).beats === 4 && pos === bar / 2);
}

// ===== 16 ステップのパターンを今の拍子のマスに直す =====

// 4/4 の 16 ステップ（複数小節なら 16 の倍数）の並びから、今の拍子の各マスが元のどのステップを使うか。
//   3/4：各小節の頭の3拍（12 ステップ）を使う（fromEnd なら終わりの3拍。小節の終わりに置くフィル用）
//   3連符：拍ごとに 16分音符4つ [1 2 3 4] → 3連符3つ [1 2 3か4]。3つ目は 3 と 4 のうち weight の大きいほう
//          （8分の裏は3連符の3つ目になる = シャッフル。16分の4つ目だけ鳴る所も3つ目に寄せる）
export function sourceSteps<T>(
  pattern: ArrayLike<T>, weight: (v: T | undefined) => number, m: Meter = currentMeter(), fromEnd = false,
): number[] {
  const bars = Math.max(1, Math.ceil(pattern.length / 16));
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 16;
    if (m === "3/4") {
      for (let i = 0; i < 12; i++) out.push(base + i + (fromEnd ? 4 : 0));
    } else if (m === "4/4t") {
      for (let beat = 0; beat < 4; beat++) {
        const s = base + beat * 4;
        out.push(s, s + 1, weight(pattern[s + 3]) > weight(pattern[s + 2]) ? s + 3 : s + 2);
      }
    } else {
      for (let i = 0; i < 16; i++) out.push(base + i);
    }
  }
  return out;
}

// 文字のパターン（"x-.." や "R.O." など）の重み：休み（"." と範囲外）< 伸ばす（"-"）< 発音
const charWeight = (c: string | undefined) => c === undefined || c === "." ? 0 : c === "-" ? 1 : 2;

// 16 ステップの文字のパターンを今の拍子のマスの文字列にする（足りない所は休み "."）
export function fitPattern(pattern: string, m: Meter = currentMeter(), fromEnd = false): string {
  if (m === "4/4") return pattern;
  return sourceSteps(pattern, charWeight, m, fromEnd).map(i => pattern[i] ?? ".").join("");
}

// 4/4 の小節の中のステップ（0〜15）が、今の拍子のどのマスになるか（3/4 の4拍目は null = 鳴らさない）
export function gridStep(step16: number, m: Meter = currentMeter()): number | null {
  if (m === "3/4") return step16 < 12 ? step16 : null;
  if (m === "4/4t") return Math.floor(step16 / 4) * 3 + [0, 1, 2, 2][step16 % 4];
  return step16;
}

// 4/4 のステップの並び（[2, 6, 10, 14] など）を今の拍子のマスにする（鳴らせないもの・重なったものは除く）
export function gridSteps(steps16: readonly number[], m: Meter = currentMeter()): number[] {
  const out: number[] = [];
  for (const s of steps16) {
    const u = gridStep(s, m);
    if (u !== null && !out.includes(u)) out.push(u);
  }
  return out;
}

// 刻み（16分・8分・4分）で鳴らす、1拍の中のマス。3連符では 16分 = 3連符3つ、8分 = 1つ目と3つ目（シャッフル）
export function beatUnits(step: "16n" | "8n" | "4n", m: Meter = currentMeter()): number[] {
  if (step === "4n") return [0];
  if (isTriplet(m)) return step === "8n" ? [0, 2] : [0, 1, 2];
  return step === "8n" ? [0, 2] : [0, 1, 2, 3];
}

// 刻みで鳴らす、1小節の中のマス
export function barUnits(step: "16n" | "8n" | "4n", m: Meter = currentMeter()): number[] {
  const per = unitsPerBeat(m), units = beatUnits(step, m);
  return Array.from({ length: beatsPerBar(m) }, (_, beat) => units.map(u => beat * per + u)).flat();
}

// ===== 時刻・長さの文字列（メロディの音が持つ形）とマスの数の変換 =====

// 音価の長さ（拍）。"8t" / "4t" は3連符
const DURATION_BEATS: Record<string, number> = {
  "1n.": 6, "1n": 4, "2n.": 3, "2n": 2, "4n.": 1.5, "4n": 1, "8n.": 0.75, "8n": 0.5, "16n.": 0.375, "16n": 0.25, "32n": 0.125,
  "4t": 2 / 3, "8t": 1 / 3,
};

// マスの数 → 音価（ちょうどの音価があるものだけ。なければ 小節:拍:16分 表記で表す）
const UNIT_DURATIONS: Record<"straight" | "triplet", Record<number, string>> = {
  straight: { 1: "16n", 2: "8n", 3: "8n.", 4: "4n", 6: "4n.", 8: "2n", 12: "2n.", 16: "1n" },
  triplet:  { 1: "8t", 2: "4t", 3: "4n", 6: "2n", 9: "2n.", 12: "1n" },
};

// 小節:拍:16分 の位置を拍（曲・ループの頭から）にする
export function timeToBeats(time: string, m: Meter = currentMeter()): number {
  const [bar = 0, beat = 0, sixteenth = 0] = time.split(":").map(Number);
  return (bar || 0) * beatsPerBar(m) + (beat || 0) + (sixteenth || 0) / 4;
}

// 音価（"4n" など）か 小節:拍:16分 の長さを拍にする
export function durationToBeats(duration: string, m: Meter = currentMeter()): number {
  return DURATION_BEATS[duration] ?? (duration.includes(":") ? timeToBeats(duration, m) : 1);
}

export function unitsToTime(units: number, m: Meter = currentMeter()): string {
  const bar = unitsPerBar(m), per = unitsPerBeat(m);
  const inBar = units % bar;
  return `${Math.floor(units / bar)}:${Math.floor(inBar / per)}:${(inBar % per) * unitSixteenths(m)}`;
}

export function timeToUnits(time: string, m: Meter = currentMeter()): number {
  return Math.round(timeToBeats(time, m) * unitsPerBeat(m));
}

export function unitsToDuration(units: number, m: Meter = currentMeter()): string {
  const per = unitsPerBeat(m);
  return UNIT_DURATIONS[isTriplet(m) ? "triplet" : "straight"][units]
      ?? `0:${Math.floor(units / per)}:${(units % per) * unitSixteenths(m)}`;  // 半端な長さは 小節:拍:16分 表記
}

export function durationToUnits(duration: string, m: Meter = currentMeter()): number {
  return Math.max(1, Math.round(durationToBeats(duration, m) * unitsPerBeat(m)));
}

// ===== 拍子を変えたときの読み替え =====

// 拍子 from で書いた音（メロディ）を拍子 to のマスに置き直す。小節と小節の中の拍の位置を保ち、いちばん近いマスに寄せる。
// 3/4 にない4拍目の音は落とし、同じマスに重なった音は先のものを残す。長さは次の音・小節数の終わりを越えないよう詰める。
// 休符（note が null）は持たない
export function convertNotes<T extends { note: string | null; time: string; duration: string }>(
  notes: T[], from: Meter, to: Meter,
): T[] {
  if (from === to) return notes;
  const placed: { note: T; start: number; units: number }[] = [];
  for (const n of notes) {
    if (n.note === null) continue;
    const beats = timeToBeats(n.time, from);
    const bar   = Math.floor(beats / beatsPerBar(from) + 1e-9);
    const inBar = beats - bar * beatsPerBar(from);
    if (inBar > beatsPerBar(to) - 1e-9) continue;
    const unit  = Math.min(unitsPerBar(to) - 1, Math.round(inBar * unitsPerBeat(to)));
    const start = bar * unitsPerBar(to) + unit;
    if (placed.some(p => p.start === start)) continue;
    placed.push({ note: n, start, units: Math.max(1, Math.round(durationToBeats(n.duration, from) * unitsPerBeat(to))) });
  }
  placed.sort((a, b) => a.start - b.start);
  return placed.map((p, i) => {
    const next  = placed[i + 1]?.start ?? Infinity;
    const units = Math.max(1, Math.min(p.units, next - p.start));
    return { ...p.note, time: unitsToTime(p.start, to), duration: unitsToDuration(units, to) };
  });
}
