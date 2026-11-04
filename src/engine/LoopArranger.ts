import * as Tone from "tone";
import { getState, ArrangeBlock, Arrangement } from "./AppState";
import type { LayerName } from "./LayerManager";

export const LAYERS: LayerName[] = ["drum", "chord", "bass", "arp", "pad", "melody", "fx"];

// ジャンルごとの周回アレンジ定義（パートは一度入ると以降の周回でも鳴り続ける）
// 標準アレンジ（AppState.arrangement が null のとき）はこれを周回の長さで並べて作る
const LOOP_SCHEDULE: Record<string, Record<number, string[]>> = {
  "EDM": {
    1: ["drum", "chord"],
    2: ["drum", "chord", "bass", "fx"],
    3: ["drum", "chord", "bass", "arp", "pad", "fx"],
    4: ["drum", "chord", "bass", "arp", "pad", "melody", "fx"],
  },
  "8bit": {
    1: ["drum", "chord"],
    2: ["drum", "chord", "melody"],
    3: ["drum", "chord", "melody", "bass", "fx"],
    4: ["drum", "chord", "melody", "bass", "arp", "fx"],
  },
  "ローファイ": {
    1: ["drum", "chord", "pad"],
    2: ["drum", "chord", "pad", "bass"],
    3: ["drum", "chord", "pad", "bass", "melody"],
    4: ["drum", "chord", "pad", "bass", "melody", "arp"],
  },
  "ゲームBGM": {
    1: ["drum", "chord"],
    2: ["drum", "chord", "bass", "pad"],
    3: ["drum", "chord", "bass", "pad", "melody", "fx"],
    4: ["drum", "chord", "bass", "pad", "melody", "arp", "fx"],
  },
  "テクノ": {
    1: ["drum"],
    2: ["drum", "bass", "fx"],
    3: ["drum", "bass", "arp", "chord", "fx"],
    4: ["drum", "bass", "arp", "chord", "pad", "melody", "fx"],
  },
};

// 指定した周回で鳴っているパート
export function getActiveParts(genre: string, loop: number): string[] {
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  const maxLoop  = Math.max(...Object.keys(schedule).map(Number));
  return schedule[Math.min(Math.max(loop, 1), maxLoop)];
}

// 全パートがそろうまでの周回数
export function getFullArrangementLoops(genre: string): number {
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  return Math.max(...Object.keys(schedule).map(Number));
}

// ===== アレンジ =====

export function emptyArrangement(): Arrangement {
  return { drum: [], chord: [], bass: [], arp: [], pad: [], melody: [], fx: [] };
}

// ジャンルの標準アレンジ：周回ごとに LOOP_SCHEDULE のパートを置き、続いている周回は1つのブロックにまとめる
export function buildDefaultArrangement(genre: string, loopBars: number, totalBars: number): Arrangement {
  const arrangement = emptyArrangement();
  for (let start = 0, loop = 1; start < totalBars; start += loopBars, loop++) {
    const length = Math.min(loopBars, totalBars - start);
    for (const part of getActiveParts(genre, loop) as LayerName[]) {
      const blocks = arrangement[part];
      const last   = blocks[blocks.length - 1];
      if (last && last.start + last.length === start) last.length += length;
      else blocks.push({ start, length });
    }
  }
  return arrangement;
}

// 標準アレンジは再生中に何度も参照するので、条件が同じあいだは作り直さない
let defaultCache: { key: string; arrangement: Arrangement } | null = null;

// 現在のアレンジ（編集していなければジャンルの標準アレンジ）
export function getArrangement(): Arrangement {
  const s = getState();
  if (s.arrangement) return s.arrangement;
  if (!s.chordPattern) return emptyArrangement();

  const key = `${s.genre}|${s.chordPattern.length_bars}|${s.bars}`;
  if (defaultCache?.key !== key) {
    defaultCache = { key, arrangement: buildDefaultArrangement(s.genre, s.chordPattern.length_bars, s.bars) };
  }
  return defaultCache.arrangement;
}

// 編集用のコピー（ブロックも複製する）
export function cloneArrangement(arrangement: Arrangement): Arrangement {
  const copy = emptyArrangement();
  for (const part of LAYERS) copy[part] = arrangement[part].map(b => ({ ...b }));
  return copy;
}

export function findBlock(blocks: ArrangeBlock[], bar: number): ArrangeBlock | undefined {
  return blocks.find(b => bar >= b.start && bar < b.start + b.length);
}

// アレンジ上、指定した小節（0 始まり）でパートが鳴るか
export function isArrangedAt(part: LayerName, bar: number): boolean {
  return findBlock(getArrangement()[part], bar) !== undefined;
}

// パート単体の試聴中はアレンジに関係なく鳴らす（Playback.preview が立て、stop で戻す）
let bypass = false;

export function setArrangementBypass(on: boolean): void {
  bypass = on;
}

// 各パートの Part / Sequence のコールバックで使う判定。
// 読み込んだ時点の Transport（WAV書き出しではオフライン用）で、発音時刻が何小節目かを調べる
export function arrangementGate(part: LayerName): (time: number) => boolean {
  const transport = Tone.getTransport();
  return time => {
    if (bypass) return true;
    const bar = Math.floor(transport.getTicksAtTime(time) / (transport.PPQ * 4) + 1e-6);
    return isArrangedAt(part, bar);
  };
}

// ===== 周回の表示 =====

interface LoopArrangerParams {
  loopBars:      number;
  onLoopChange?: (loop: number, parts: string[]) => void;
}

let loopCount = 0;
let repeatId: number | null = null;

// 周回の頭ごとに、その周回の頭で鳴っているパートを知らせる
export function startLoopArranger(params: LoopArrangerParams) {
  const { loopBars, onLoopChange } = params;
  loopCount = 0;

  repeatId = Tone.getTransport().scheduleRepeat(time => {
    Tone.getDraw().schedule(() => {
      loopCount++;
      const bar   = (loopCount - 1) * loopBars;
      const parts = getState().parts;
      const activeParts = LAYERS.filter(p => parts[p] && isArrangedAt(p, bar));
      console.log(`周回 ${loopCount} / アクティブパート: ${activeParts.join(", ")}`);
      onLoopChange?.(loopCount, activeParts);
    }, time);
  }, `${loopBars}m`, 0);
}

export function stopLoopArranger() {
  if (repeatId !== null) {
    Tone.getTransport().clear(repeatId);
    repeatId = null;
  }
  loopCount = 0;
}

export function getCurrentLoop(): number {
  return loopCount;
}
