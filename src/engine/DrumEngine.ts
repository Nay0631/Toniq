import * as Tone from "tone";
import { CUSTOM_DRUM_ID, DrumPattern, DrumTrack } from "../data/types";
import drumDB from "../data/drum_patterns.json";
import { getState, ArrangeBlock } from "./AppState";
import { createDrumKit, DrumKit } from "./SynthFactory";
import { createVolumeNode } from "./VolumeManager";
import { prepareGrowContext } from "./Grow";
import { arrangementBlockAt, findBlock, getArrangement, getForcedPart, isArrangementBypassed, positionAt } from "./LoopArranger";
import { endingBar, fillKind, FillKind, isFillBar } from "./SongForm";
import { sidechainHit } from "./Groove";
import {
  Meter, currentMeter, fitPattern, gridStep, gridSteps, isTriplet, sourceSteps, stepSubdivision, unitsPerBar,
} from "./Meter";

const DRUM_PATTERNS = drumDB as unknown as DrumPattern[];

// DB に出てくるトラック名すべて。ブロックごとにパターンを切り替えても音が欠けないよう、キットは全トラック分作る
const ALL_TRACKS = [...new Set(DRUM_PATTERNS.flatMap(p => Object.keys(p.tracks)))];

// クローズドハイハットが鳴ったら止める音（実機と同じくオープンハイハットを切る）
const CHOKES: Record<string, string[]> = {
  hihat_closed: ["hihat_open"],
};

export function drumPatternById(id: string): DrumPattern | undefined {
  return DRUM_PATTERNS.find(p => p.id === id);
}

// ===== オリジナルのドラムパターン（ピアノロールのドラムで作る。id は CUSTOM_DRUM_ID） =====

// ピアノロールの行の並び（上から。シンバル類を上、キックを下にする）と表示名
export const DRUM_ROLL_TRACKS = ["hihat_open", "hihat_closed", "clap", "rim", "snare", "kick"] as const;
export const DRUM_TRACK_LABELS: Record<string, string> = {
  hihat_open:   "オープンハイハット",
  hihat_closed: "クローズドハイハット",
  clap:         "クラップ",
  rim:          "リム",
  snare:        "スネア",
  kick:         "キック",
};
// DB と同じ音名（MIDI 書き出しは MidiExporter の GM_DRUMS を使うので、ここは記録用）
const DRUM_NOTES: Record<string, string> = {
  kick: "C1", rim: "C#1", snare: "D1", clap: "D#1", hihat_closed: "F#1", hihat_open: "A#1",
};

// オリジナルのパターンの長さ（小節）の選択肢
export const CUSTOM_DRUM_BARS = [1, 2, 4] as const;

export function isCustomDrum(pattern: DrumPattern | null | undefined): boolean {
  return pattern?.id === CUSTOM_DRUM_ID;
}

// パターンの長さ（小節。1小節のマスの数はパターンの拍子で決まる。DB のパターンは 16 ステップで 1 小節）
export function drumPatternBars(pattern: DrumPattern): number {
  return Math.max(1, Math.round(pattern.steps / unitsPerBar(pattern.meter ?? "4/4")));
}

// ===== 拍子に合わせたパターン =====

// 拍子 from のマスで持ったトラックの並びを、4/4 の 16 ステップの並びに広げる（3/4 は4拍目を空に、3連符は拍ごとに4つ目を空にする）
function toSixteen(values: number[], from: Meter): number[] {
  if (from === "4/4") return values;
  const out: number[] = [];
  const size = from === "3/4" ? 12 : 3;  // 3/4 は小節ごと、3連符は拍ごとに空きを足す
  const pad  = from === "3/4" ? 4 : 1;
  for (let i = 0; i < values.length; i += size) {
    out.push(...values.slice(i, i + size), ...new Array(pad).fill(0));
  }
  return out;
}

// 拍子ごとに直したパターン（パターンは編集のたびに新しいオブジェクトになるので、オブジェクトごとに覚えておけばよい）
const patternsIn = new WeakMap<DrumPattern, Partial<Record<Meter, DrumPattern>>>();

// パターンを拍子 to のマスに直したもの（同じ拍子ならそのまま）。DB のパターン（4/4 の 16 ステップ）を
// 3/4・3連符の拍子で鳴らすとき、オリジナルのパターンを別の拍子に持っていくときに使う（直し方は Meter.ts の sourceSteps）
export function drumPatternIn(pattern: DrumPattern, to: Meter = currentMeter()): DrumPattern {
  const from = pattern.meter ?? "4/4";
  if (from === to) return pattern;
  const cache = patternsIn.get(pattern) ?? {};
  patternsIn.set(pattern, cache);
  if (cache[to]) return cache[to];

  const tracks: Record<string, DrumTrack> = {};
  let steps = 0;
  for (const [name, track] of Object.entries(pattern.tracks)) {
    const on  = toSixteen(track.pattern, from);
    const vel = toSixteen(track.velocity ?? track.pattern, from);
    const src = sourceSteps(on, v => (v ? 1 : 0), to);
    tracks[name] = { ...track, pattern: src.map(i => (on[i] ? 1 : 0)), velocity: src.map(i => (on[i] ? vel[i] ?? 1 : 0)) };
    steps = src.length;
  }
  const bars = drumPatternBars(pattern);
  const { meter: _from, ...rest } = pattern;
  const result: DrumPattern = {
    ...rest, steps: steps || bars * unitsPerBar(to), tracks, ...(to === "4/4" ? {} : { meter: to }),
  };
  cache[to] = result;
  return result;
}

// source をもとに、bars 小節のオリジナルのパターンを今の拍子のマスで作る（長くするときは source を繰り返し、短くするときは切る。
// source がオリジナルなら説明 notes を引き継ぐ。source が null なら空のパターン）
export function customDrumPattern(source: DrumPattern | null, bars: number): DrumPattern {
  const meter = currentMeter();
  const steps = bars * unitsPerBar(meter);
  const s = getState();
  const fitted = source ? drumPatternIn(source, meter) : null;
  const tracks: Record<string, DrumTrack> = {};
  for (const name of DRUM_ROLL_TRACKS) {
    const src = fitted?.tracks[name];
    const at  = (i: number) => (src ? i % fitted!.steps : 0);
    tracks[name] = {
      pattern:  Array.from({ length: steps }, (_, i) => (src?.pattern[at(i)] ? 1 : 0)),
      velocity: Array.from({ length: steps }, (_, i) => (src?.pattern[at(i)] ? src.velocity?.[at(i)] ?? 1 : 0)),
      note:     src?.note ?? DRUM_NOTES[name],
    };
  }
  const based = !source ? "空のパターンから作成"
    : isCustomDrum(source) ? source.notes
    : `#${source.id.replace(/\D/g, "")} ${source.name} をもとに作成`;
  return {
    id:        CUSTOM_DRUM_ID,
    name:      "オリジナル",
    genre:     [s.genre],
    mood:      [s.mood],
    bpm_range: source?.bpm_range ?? { min: 60, max: 200 },
    steps,
    step_unit: stepSubdivision(meter),
    tracks,
    ...(based ? { notes: based } : {}),
    ...(meter === "4/4" ? {} : { meter }),
  };
}

// track の step を velocity で鳴らす（0 = 消す）。元のパターンは変えずに新しいパターンを返す
export function withDrumHit(pattern: DrumPattern, track: string, step: number, velocity: number): DrumPattern {
  const old = pattern.tracks[track] ?? {
    pattern:  new Array(pattern.steps).fill(0),
    velocity: new Array(pattern.steps).fill(0),
    note:     DRUM_NOTES[track] ?? "C1",
  };
  const next: DrumTrack = { ...old, pattern: [...old.pattern], velocity: [...(old.velocity ?? [])] };
  next.pattern[step]  = velocity > 0 ? 1 : 0;
  next.velocity[step] = velocity > 0 ? velocity : 0;
  return { ...pattern, tracks: { ...pattern.tracks, [track]: next } };
}

// ===== 試聴（ピアノロールのドラムで行をクリック・音を置いたとき） =====

let previewKit: DrumKit | null = null;
let previewKey = "";
let previewContext: Tone.BaseContext | null = null;

export async function previewDrumHit(name: string, velocity = 1): Promise<void> {
  await Tone.start();
  const { genre, drumSource } = getState();
  if (drumSource !== "synth") await prepareGrowContext();  // サンプル音源でもファイルのない音は grow
  // ジャンル・音源・オーディオコンテキストが変わったら作り直す
  const key = `${genre}/${drumSource}`;
  if (!previewKit || previewKey !== key || previewContext !== Tone.getContext()) {
    previewContext = Tone.getContext();
    previewKit?.dispose();
    previewKit = createDrumKit(genre, [...DRUM_ROLL_TRACKS], drumSource);
    previewKit.output.connect(createVolumeNode("drum"));
    previewKey = key;
  }
  previewKit.voices[name]?.trigger(Tone.now() + 0.01, velocity);
}

// ブロックで鳴らすパターン（ブロックに指定がない・DB に見つからないときは曲の設定のパターン）
export function blockDrumPattern(block?: ArrangeBlock | null): DrumPattern | null {
  const own = block?.drum ? drumPatternById(block.drum) : undefined;
  return own ?? getState().drumPattern;
}

// ===== フィル・エンディング =====

// ジャンルごとのフィル（SongForm.fillKind の小節で鳴らす）。大きさは3段階（小・中・大）。
// from: 小節の何ステップ目から（16分音符・0 始まり）。tracks: from からの 16 ステップ表記（x = 鳴らす。長さは 16 - from）。
// keep: フィルの間も元のパターンのまま鳴らすトラック（それ以外は止める）。強さは from から小節の終わりへ向けて強くする
export interface FillDef {
  from:   number;
  tracks: Record<string, string>;
  keep:   string[];
}

export type FillSize = "small" | "normal" | "big";
export const FILL_SIZES: readonly FillSize[] = ["small", "normal", "big"];

const HATS_KEEP = ["hihat_closed", "hihat_open"];

export const FILLS: Record<string, Record<FillSize, FillDef>> = {
  "EDM": {
    small:  { from: 12, tracks: { snare: "xxxx", kick: "x..." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "xxxxxxxx", kick: "x...x..." }, keep: [] },  // 2拍のスネアロール
    big:    { from: 0,  tracks: { snare: "x...x...x.x.xxxx", kick: "x...x...x...x..." }, keep: [] },  // 4分→8分→16分と細かくなるビルド
  },
  "トランス": {
    small:  { from: 12, tracks: { snare: "xxxx", kick: "x..." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "xxxxxxxx", kick: "x...x..." }, keep: [] },
    big:    { from: 0,  tracks: { snare: "x.x.x.x.xxxxxxxx", kick: "x...x...x...x..." }, keep: [] },  // 8分→16分のロール
  },
  "8bit": {
    small:  { from: 12, tracks: { snare: "xxxx", kick: "x..." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "x.xxx.xx", kick: "x.x....." }, keep: [] },
    big:    { from: 4,  tracks: { snare: "x.x.xxx.xxxx", kick: "x...x.x.x..." }, keep: [] },
  },
  "ゲームBGM": {
    small:  { from: 12, tracks: { snare: "x.xx", kick: "x..." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "x.x.xxxx", kick: "x...x..." }, keep: ["hihat_closed"] },
    big:    { from: 4,  tracks: { snare: "x.x.x.x.xxxx", kick: "x...x...x..." }, keep: [] },
  },
  "テクノ": {
    small:  { from: 14, tracks: { clap: "xx", kick: "x." }, keep: HATS_KEEP },
    normal: { from: 12, tracks: { clap: "x.xx", kick: "x..." }, keep: HATS_KEEP },
    big:    { from: 8,  tracks: { clap: "x.x.x.xx", kick: "x...x..." }, keep: HATS_KEEP },
  },
  "ハウス": {
    small:  { from: 14, tracks: { snare: "xx", kick: "x." }, keep: HATS_KEEP },
    normal: { from: 12, tracks: { snare: "x.xx", clap: "x...", kick: "x..." }, keep: HATS_KEEP },
    big:    { from: 8,  tracks: { snare: "x.x.xxxx", clap: "x...x...", kick: "x...x..." }, keep: HATS_KEEP },
  },
  "ローファイ": {
    small:  { from: 12, tracks: { snare: "x..x", kick: "..x." }, keep: ["hihat_closed"] },
    normal: { from: 12, tracks: { snare: "x.xx", kick: "..x." }, keep: ["hihat_closed"] },
    big:    { from: 8,  tracks: { snare: "x..xx.xx", kick: "..x...x." }, keep: ["hihat_closed"] },
  },
  "アンビエント": {
    small:  { from: 12, tracks: { rim: "..x." }, keep: ["kick", "hihat_closed"] },
    normal: { from: 12, tracks: { rim: "x.x.", hihat_open: "..x." }, keep: [] },
    big:    { from: 8,  tracks: { rim: "x...x.x.", hihat_open: "......x.", kick: "x......." }, keep: [] },
  },
  // ワルツ（3/4）：小節の終わりの3拍（ステップ 4〜15）に寄せて鳴らすので、終わりの拍に向けて細かくする
  "ワルツ": {
    small:  { from: 12, tracks: { snare: "x.x." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "x.x.x.xx", kick: "x......." }, keep: [] },
    big:    { from: 4,  tracks: { snare: "x.x.x.x.xxxx", kick: "x.......x..." }, keep: [] },
  },
  // 6/8バラード（4/4 の3連符）：拍ごとに「x x x .」と書くと3連符3つになる
  "6/8バラード": {
    small:  { from: 12, tracks: { snare: "xxx." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "x.x.xxx.", kick: "x......." }, keep: [] },
    big:    { from: 0,  tracks: { snare: "x...x.x.xxx.xxx.", kick: "x.......x......." }, keep: [] },
  },
  // シャッフル（4/4 の3連符）：「x.x.」= タッカ（3連符の1つ目と3つ目）、「xxx.」= 3連符3つ
  "シャッフル": {
    small:  { from: 12, tracks: { snare: "x.x." }, keep: ["hihat_closed"] },
    normal: { from: 8,  tracks: { snare: "x.xxxxx.", kick: "x......." }, keep: [] },
    big:    { from: 0,  tracks: { snare: "x.x.x.x.xxx.xxx.", kick: "x.......x......." }, keep: [] },
  },
};

// フィルの理由ごとの大きさ（0 = 小・1 = 中・2 = 大）。次がサビ・エンディングは大きく、同じセクションの中の区切りは小さく
const KIND_SIZE: Record<FillKind, number> = { ending: 2, chorus: 2, section: 1, change: 1, regular: 0 };
// 雰囲気で大きさをずらす（ないものは 0）
const MOOD_SIZE: Record<string, number> = { "激しい": 1, "落ち着いた": -1 };

// フィルの理由と雰囲気から大きさを決める
export function fillSize(kind: FillKind, mood: string): FillSize {
  const i = KIND_SIZE[kind] + (MOOD_SIZE[mood] ?? 0);
  return FILL_SIZES[Math.min(2, Math.max(0, i))];
}

// 曲の小節 bar で鳴らすフィル（フィルの小節でなければ null）
export function fillAt(bar: number): FillDef | null {
  const kind = fillKind(bar);
  if (!kind) return null;
  const { genre, mood } = getState();
  return (FILLS[genre] ?? FILLS["ローファイ"])[fillSize(kind, mood)];
}

// フィルを今の拍子のマスに直したもの（tracks は小節の頭からの文字列。from より前は休み）。
// 3/4 では小節の終わりの3拍を使う（フィルは小節の終わりに置くので、頭の3拍を取ると短いフィルが消えてしまう）
interface GridFill { from: number; tracks: Record<string, string>; keep: string[] }
const gridFills = new WeakMap<FillDef, Partial<Record<Meter, GridFill>>>();

function gridFill(fill: FillDef): GridFill {
  const meter = currentMeter();
  const cache = gridFills.get(fill) ?? {};
  gridFills.set(fill, cache);
  const found = cache[meter];
  if (found) return found;
  const tracks: Record<string, string> = {};
  for (const [name, steps] of Object.entries(fill.tracks)) {
    tracks[name] = fitPattern((".".repeat(fill.from) + steps).padEnd(16, "."), meter, true);
  }
  const from = meter === "3/4" ? Math.max(0, fill.from - 4) : gridStep(fill.from, meter) ?? 0;
  return (cache[meter] = { from, tracks, keep: fill.keep });
}

// エンディングの小節の頭で鳴らす音（このあとは鳴らさない）
const ENDING_HITS: Record<string, number> = { kick: 1, snare: 0.85, hihat_open: 1 };

export interface DrumHit {
  name:     string;
  velocity: number;
}

// 曲の小節 bar・小節のマス step（Meter.ts。4/4 なら 0〜15）でパターン pattern を鳴らすときの音（フィル・エンディングを含む。
// パターンは 1 小節のマスの倍数（DB は 1 小節、オリジナルは 1・2・4 小節）。今の拍子と違う拍子のパターン
// （DB の 16 ステップを 3/4 で鳴らすなど）は、今の拍子のマスに直して鳴らす。
// 揺らぎは含まない。再生と MIDI 書き出しで共通）
export function drumStepHits(source: DrumPattern, bar: number, step: number): DrumHit[] {
  if (bar === endingBar()) {
    return step === 0 ? Object.entries(ENDING_HITS).map(([name, velocity]) => ({ name, velocity })) : [];
  }

  // 複数小節のパターン（オリジナル）は、曲の小節からパターンの何小節目かを決める
  const BAR     = unitsPerBar();
  const pattern = drumPatternIn(source);
  const i    = (bar * BAR + step) % pattern.steps;
  const hits = Object.entries(pattern.tracks)
    .filter(([, track]) => track.pattern[i])
    .map(([name, track]) => ({ name, velocity: track.velocity?.[i] ?? 1 }));

  const def = fillAt(bar);
  if (!def) return hits;
  const fill = gridFill(def);
  if (step < fill.from) return hits;

  // フィルの間：keep 以外の元の音を止め、フィルの音を鳴らす（小節の終わりへ向けて強くする）
  const progress = (step - fill.from) / Math.max(1, BAR - 1 - fill.from);
  const filled   = hits.filter(h => fill.keep.includes(h.name));
  for (const [name, steps] of Object.entries(fill.tracks)) {
    if (steps[step] !== "x") continue;
    filled.push({ name, velocity: name === "kick" ? 0.9 : 0.45 + 0.55 * progress });
  }
  return filled;
}

// 曲の小節 bar・ステップ step でキックが鳴るか（ベースの強さをキックにそろえるのに使う）
export function kickAt(bar: number, step: number): boolean {
  const s = getState();
  if (!s.parts.drum) return false;
  let block = isArrangementBypassed() ? null : findBlock(getArrangement().drum, bar);
  if (block === undefined && getForcedPart() === "drum") block = null;  // ピアノロールでドラムを編集中（arrangementBlockAt と同じ）
  if (block === undefined) return false;
  const pattern = blockDrumPattern(block);
  return !!pattern && drumStepHits(pattern, bar, step).some(h => h.name === "kick");
}

// ===== 揺らぎ（AppState.drumHumanize） =====

// ゴーストノート（小さなスネア）を入れるジャンルと確率。入れる位置は2拍目・4拍目のスネアの前後の裏
const GHOST_RATE: Record<string, number> = { "ローファイ": 0.25, "ハウス": 0.15, "ゲームBGM": 0.12, "シャッフル": 0.2 };
const GHOST_STEPS = [7, 10, 15];

const HATS = new Set(["hihat_closed", "hihat_open"]);

// 強さとタイミングを少し揺らす。ハイハットは裏の16分を弱くして強弱の波を付ける。キックはずらさない（ノリの軸）
function humanize(name: string, velocity: number, step: number): { velocity: number; delay: number } {
  const jitter = (amount: number) => 1 + (Math.random() - 0.5) * amount;
  if (HATS.has(name)) {
    // 裏の16分（3連符の拍子では3連符の2つ目）を弱くする
    const weak = isTriplet() ? step % 3 === 1 : step % 2 === 1;
    return { velocity: velocity * (weak ? 0.8 : 1) * jitter(0.2), delay: Math.random() * 0.006 };
  }
  if (name === "kick") return { velocity: velocity * jitter(0.06), delay: 0 };
  return { velocity: velocity * jitter(0.12), delay: Math.random() * 0.004 };
}

// ===== 読み込み =====

let currentSeq: Tone.Sequence | null = null;
let kit: DrumKit | null = null;
let drumVol: Tone.Volume | null = null;

// 周回の頭で読み込み直したとき、直前に予約済みの音（頭のキックなど）を切らないよう
// 古いキットは少し待ってから破棄する
const RETIRE_MS = 1500;
const retiredKits = new Set<DrumKit>();

// キットはジャンルで音作りが変わるので、パターンを読み込むたびに作り直す。
// pattern は曲の設定のパターン。アレンジのブロックに別のパターンがあれば、その小節はそちらで鳴らす
export function loadDrumPattern(pattern: DrumPattern) {
  currentSeq?.dispose();
  currentSeq = null;
  if (kit) {
    const old = kit;
    retiredKits.add(old);
    setTimeout(() => {
      if (retiredKits.delete(old)) old.dispose();
    }, RETIRE_MS);
    kit = null;
  }

  drumVol = createVolumeNode("drum");  // 現在のオーディオコンテキスト用のノード
  const { genre, drumSource } = getState();
  const trackNames = [...new Set([...ALL_TRACKS, ...Object.keys(pattern.tracks)])];
  kit = createDrumKit(genre, trackNames, drumSource);
  kit.output.connect(drumVol);
  const voices = kit.voices;
  // 鳴らすかどうかとパターンは、発音時刻にあるブロックで決める（再生中のアレンジの編集もすぐ反映される）
  const blockAt  = arrangementBlockAt("drum");
  const position = positionAt();
  const ghostSteps = gridSteps(GHOST_STEPS);  // 16 ステップでの位置を今の拍子のマスに直す

  currentSeq = new Tone.Sequence(
    (time, step) => {
      const block = blockAt(time);
      if (block === undefined) return;
      // block === null（アレンジを通さない試聴）も今の曲の設定のパターンで鳴らす（ピアノロールのドラムの編集がすぐ反映される）
      const current = blockDrumPattern(block) ?? pattern;
      const { bar } = position(time);
      const hits = drumStepHits(current, bar, step);

      // 揺らぎ：ゴーストノートを足す（フィル・エンディングの小節と、スネアが鳴る位置は除く）
      const s = getState();
      if (s.drumHumanize && current.tracks.snare && ghostSteps.includes(step)
          && !hits.some(h => h.name === "snare") && !isFillBar(bar) && bar !== endingBar()
          && Math.random() < (GHOST_RATE[s.genre] ?? 0)) {
        hits.push({ name: "snare", velocity: 0.16 + Math.random() * 0.1 });
      }

      const hit = new Set<string>();
      hits.forEach(({ name, velocity }) => {
        const h = s.drumHumanize ? humanize(name, velocity, step) : { velocity, delay: 0 };
        const v = Math.min(1, Math.max(0.05, h.velocity));
        voices[name]?.trigger(time + h.delay, v);
        if (name === "kick") sidechainHit(time, v);  // キックに合わせてベース・コードなどを沈める
        hit.add(name);
      });
      hit.forEach(name => {
        for (const target of CHOKES[name] ?? []) {
          if (!hit.has(target)) voices[target]?.choke?.(time);
        }
      });
    },
    // 1小節のマス（4/4 は 16、3/4・3連符は 12）を1つずつ回す（複数小節のパターンは drumStepHits が小節から位置を決める）
    [...Array(unitsPerBar()).keys()],
    stepSubdivision()
  );

  currentSeq.start(0);
}

export function disposeDrum() {
  currentSeq?.dispose();
  kit?.dispose();
  retiredKits.forEach(k => k.dispose());
  retiredKits.clear();
  currentSeq = null;
  kit        = null;
}
