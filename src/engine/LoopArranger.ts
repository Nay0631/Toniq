import * as Tone from "tone";
import { getState, ArrangeBlock, Arrangement, Section } from "./AppState";
import type { LayerName } from "./LayerManager";

export const LAYERS: LayerName[] = ["drum", "chord", "bass", "arp", "pad", "signature", "melody", "fx"];

// ジャンルごとの標準の構成。曲を8小節（SECTION_BARS）ずつのセクションに分け、A → A → サビ → A の順に並べる。
// 標準アレンジ（AppState.arrangement が null のとき）はこれを小節ごとに展開して作る。
// コード進行が4小節なら1セクション = 2周、2小節なら4周、8小節なら1周。セクションは周回の単位で切り替える。
// section: そのセクションの種類（A = Aメロ、B = サビ。サビの進行・メロディで鳴らす。AppState.sections が null のときの標準）
// parts:   そのセクションで鳴らすパート（足すだけでなく、ブレイクで抜くセクションもある）
// add:     セクションの後半から足すパート（同じ A が続いても、セクションの中で展開させる）
// drop:    セクションの後半で抜くパート
// gap:     次がサビに変わる周回の最後の1小節だけ抜くパート（サビの直前に空白を作る。コード進行が2小節以上のとき）
// build:   セクションの最後の1小節だけ足すパート（ブレイクの終わりにドラムを戻してフィルで次へつなぐ。2小節以上のとき）
// 定義より長い曲は、2つ目以降の定義（A → サビ → A）をくり返す（ずっと全部のパートが鳴り続けないようにする）
interface SectionPlan {
  section: Section;
  parts:   LayerName[];
  add?:    LayerName[];
  drop?:   LayerName[];
  gap?:    LayerName[];
  build?:  LayerName[];
}

// 1セクションの長さの目安（小節）。コード進行はこれを割り切れる長さ（1・2・4・8 小節）か、その倍数にする
// （割り切れないと 1 セクションが 8 小節からずれる。自動チェックの「コード進行DB」で確かめられる）
export const SECTION_BARS = 8;

const LOOP_SCHEDULE: Record<string, SectionPlan[]> = {
  // EDM：イントロ → ブレイク（ドラム・ベースを抜いてメロディを聴かせる）→ ドロップ（サビ）→ A に戻って薄くしていく
  "EDM": [
    { section: "A", parts: ["drum", "chord", "bass"], add: ["arp"] },
    { section: "A", parts: ["chord", "pad", "melody"], add: ["arp", "fx"], build: ["drum"] },
    { section: "B", parts: ["drum", "chord", "bass", "arp", "pad", "signature", "melody", "fx"] },
    { section: "A", parts: ["drum", "chord", "bass", "pad", "arp", "melody"], drop: ["pad", "arp"] },
  ],
  // 8bit：サビでアルペジオをシグネチャー（高速アルペジオ）に持ち替える
  "8bit": [
    { section: "A", parts: ["drum", "chord"], add: ["melody"] },
    { section: "A", parts: ["drum", "chord", "melody", "bass"], add: ["arp"], gap: ["bass"] },
    { section: "B", parts: ["drum", "chord", "melody", "bass", "signature", "fx"] },
    { section: "A", parts: ["drum", "chord", "melody", "bass", "arp"] },
  ],
  // ローファイ：ドラムなしのイントロから後半でドラムが入る。サビはパッドをアルペジオに替える。最後はドラムを抜いて終わる
  "ローファイ": [
    { section: "A", parts: ["chord", "pad", "signature"], add: ["drum"] },
    { section: "A", parts: ["drum", "chord", "pad", "bass", "melody", "signature"], gap: ["drum"] },
    { section: "B", parts: ["drum", "chord", "bass", "melody", "arp", "signature"], add: ["pad"] },
    { section: "A", parts: ["drum", "chord", "pad", "bass", "melody", "signature"], drop: ["drum"] },
  ],
  "ゲームBGM": [
    { section: "A", parts: ["drum", "chord", "bass"], add: ["pad"] },
    { section: "A", parts: ["drum", "chord", "bass", "pad", "melody"], gap: ["drum"] },
    { section: "B", parts: ["drum", "chord", "bass", "pad", "melody", "arp", "signature", "fx"] },
    { section: "A", parts: ["drum", "chord", "bass", "pad", "melody"], add: ["arp"] },
  ],
  // テクノ：キックとベースから。サビの前半はキックを抜いたブレイクで、後半でキック・ベースが戻る
  "テクノ": [
    { section: "A", parts: ["drum", "bass"], add: ["signature"] },
    { section: "A", parts: ["drum", "bass", "signature", "fx"], add: ["arp"], gap: ["bass"] },
    { section: "B", parts: ["chord", "pad", "signature", "arp", "melody", "fx"], add: ["drum", "bass"] },
    { section: "A", parts: ["drum", "bass", "signature", "arp", "fx"], drop: ["arp"] },
  ],
  "ハウス": [
    { section: "A", parts: ["drum", "bass"], add: ["chord"] },
    { section: "A", parts: ["drum", "bass", "chord", "melody", "fx"], gap: ["bass"] },
    { section: "B", parts: ["drum", "bass", "chord", "pad", "melody", "signature", "fx"], add: ["arp"] },
    { section: "A", parts: ["drum", "bass", "chord", "pad", "melody"], drop: ["pad"] },
  ],
  // トランス：ビルドアップ → サビの前半はブレイクダウン（ドラム・ベースを抜いてパッドとメロディだけ）→ 後半のドロップで全部そろう
  "トランス": [
    { section: "A", parts: ["drum", "bass"], add: ["arp"] },
    { section: "A", parts: ["drum", "bass", "arp", "signature", "fx"], gap: ["bass"] },
    { section: "B", parts: ["pad", "chord", "signature", "melody", "fx"], add: ["drum", "bass", "arp"] },
    { section: "A", parts: ["drum", "bass", "arp", "chord", "melody", "signature"], drop: ["signature"] },
  ],
  // アンビエント：パッドとコードから始め、ドラムはサビの後半に薄く足す
  "アンビエント": [
    { section: "A", parts: ["pad", "chord"], add: ["signature"] },
    { section: "A", parts: ["pad", "chord", "melody", "signature"] },
    { section: "B", parts: ["pad", "chord", "melody", "bass", "arp", "signature"], add: ["drum"] },
    { section: "A", parts: ["pad", "chord", "melody", "signature", "arp"], drop: ["arp"] },
  ],
};

// 1セクションが何周か（コード進行の長さから。8小節の進行なら1周）
function loopsPerSection(loopBars: number): number {
  return Math.max(1, Math.round(SECTION_BARS / Math.max(loopBars, 1)));
}

// index 番目（0 始まり）のセクションの定義
function sectionPlan(genre: string, index: number): SectionPlan {
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  if (index < schedule.length) return schedule[index];
  // 定義より後ろのセクションは、2つ目以降の定義をくり返す
  const repeat = schedule.length - 1;
  return schedule[1 + ((index - 1) % repeat)];
}

// ジャンルの標準のセクション（周回ごと。loops 周回ぶん）
export function defaultSections(genre: string, loops: number, loopBars: number): Section[] {
  const per = loopsPerSection(loopBars);
  return Array.from({ length: loops }, (_, i) => sectionPlan(genre, Math.floor(i / per)).section);
}

// ===== アレンジ =====

export function emptyArrangement(): Arrangement {
  return { drum: [], chord: [], bass: [], arp: [], pad: [], signature: [], melody: [], fx: [] };
}

// ジャンルの標準アレンジ：小節ごとに LOOP_SCHEDULE のセクションの定義から鳴らすパートを決め、続いている小節は1つのブロックにまとめる。
// 次の周回がサビ（セクション B）に変わるときは、gap のパートをその周回の最後の1小節だけ抜く
// sections を渡すと、セクションの切り替わりはその並び（AppState.sections）で判断する
export function buildDefaultArrangement(
  genre: string, loopBars: number, totalBars: number, sections?: Section[] | null,
): Arrangement {
  const arrangement = emptyArrangement();
  const per        = loopsPerSection(loopBars);
  const sectionLen = per * loopBars;
  const defaults   = defaultSections(genre, Math.ceil(totalBars / loopBars) + 1, loopBars);
  const sectionOf  = (loop: number) => sections?.[loop] ?? defaults[loop];  // loop は 0 始まり

  for (let bar = 0; bar < totalBars; bar++) {
    const loop   = Math.floor(bar / loopBars);
    const index  = Math.floor(bar / sectionLen);
    const plan   = sectionPlan(genre, index);
    const inSec  = bar - index * sectionLen;
    const notEnd = loopBars >= 2 && bar < totalBars - 1;  // 曲の最後の小節では gap / build を使わない

    const active = new Set<LayerName>(plan.parts);
    if (sectionLen >= 2 && inSec >= sectionLen / 2) {
      for (const p of plan.add ?? [])  active.add(p);
      for (const p of plan.drop ?? []) active.delete(p);
    }
    if (notEnd && inSec === sectionLen - 1) for (const p of plan.build ?? []) active.add(p);
    const toChorus = sectionOf(loop) === "A" && sectionOf(loop + 1) === "B";
    if (notEnd && toChorus && (bar + 1) % loopBars === 0) for (const p of plan.gap ?? []) active.delete(p);

    for (const part of active) {
      const blocks = arrangement[part];
      const last   = blocks[blocks.length - 1];
      if (last && last.start + last.length === bar) last.length += 1;
      else blocks.push({ start: bar, length: 1 });
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
