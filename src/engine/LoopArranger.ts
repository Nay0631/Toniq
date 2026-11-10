import * as Tone from "tone";
import { getState, ArrangeBlock, Arrangement, Section } from "./AppState";
import type { LayerName } from "./LayerManager";

export const LAYERS: LayerName[] = ["drum", "chord", "bass", "arp", "pad", "signature", "melody", "fx"];

// ジャンルごとの周回アレンジ定義。標準アレンジ（AppState.arrangement が null のとき）はこれを周回の長さで並べて作る。
// section: その周回のセクション（A = Aメロ、B = サビ。サビの進行・メロディで鳴らす。AppState.sections が null のときの標準）
// parts:   その周回で鳴らすパート（足すだけでなく、ブレイクで抜く周回もある）
// gap:     その周回の最後の1小節だけ抜くパート（サビの直前に空白を作る。コード進行が2小節以上のとき）
// build:   その周回の最後の1小節だけ足すパート（ブレイクの終わりにドラムを戻してフィルで次へつなぐ。2小節以上のとき）
// 定義より長い曲は、2周目以降の定義をくり返す（ずっと全部のパートが鳴り続けないようにする）
interface LoopPlan {
  section: Section;
  parts:   LayerName[];
  gap?:    LayerName[];
  build?:  LayerName[];
}

const LOOP_SCHEDULE: Record<string, LoopPlan[]> = {
  // EDM：イントロ → ブレイク（ドラム・ベースを抜いてメロディを聴かせる）→ ドロップ（サビ）
  "EDM": [
    { section: "A", parts: ["drum", "chord", "bass"] },
    { section: "A", parts: ["chord", "pad", "arp", "melody", "fx"], build: ["drum"] },
    { section: "B", parts: ["drum", "chord", "bass", "arp", "pad", "signature", "melody", "fx"] },
    { section: "B", parts: ["drum", "chord", "bass", "arp", "pad", "signature", "melody", "fx"] },
  ],
  // 8bit：サビでアルペジオをシグネチャー（高速アルペジオ）に持ち替える
  "8bit": [
    { section: "A", parts: ["drum", "chord", "melody"] },
    { section: "A", parts: ["drum", "chord", "melody", "bass", "arp"], gap: ["bass"] },
    { section: "B", parts: ["drum", "chord", "melody", "bass", "signature", "fx"] },
    { section: "B", parts: ["drum", "chord", "melody", "bass", "arp", "signature", "fx"] },
  ],
  // ローファイ：ドラムなしのイントロから。サビはパッドをアルペジオに替える
  "ローファイ": [
    { section: "A", parts: ["chord", "pad", "signature"] },
    { section: "A", parts: ["drum", "chord", "pad", "bass", "melody", "signature"], gap: ["drum"] },
    { section: "B", parts: ["drum", "chord", "bass", "melody", "arp", "signature"] },
    { section: "B", parts: ["drum", "chord", "pad", "bass", "melody", "arp", "signature"] },
  ],
  "ゲームBGM": [
    { section: "A", parts: ["drum", "chord", "bass"] },
    { section: "A", parts: ["drum", "chord", "bass", "pad", "melody"], gap: ["drum"] },
    { section: "B", parts: ["drum", "chord", "bass", "pad", "melody", "arp", "signature", "fx"] },
    { section: "B", parts: ["drum", "chord", "bass", "melody", "arp", "signature", "fx"] },
  ],
  // テクノ：キックとベースから。3周目はキックを抜いたブレイク
  "テクノ": [
    { section: "A", parts: ["drum", "bass"] },
    { section: "A", parts: ["drum", "bass", "signature", "fx"], gap: ["bass"] },
    { section: "B", parts: ["chord", "pad", "signature", "arp", "fx"], build: ["drum"] },
    { section: "B", parts: ["drum", "bass", "signature", "arp", "chord", "pad", "melody", "fx"] },
  ],
  "ハウス": [
    { section: "A", parts: ["drum", "bass"] },
    { section: "A", parts: ["drum", "bass", "chord", "melody", "fx"], gap: ["bass"] },
    { section: "B", parts: ["drum", "bass", "chord", "pad", "melody", "signature", "fx"] },
    { section: "B", parts: ["drum", "bass", "chord", "pad", "melody", "arp", "signature", "fx"] },
  ],
  // トランス：ビルドアップ → ブレイクダウン（ドラム・ベースを抜いてパッドとメロディだけ）→ ドロップで全部そろう
  "トランス": [
    { section: "A", parts: ["drum", "bass"] },
    { section: "A", parts: ["drum", "bass", "arp", "signature", "fx"], gap: ["bass"] },
    { section: "B", parts: ["pad", "chord", "signature", "melody", "fx"], build: ["drum"] },
    { section: "B", parts: ["drum", "bass", "chord", "arp", "pad", "signature", "melody", "fx"] },
  ],
  // アンビエント：パッドとコードから始め、ドラムは最後に薄く足す
  "アンビエント": [
    { section: "A", parts: ["pad", "chord"] },
    { section: "A", parts: ["pad", "chord", "melody", "signature"] },
    { section: "B", parts: ["pad", "chord", "melody", "bass", "arp", "signature"] },
    { section: "B", parts: ["pad", "chord", "melody", "arp", "signature", "drum"] },
  ],
};

function loopPlan(genre: string, loop: number): LoopPlan {
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  const n = Math.max(loop, 1);
  if (n <= schedule.length) return schedule[n - 1];
  // 定義より後ろの周回は、2周目以降の定義をくり返す
  const repeat = schedule.length - 1;
  return schedule[1 + ((n - 2) % repeat)];
}

// 指定した周回で鳴っているパート
export function getActiveParts(genre: string, loop: number): string[] {
  return loopPlan(genre, loop).parts;
}

// 全パートがそろうまでの周回数（標準アレンジの定義の周回数）
export function getFullArrangementLoops(genre: string): number {
  return (LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"]).length;
}

// ジャンルの標準のセクション（周回ごと。loops 周回ぶん）
export function defaultSections(genre: string, loops: number): Section[] {
  return Array.from({ length: loops }, (_, i) => loopPlan(genre, i + 1).section);
}

// ===== アレンジ =====

export function emptyArrangement(): Arrangement {
  return { drum: [], chord: [], bass: [], arp: [], pad: [], signature: [], melody: [], fx: [] };
}

// ジャンルの標準アレンジ：周回ごとに LOOP_SCHEDULE のパートを置き、続いている周回は1つのブロックにまとめる。
// 次の周回がサビ（セクション B）に変わるときは、gap のパートをその周回の最後の1小節だけ抜く
// sections を渡すと、セクションの切り替わりはその並び（AppState.sections）で判断する
export function buildDefaultArrangement(
  genre: string, loopBars: number, totalBars: number, sections?: Section[] | null,
): Arrangement {
  const arrangement = emptyArrangement();
  const sectionOf = (loop: number) => sections?.[loop - 1] ?? loopPlan(genre, loop).section;
  for (let start = 0, loop = 1; start < totalBars; start += loopBars, loop++) {
    const plan   = loopPlan(genre, loop);
    const length = Math.min(loopBars, totalBars - start);
    const toChorus = sectionOf(loop) === "A" && sectionOf(loop + 1) === "B" && start + loopBars < totalBars;
    const full  = loopBars >= 2 && length === loopBars && start + loopBars < totalBars;
    const gap   = toChorus && full ? plan.gap ?? [] : [];
    const build = full ? (plan.build ?? []).filter(p => !plan.parts.includes(p)) : [];
    const place = (part: LayerName, from: number, len: number) => {
      const blocks = arrangement[part];
      const last   = blocks[blocks.length - 1];
      if (last && last.start + last.length === from) last.length += len;
      else blocks.push({ start: from, length: len });
    };
    for (const part of plan.parts) place(part, start, gap.includes(part) ? length - 1 : length);
    for (const part of build) place(part, start + length - 1, 1);
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

  const key = `${s.genre}|${s.chordPattern.length_bars}|${s.bars}|${s.sections?.join("") ?? ""}`;
  if (defaultCache?.key !== key) {
    defaultCache = { key, arrangement: buildDefaultArrangement(s.genre, s.chordPattern.length_bars, s.bars, s.sections) };
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

// 試聴・サンプル中か（アレンジの判定を外しているとき。セクション・エンディング・フィルも使わない）
export function isArrangementBypassed(): boolean {
  return bypass;
}

// 発音時刻（秒）が曲の何小節目・小節の何ステップ目（16分音符）か。読み込んだ時点の Transport で調べる
export function positionAt(): (time: number) => { bar: number; step: number } {
  const transport = Tone.getTransport();
  return time => {
    const sixteenths = Math.floor(transport.getTicksAtTime(time) / (transport.PPQ / 4) + 1e-6);
    return { bar: Math.floor(sixteenths / 16), step: sixteenths % 16 };
  };
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

// arrangementGate と同じ判定で、発音時刻にあるブロックを返す（ブロックごとに鳴らし分けるパート用。FX の種類など）
// ブロックの外なら undefined、試聴中（判定を外しているとき）は null
export function arrangementBlockAt(part: LayerName): (time: number) => ArrangeBlock | null | undefined {
  const transport = Tone.getTransport();
  return time => {
    if (bypass) return null;
    const bar = Math.floor(transport.getTicksAtTime(time) / (transport.PPQ * 4) + 1e-6);
    return findBlock(getArrangement()[part], bar);
  };
}

// ===== 周回の表示 =====

interface LoopArrangerParams {
  loopBars:      number;
  fromBar:       number;  // 再生を始める小節（途中から再生するとき）
  onLoopChange?: (loop: number, parts: string[]) => void;
}

let loopCount = 0;
let repeatId: number | null = null;

// 周回を知らせる（その周回の頭の小節で鳴っているパートと一緒に）
function notifyLoop(loop: number, loopBars: number, onLoopChange?: LoopArrangerParams["onLoopChange"]) {
  loopCount = loop;
  const bar   = (loop - 1) * loopBars;
  const parts = getState().parts;
  const activeParts = LAYERS.filter(p => parts[p] && isArrangedAt(p, bar));
  console.log(`周回 ${loop} / アクティブパート: ${activeParts.join(", ")}`);
  onLoopChange?.(loop, activeParts);
}

// 再生開始時の周回をすぐ知らせ、以降は周回の頭ごとに知らせる
export function startLoopArranger(params: LoopArrangerParams) {
  const { loopBars, fromBar, onLoopChange } = params;
  const firstLoop = Math.floor(fromBar / loopBars) + 1;
  notifyLoop(firstLoop, loopBars, onLoopChange);

  // 周回は発音時刻の小節から求める（ループ再生で曲の先頭に戻ったときも 1 周目から数え直す）
  const transport = Tone.getTransport();
  repeatId = transport.scheduleRepeat(time => {
    const bar  = Math.floor(transport.getTicksAtTime(time) / (transport.PPQ * 4) + 1e-6);
    const next = Math.floor(bar / loopBars) + 1;
    Tone.getDraw().schedule(() => notifyLoop(next, loopBars, onLoopChange), time);
  }, `${loopBars}m`, 0);  // 0 から刻む（途中から再生しても、ループで戻った先頭の周回を知らせる）
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
