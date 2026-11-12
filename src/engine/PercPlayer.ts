import * as Tone from "tone";
import { getState } from "./AppState";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate, positionAt } from "./LoopArranger";
import { endingBar, sectionAt } from "./SongForm";
import { createPercKit, DrumKit } from "./SynthFactory";

// パーカッション：ドラムに重ねる細かい打楽器（シェイカー・タンバリン・コンガ（高・低）・ライド）。
// ジャンルごと・セクション（Aメロ／サビ）ごとのパターンで鳴らす（サビのほうが細かく・にぎやか）。
// 音はドラムの音源（AppState.drumSource）に合わせ、grow ならコアの「パーカッション …」のプリセット、それ以外はシンセ（SynthFactory.ts）。
// エンディングの小節では鳴らさない。強さ・タイミングの揺らぎはドラムの揺らぎ（AppState.drumHumanize）に合わせる

export type PercTrack = "shaker" | "tambourine" | "conga_high" | "conga_low" | "ride";
export const PERC_TRACKS: PercTrack[] = ["shaker", "tambourine", "conga_high", "conga_low", "ride"];

// 16ステップ表記：X = 強く、x = 普通、o = 弱く、. = 休み
type PercPattern = Partial<Record<PercTrack, string>>;

interface PercDef {
  label: string;  // アレンジャーのレーンに出す主な楽器
  A:     PercPattern;
  B:     PercPattern;
}

// ジャンルごとのパターン（ないジャンルはローファイ）
export const PERC_PATTERNS: Record<string, PercDef> = {
  // EDM：Aメロは裏拍のシェイカー、サビは16分のシェイカー＋2・4拍目のタンバリン
  "EDM": {
    label: "シェイカー",
    A: { shaker: "..x...x...x...x." },
    B: { shaker: "oxXooxXooxXooxXo", tambourine: "....X.......X..." },
  },
  // 8bit：ノイズの短いシェイカーだけ（チップチューンのノイズの刻み）
  "8bit": {
    label: "シェイカー",
    A: { shaker: "..o...o...o...o." },
    B: { shaker: "x.ox..oxx.ox..ox" },
  },
  // ローファイ：ゆるい8分のシェイカー（2・4拍目を少し強く）。サビは小さなタンバリンを足す
  "ローファイ": {
    label: "シェイカー",
    A: { shaker: "x.o.X.o.x.o.X.o." },
    B: { shaker: "x.o.X.o.x.o.X.o.", tambourine: "....x.......x..o" },
  },
  // ゲームBGM：2・4拍目のタンバリン。サビは8分のタンバリンとコンガ
  "ゲームBGM": {
    label: "タンバリン",
    A: { tambourine: "....x.......x..." },
    B: { tambourine: "o.o.X.o.o.o.X.o.", conga_high: "......x.....x.x.", conga_low: "x.........x....." },
  },
  // テクノ：裏拍のライド。サビは16分のシェイカーを足す
  "テクノ": {
    label: "ライド",
    A: { ride: "..x...x...x...x." },
    B: { ride: "..X...X...X...X.", shaker: "oxooxxoooxooxxoo" },
  },
  // ハウス：16分のシェイカーとコンガ。サビは裏拍のタンバリンを足す
  "ハウス": {
    label: "シェイカー・コンガ",
    A: { shaker: "oxXooxXooxXooxXo", conga_high: "...x..x.......x.", conga_low: "x.........x....." },
    B: { shaker: "oxXooxXooxXooxXo", tambourine: "..x...x...x...x.", conga_high: "...x..x.x..x..x.", conga_low: "x.....x...x....." },
  },
  // トランス：16分のシェイカー。サビは裏拍のライドを足す
  "トランス": {
    label: "シェイカー・ライド",
    A: { shaker: "oxooxxoooxooxxoo" },
    B: { shaker: "oxXooxXooxXooxXo", ride: "..x...x...x...x." },
  },
  // アンビエント：まばらなシェイカーと、サビは柔らかいコンガ
  "アンビエント": {
    label: "シェイカー",
    A: { shaker: "......o.......o." },
    B: { shaker: "..o...o...o...o.", conga_high: "x.........o.....", conga_low: "......o.......o." },
  },
};

const VELOCITY: Record<string, number> = { X: 1, x: 0.7, o: 0.42 };

function percDef(genre: string): PercDef {
  return PERC_PATTERNS[genre] ?? PERC_PATTERNS["ローファイ"];
}

// アレンジャーに出すラベル（ジャンルの主な楽器）
export function percLabel(genre: string = getState().genre): string {
  return percDef(genre).label;
}

export interface PercHit {
  name:     PercTrack;
  velocity: number;
}

// 曲の小節 bar・ステップ step（0〜15）で鳴らす音（揺らぎは含まない。再生と MIDI 書き出しで共通）
export function percStepHits(bar: number, step: number): PercHit[] {
  if (bar === endingBar()) return [];
  const pattern = percDef(getState().genre)[sectionAt(bar)];
  const hits: PercHit[] = [];
  for (const name of PERC_TRACKS) {
    const v = VELOCITY[pattern[name]?.[step] ?? "."];
    if (v) hits.push({ name, velocity: v });
  }
  return hits;
}

// 揺らぎ：強さを少し揺らし、少し遅らせる（細かい刻みが機械的に聞こえないように）
function humanize(velocity: number): { velocity: number; delay: number } {
  return { velocity: velocity * (1 + (Math.random() - 0.5) * 0.25), delay: Math.random() * 0.005 };
}

let percSeq: Tone.Sequence | null = null;
let kit:     DrumKit | null = null;

export function loadPerc() {
  disposePerc();
  const vol = createVolumeNode("perc");  // 現在のオーディオコンテキスト用のノード
  const { genre, drumSource } = getState();
  kit = createPercKit(genre, drumSource);
  kit.output.connect(vol);
  const voices   = kit.voices;
  const arranged = arrangementGate("perc");
  const position = positionAt();

  percSeq = new Tone.Sequence((time, step: number) => {
    if (!arranged(time)) return;
    const { bar } = position(time);
    const humanizeOn = getState().drumHumanize;
    for (const { name, velocity } of percStepHits(bar, step)) {
      const h = humanizeOn ? humanize(velocity) : { velocity, delay: 0 };
      voices[name]?.trigger(time + h.delay, Math.min(1, Math.max(0.05, h.velocity)));
    }
  }, [...Array(16).keys()], "16n");
  percSeq.start(0);
}

export function disposePerc() {
  percSeq?.dispose();
  kit?.dispose();
  percSeq = null;
  kit     = null;
}
