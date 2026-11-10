import * as Tone from "tone";
import { DrumPattern } from "../data/types";
import drumDB from "../data/drum_patterns.json";
import { getState, ArrangeBlock } from "./AppState";
import { createDrumKit, DrumKit } from "./SynthFactory";
import { createVolumeNode } from "./VolumeManager";
import { arrangementBlockAt, findBlock, getArrangement, isArrangementBypassed, positionAt } from "./LoopArranger";
import { endingBar, isFillBar } from "./SongForm";
import { sidechainHit } from "./Groove";

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

// ブロックで鳴らすパターン（ブロックに指定がない・DB に見つからないときは曲の設定のパターン）
export function blockDrumPattern(block?: ArrangeBlock | null): DrumPattern | null {
  const own = block?.drum ? drumPatternById(block.drum) : undefined;
  return own ?? getState().drumPattern;
}

// ===== フィル・エンディング =====

// ジャンルごとのフィル（SongForm.isFillBar の小節で鳴らす）。
// from: 小節の何ステップ目から（16分音符・0 始まり）。tracks: from からの 16 ステップ表記（x = 鳴らす）。
// keep: フィルの間も元のパターンのまま鳴らすトラック（それ以外は止める）。強さは from から小節の終わりへ向けて強くする
interface FillDef {
  from:   number;
  tracks: Record<string, string>;
  keep:   string[];
}

const FILLS: Record<string, FillDef> = {
  "EDM":         { from: 8,  tracks: { snare: "xxxxxxxx", kick: "x...x..." }, keep: [] },  // 2拍のスネアロール
  "トランス":     { from: 8,  tracks: { snare: "xxxxxxxx", kick: "x...x..." }, keep: [] },
  "8bit":        { from: 8,  tracks: { snare: "x.xxx.xx", kick: "x.x....." }, keep: [] },
  "ゲームBGM":   { from: 8,  tracks: { snare: "x.x.xxxx", kick: "x...x..." }, keep: ["hihat_closed"] },
  "テクノ":       { from: 12, tracks: { clap: "x.xx", kick: "x..." },           keep: ["hihat_closed", "hihat_open"] },
  "ハウス":       { from: 12, tracks: { snare: "x.xx", clap: "x...", kick: "x..." }, keep: ["hihat_closed", "hihat_open"] },
  "ローファイ":   { from: 12, tracks: { snare: "x.xx", kick: "..x." },          keep: ["hihat_closed"] },
  "アンビエント": { from: 12, tracks: { rim: "x.x.", hihat_open: "..x." },     keep: [] },
};

// エンディングの小節の頭で鳴らす音（このあとは鳴らさない）
const ENDING_HITS: Record<string, number> = { kick: 1, snare: 0.85, hihat_open: 1 };

export interface DrumHit {
  name:     string;
  velocity: number;
}

// 曲の小節 bar・小節のステップ step（0〜15）でパターン pattern を鳴らすときの音（フィル・エンディングを含む。
// 揺らぎは含まない。再生と MIDI 書き出しで共通）
export function drumStepHits(pattern: DrumPattern, bar: number, step: number): DrumHit[] {
  if (bar === endingBar()) {
    return step === 0 ? Object.entries(ENDING_HITS).map(([name, velocity]) => ({ name, velocity })) : [];
  }

  const i    = step % pattern.steps;
  const hits = Object.entries(pattern.tracks)
    .filter(([, track]) => track.pattern[i])
    .map(([name, track]) => ({ name, velocity: track.velocity?.[i] ?? 1 }));

  const fill = FILLS[getState().genre] ?? FILLS["ローファイ"];
  if (step < fill.from || !isFillBar(bar)) return hits;

  // フィルの間：keep 以外の元の音を止め、フィルの音を鳴らす（小節の終わりへ向けて強くする）
  const pos      = step - fill.from;
  const progress = pos / Math.max(1, 15 - fill.from);
  const filled   = hits.filter(h => fill.keep.includes(h.name));
  for (const [name, steps] of Object.entries(fill.tracks)) {
    if (steps[pos] !== "x") continue;
    filled.push({ name, velocity: name === "kick" ? 0.9 : 0.45 + 0.55 * progress });
  }
  return filled;
}

// 曲の小節 bar・ステップ step でキックが鳴るか（ベースの強さをキックにそろえるのに使う）
export function kickAt(bar: number, step: number): boolean {
  const s = getState();
  if (!s.parts.drum) return false;
  const block = isArrangementBypassed() ? null : findBlock(getArrangement().drum, bar);
  if (block === undefined) return false;
  const pattern = blockDrumPattern(block);
  return !!pattern && drumStepHits(pattern, bar, step).some(h => h.name === "kick");
}

// ===== 揺らぎ（AppState.drumHumanize） =====

// ゴーストノート（小さなスネア）を入れるジャンルと確率。入れる位置は2拍目・4拍目のスネアの前後の裏
const GHOST_RATE: Record<string, number> = { "ローファイ": 0.25, "ハウス": 0.15, "ゲームBGM": 0.12 };
const GHOST_STEPS = [7, 10, 15];

const HATS = new Set(["hihat_closed", "hihat_open"]);

// 強さとタイミングを少し揺らす。ハイハットは裏の16分を弱くして強弱の波を付ける。キックはずらさない（ノリの軸）
function humanize(name: string, velocity: number, step: number): { velocity: number; delay: number } {
  const jitter = (amount: number) => 1 + (Math.random() - 0.5) * amount;
  if (HATS.has(name)) {
    return { velocity: velocity * (step % 2 === 1 ? 0.8 : 1) * jitter(0.2), delay: Math.random() * 0.006 };
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

  currentSeq = new Tone.Sequence(
    (time, step) => {
      const block = blockAt(time);
      if (block === undefined) return;
      const current = block === null ? pattern : blockDrumPattern(block) ?? pattern;
      const { bar } = position(time);
      const hits = drumStepHits(current, bar, step);

      // 揺らぎ：ゴーストノートを足す（フィル・エンディングの小節と、スネアが鳴る位置は除く）
      const s = getState();
      if (s.drumHumanize && current.tracks.snare && GHOST_STEPS.includes(step)
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
    [...Array(pattern.steps).keys()],
    pattern.step_unit as Tone.Unit.Time
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
