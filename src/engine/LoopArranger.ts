import * as Tone from "tone";
import { getState, ArrangeBlock, Arrangement, ArrangeEdit, ArrangePreset, FxType, Section } from "./AppState";
import type { LayerName } from "./LayerManager";

// すべてのパート（読み込み・破棄・アレンジの順）
export const LAYERS: LayerName[] = ["drum", "perc", "chord", "bass", "arp", "pad", "signature", "melody", "counter", "fx"];

// ジャンルごとの標準の構成。曲を8小節（SECTION_BARS）ずつのセクションに分け、A → A → サビ → A の順に並べる。
// アレンジ（getArrangement）はこれに構成のプリセット（ARRANGE_PRESETS）の変形を足し、小節ごとに展開して作る（変えた所 AppState.arrangeEdits はそのあとに当てる）。
// コード進行が4小節なら1セクション = 2周、2小節なら4周、8小節なら1周。セクションは周回の単位で切り替える。
// section: そのセクションの種類（A = Aメロ、B = サビ。サビの進行・メロディで鳴らす。AppState.sections が null・足りないときの標準）
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

// カウンターメロディ（counter）はサビではハモり、Aメロでは合いの手になるので、メロディのあるセクションに足す。
// パーカッション（perc）はサビを中心に、ドラムが鳴っている所に足す
const LOOP_SCHEDULE: Record<string, SectionPlan[]> = {
  // EDM：イントロ → ブレイク（ドラム・ベースを抜いてメロディを聴かせる）→ ドロップ（サビ）→ A に戻って薄くしていく
  "EDM": [
    { section: "A", parts: ["drum", "chord", "bass"], add: ["arp"] },
    { section: "A", parts: ["chord", "pad", "melody"], add: ["arp", "fx", "counter"], build: ["drum"] },
    { section: "B", parts: ["drum", "perc", "chord", "bass", "arp", "pad", "signature", "melody", "counter", "fx"] },
    { section: "A", parts: ["drum", "perc", "chord", "bass", "pad", "arp", "melody"], drop: ["pad", "arp", "perc"] },
  ],
  // 8bit：サビでアルペジオをシグネチャー（高速アルペジオ）に持ち替える
  "8bit": [
    { section: "A", parts: ["drum", "chord"], add: ["melody"] },
    { section: "A", parts: ["drum", "chord", "melody", "bass"], add: ["arp"], gap: ["bass"] },
    { section: "B", parts: ["drum", "perc", "chord", "melody", "counter", "bass", "signature", "fx"] },
    { section: "A", parts: ["drum", "chord", "melody", "bass", "arp"], add: ["perc"] },
  ],
  // ローファイ：ドラムなしのイントロから後半でドラムが入る。サビはパッドをアルペジオに替える。最後はドラムを抜いて終わる
  "ローファイ": [
    { section: "A", parts: ["chord", "pad", "signature"], add: ["drum"] },
    { section: "A", parts: ["drum", "perc", "chord", "pad", "bass", "melody", "signature"], gap: ["drum", "perc"] },
    { section: "B", parts: ["drum", "perc", "chord", "bass", "melody", "counter", "arp", "signature"], add: ["pad"] },
    { section: "A", parts: ["drum", "perc", "chord", "pad", "bass", "melody", "counter", "signature"], drop: ["drum", "perc"] },
  ],
  "ゲームBGM": [
    { section: "A", parts: ["drum", "chord", "bass"], add: ["pad"] },
    { section: "A", parts: ["drum", "chord", "bass", "pad", "melody"], add: ["counter"], gap: ["drum"] },
    { section: "B", parts: ["drum", "perc", "chord", "bass", "pad", "melody", "counter", "arp", "signature", "fx"] },
    { section: "A", parts: ["drum", "chord", "bass", "pad", "melody", "counter"], add: ["arp", "perc"] },
  ],
  // テクノ：キックとベースから。サビの前半はキックを抜いたブレイクで、後半でキック・ベースが戻る
  "テクノ": [
    { section: "A", parts: ["drum", "bass"], add: ["signature"] },
    { section: "A", parts: ["drum", "perc", "bass", "signature", "fx"], add: ["arp"], gap: ["bass"] },
    { section: "B", parts: ["chord", "pad", "signature", "arp", "melody", "counter", "fx"], add: ["drum", "perc", "bass"] },
    { section: "A", parts: ["drum", "perc", "bass", "signature", "arp", "fx"], drop: ["arp"] },
  ],
  "ハウス": [
    { section: "A", parts: ["drum", "bass"], add: ["chord", "perc"] },
    { section: "A", parts: ["drum", "perc", "bass", "chord", "melody", "fx"], add: ["counter"], gap: ["bass"] },
    { section: "B", parts: ["drum", "perc", "bass", "chord", "pad", "melody", "counter", "signature", "fx"], add: ["arp"] },
    { section: "A", parts: ["drum", "perc", "bass", "chord", "pad", "melody"], drop: ["pad"] },
  ],
  // トランス：ビルドアップ → サビの前半はブレイクダウン（ドラム・ベースを抜いてパッドとメロディだけ）→ 後半のドロップで全部そろう
  "トランス": [
    { section: "A", parts: ["drum", "bass"], add: ["arp"] },
    { section: "A", parts: ["drum", "perc", "bass", "arp", "signature", "fx"], gap: ["bass"] },
    { section: "B", parts: ["pad", "chord", "signature", "melody", "counter", "fx"], add: ["drum", "perc", "bass", "arp"] },
    { section: "A", parts: ["drum", "perc", "bass", "arp", "chord", "melody", "signature"], drop: ["signature"] },
  ],
  // アンビエント：パッドとコードから始め、ドラムはサビの後半に薄く足す
  "アンビエント": [
    { section: "A", parts: ["pad", "chord"], add: ["signature"] },
    { section: "A", parts: ["pad", "chord", "melody", "signature"], add: ["counter"] },
    { section: "B", parts: ["pad", "chord", "melody", "counter", "bass", "arp", "signature"], add: ["drum", "perc"] },
    { section: "A", parts: ["pad", "chord", "melody", "signature", "arp"], drop: ["arp"] },
  ],
};

// 1セクションが何周か（コード進行の長さから。8小節の進行なら1周）
function loopsPerSection(loopBars: number): number {
  return Math.max(1, Math.round(SECTION_BARS / Math.max(loopBars, 1)));
}

// ===== 構成のプリセット =====
// ジャンルの標準の構成（LOOP_SCHEDULE）に変形を足したもの。アレンジャーのタイムラインの上とシンプルモードの設定で選ぶ。
// どのプリセットもセクションの並び（Aメロ／サビ）は A → A → サビ → A のまま（短く繰り返すだけ A → サビ をくり返す）
export const ARRANGE_PRESETS: { id: ArrangePreset; label: string; desc: string }[] = [
  { id: "standard", label: "標準",                   desc: "ジャンルに合わせた構成" },
  { id: "quiet",    label: "静かに始まる",           desc: "コードとパッドだけで始まり、途中からほかのパートが入る" },
  { id: "drop",     label: "サビを強く",   desc: "サビの前でドラム・ベースを抜いてため、サビは全部のパートで鳴らす" },
  { id: "short",    label: "短く繰り返す", desc: "Aメロ1回ですぐサビに入り、A→サビ をくり返す" },
  { id: "buildup",  label: "だんだん盛り上がる",     desc: "少ないパートから始めて、セクションごとにパートを足していく" },
];

export function arrangePresetLabel(id: ArrangePreset): string {
  return ARRANGE_PRESETS.find(p => p.id === id)?.label ?? "標準";
}

// 盛り上がりの順（だんだん盛り上がる で足していく順）
const ENERGY_ORDER: LayerName[] = ["pad", "chord", "melody", "bass", "drum", "counter", "arp", "perc", "signature", "fx"];
const RHYTHM_PARTS: LayerName[] = ["drum", "perc", "bass"];

// ジャンルの標準の index 番目（0 始まり）のセクションの定義
function standardPlan(genre: string, index: number): SectionPlan {
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  if (index < schedule.length) return schedule[index];
  // 定義より後ろのセクションは、2つ目以降の定義をくり返す
  const repeat = schedule.length - 1;
  return schedule[1 + ((index - 1) % repeat)];
}

// プリセットを当てた index 番目のセクションの定義
function sectionPlan(genre: string, index: number, preset: ArrangePreset = "standard"): SectionPlan {
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  const base = standardPlan(genre, index);
  switch (preset) {
    case "quiet":
      // 最初のセクションはコード・パッドだけ。標準の最初のセクションのパートは後半から入る
      if (index !== 0) return base;
      return { section: base.section, parts: ["chord", "pad"], add: [...base.parts, ...(base.add ?? [])] };
    case "drop": {
      // サビは全部のパート。サビの直前のセクションは後半でドラム・ベースを抜いてため、最後の1小節でドラムを戻す（フィル）
      if (base.section === "B") return { section: "B", parts: [...LAYERS] };
      if (standardPlan(genre, index + 1).section !== "B") return base;
      return {
        ...base,
        add:   (base.add ?? []).filter(p => !RHYTHM_PARTS.includes(p)),
        drop:  [...(base.drop ?? []), ...RHYTHM_PARTS],
        gap:   [],
        build: ["drum"],
      };
    }
    case "short":
      // 2つ目の A（メロディのある A）とサビを交互にくり返す
      return index % 2 === 0 ? schedule[1] : schedule[2];
    case "buildup": {
      // サビで鳴るパートを盛り上がりの順に並べ、セクションごとに足していく（後半で次の段階のパートを先に足す）
      const chorus = schedule[2];
      const full   = ENERGY_ORDER.filter(p => chorus.parts.includes(p) || (chorus.add ?? []).includes(p));
      const tiers  = [full.slice(0, 2), full.slice(0, Math.ceil(full.length / 2)), full];
      const tier   = (i: number) => tiers[Math.min(i, tiers.length - 1)];
      return { section: base.section, parts: tier(index), add: tier(index + 1) };
    }
    default:
      return base;
  }
}

// ジャンル（とプリセット）の標準のセクション（周回ごと。loops 周回ぶん）
export function defaultSections(
  genre: string, loops: number, loopBars: number, preset: ArrangePreset = "standard",
): Section[] {
  const per = loopsPerSection(loopBars);
  return Array.from({ length: loops }, (_, i) => sectionPlan(genre, Math.floor(i / per), preset).section);
}

// ===== セクション（アレンジを変える単位） =====
// 曲を SECTION_BARS 小節（コード進行の周回の倍数）ずつに分けたもの。種類は最初の周回のセクション（Aメロ／サビ）で、
// 同じ種類を先頭から数えて何回目か（nth）を持つ。変えた所（ArrangeEdit）はこの「何回目の Aメロ／サビ」で記録する
export interface ArrangeUnit {
  index:   number;
  start:   number;  // 小節（0 始まり）
  length:  number;
  section: Section;
  nth:     number;
}

export function arrangeUnits(loopBars: number, totalBars: number, sectionOf: (loop: number) => Section): ArrangeUnit[] {
  const sectionLen = loopsPerSection(loopBars) * loopBars;
  const counts: Record<Section, number> = { A: 0, B: 0 };
  const units: ArrangeUnit[] = [];
  for (let start = 0, index = 0; start < totalBars; start += sectionLen, index++) {
    const section = sectionOf(Math.floor(start / loopBars));
    units.push({ index, start, length: Math.min(sectionLen, totalBars - start), section, nth: counts[section]++ });
  }
  return units;
}

// ===== アレンジ =====

export function emptyArrangement(): Arrangement {
  return { drum: [], perc: [], chord: [], bass: [], arp: [], pad: [], signature: [], melody: [], counter: [], fx: [] };
}

export interface BuildOptions {
  genre:     string;
  loopBars:  number;
  totalBars: number;
  sections?: Section[] | null;   // AppState.sections（null = プリセットの標準）
  preset?:   ArrangePreset;
  edits?:    ArrangeEdit[];
}

// 小節ごとに鳴らすパートと、ドラムのパターン・FX の種類（変えた所で決まるもの）
// splits：この小節で別のブロックを始めるパート（前の小節から続いていても結合しない）
interface BarState { active: Set<LayerName>; drum?: string; fx?: FxType; splits?: Set<LayerName> }

function buildBars(o: BuildOptions): { bars: BarState[]; units: ArrangeUnit[] } {
  const preset     = o.preset ?? "standard";
  const L          = o.loopBars;
  const sectionLen = loopsPerSection(L) * L;
  const defaults   = defaultSections(o.genre, Math.ceil(o.totalBars / L) + 1, L, preset);
  const sectionOf  = (loop: number) => o.sections?.[loop] ?? defaults[loop];  // loop は 0 始まり
  const bars: BarState[] = [];

  for (let bar = 0; bar < o.totalBars; bar++) {
    const loop   = Math.floor(bar / L);
    const index  = Math.floor(bar / sectionLen);
    const plan   = sectionPlan(o.genre, index, preset);
    const inSec  = bar - index * sectionLen;
    const notEnd = L >= 2 && bar < o.totalBars - 1;  // 曲の最後の小節では gap / build を使わない

    const active = new Set<LayerName>(plan.parts);
    if (sectionLen >= 2 && inSec >= sectionLen / 2) {
      for (const p of plan.add ?? [])  active.add(p);
      for (const p of plan.drop ?? []) active.delete(p);
    }
    if (notEnd && inSec === sectionLen - 1) for (const p of plan.build ?? []) active.add(p);
    const toChorus = sectionOf(loop) === "A" && sectionOf(loop + 1) === "B";
    if (notEnd && toChorus && (bar + 1) % L === 0) for (const p of plan.gap ?? []) active.delete(p);
    bars.push({ active });
  }

  // 変えた所を当てる（セクションの種類と何回目かで探す。曲が短くて当たるセクションがなければ使わない）
  const units = arrangeUnits(L, o.totalBars, sectionOf);
  for (const edit of o.edits ?? []) {
    const unit = units.find(u => u.section === edit.section && u.nth === edit.nth);
    if (!unit) continue;
    for (let bar = unit.start; bar < unit.start + unit.length; bar++) {
      const b = bars[bar];
      if (edit.on === true)  b.active.add(edit.part);
      if (edit.on === false) b.active.delete(edit.part);
      if (edit.bars) {
        if (edit.bars.includes(bar - unit.start)) b.active.add(edit.part);
        else b.active.delete(edit.part);
      }
      if (edit.splits?.includes(bar - unit.start)) (b.splits ??= new Set()).add(edit.part);
      if (edit.part === "drum" && edit.drum) b.drum = edit.drum;
      if (edit.part === "fx"   && edit.fx)   b.fx   = edit.fx;
    }
  }
  return { bars, units };
}

// アレンジを組み立てる：プリセットの定義から小節ごとに鳴らすパートを決め、変えた所を当て、
// 続いていて同じパターン・種類の小節は1つのブロックにまとめる。
// 次の周回がサビ（セクション B）に変わるときは、gap のパートをその周回の最後の1小節だけ抜く
export function buildArrangement(o: BuildOptions): Arrangement {
  const arrangement = emptyArrangement();
  buildBars(o).bars.forEach((b, bar) => {
    for (const part of LAYERS) {
      if (!b.active.has(part)) continue;
      const drum = part === "drum" ? b.drum : undefined;
      const fx   = part === "fx"   ? b.fx   : undefined;
      const blocks = arrangement[part];
      const last   = blocks[blocks.length - 1];
      if (last && last.start + last.length === bar && last.drum === drum && last.fx === fx && !b.splits?.has(part)) {
        last.length += 1;
      } else {
        const block: ArrangeBlock = { start: bar, length: 1 };
        if (drum) block.drum = drum;
        if (fx)   block.fx   = fx;
        blocks.push(block);
      }
    }
  });
  return arrangement;
}

// ジャンルの標準アレンジ（プリセット「標準」・変えた所なし）
export function buildDefaultArrangement(
  genre: string, loopBars: number, totalBars: number, sections?: Section[] | null,
): Arrangement {
  return buildArrangement({ genre, loopBars, totalBars, sections });
}

// 今の曲の組み立ての条件（withEdits = false なら変えた所を当てない）
function currentOptions(withEdits: boolean): BuildOptions | null {
  const s = getState();
  if (!s.chordPattern) return null;
  return {
    genre: s.genre, loopBars: s.chordPattern.length_bars, totalBars: s.bars, sections: s.sections,
    preset: s.arrangePreset, edits: withEdits ? s.arrangeEdits : [],
  };
}

// アレンジは再生中に何度も参照するので、条件が同じあいだは作り直さない（変えた所は配列ごと差し替えるので参照で比べる）
let arrangedCache: { key: string; edits: ArrangeEdit[]; arrangement: Arrangement } | null = null;

function cacheKey(): string {
  const s = getState();
  return `${s.genre}|${s.chordPattern?.length_bars}|${s.bars}|${s.sections?.join("") ?? ""}|${s.arrangePreset}`;
}

// 現在のアレンジ（構成のプリセットに変えた所を当てたもの）
export function getArrangement(): Arrangement {
  const o = currentOptions(true);
  if (!o) return emptyArrangement();
  const key = cacheKey();
  if (arrangedCache?.key !== key || arrangedCache.edits !== o.edits) {
    arrangedCache = { key, edits: o.edits!, arrangement: buildArrangement(o) };
  }
  return arrangedCache.arrangement;
}

// 今の曲のセクション（アレンジを変える単位）
export function currentUnits(): ArrangeUnit[] {
  const o = currentOptions(false);
  return o ? buildBars(o).units : [];
}

// セクションのパートの変えた所
export function findEdit(edits: ArrangeEdit[], unit: ArrangeUnit, part: LayerName): ArrangeEdit | undefined {
  return edits.find(e => e.section === unit.section && e.nth === unit.nth && e.part === part);
}

// セクションのパートの変えた所を書き換えた新しい配列を返す。
// patch の項目が undefined ならその項目を消し、何も残らなければ変えた所ごと消す（null も消す）
export function withEdit(
  edits: ArrangeEdit[], unit: ArrangeUnit, part: LayerName,
  patch: { on?: boolean; bars?: number[]; splits?: number[]; drum?: string; fx?: FxType } | null,
): ArrangeEdit[] {
  const rest = edits.filter(e => !(e.section === unit.section && e.nth === unit.nth && e.part === part));
  if (patch === null) return rest;
  const next: ArrangeEdit = { ...(findEdit(edits, unit, part) ?? { section: unit.section, nth: unit.nth, part }) };
  if ("on" in patch)     { if (patch.on === undefined) delete next.on;   else next.on = patch.on; }
  if ("bars" in patch)   { if (!patch.bars) delete next.bars; else next.bars = patch.bars; }
  if ("splits" in patch) { if (!patch.splits?.length) delete next.splits; else next.splits = patch.splits; }
  if ("drum" in patch)   { if (!patch.drum) delete next.drum; else next.drum = patch.drum; }
  if ("fx" in patch)     { if (!patch.fx || patch.fx === "auto") delete next.fx; else next.fx = patch.fx; }
  return next.on === undefined && !next.bars && !next.splits && !next.drum && !next.fx ? rest : [...rest, next];
}

// アレンジャーで並べたブロック（曲全体）を、プリセットとの差の変えた所に直す（ドラッグ・長さ変更・削除・配置）。
// セクションごとに比べ、鳴らす小節がプリセットと同じなら on / bars を消し、全部鳴らす／全部鳴らさないなら on、一部なら bars にする。
// 前のブロックと隙間なく続くブロックは、その頭を切れ目（splits）にして結合しない（ドラムのパターン・FX の種類が違って
// もともと分かれる所には付けない）。ドラムのパターン・FX の種類と、曲が短くて当たるセクションがない変えた所はそのまま残す
export function editsWithPartBlocks(
  o: BuildOptions, part: LayerName, blocks: { start: number; length: number }[],
): ArrangeEdit[] {
  const { bars: base, units } = buildBars({ ...o, edits: [] });
  const { bars: now } = buildBars(o);
  const playing = new Array<boolean>(o.totalBars).fill(false);
  const starts  = new Array<boolean>(o.totalBars).fill(false);
  for (const b of blocks) {
    if (b.start >= o.totalBars) continue;
    starts[b.start] = true;
    for (let bar = b.start; bar < Math.min(b.start + b.length, o.totalBars); bar++) playing[bar] = true;
  }
  // ドラムのパターン・FX の種類が前の小節と同じか（違えばもともと別のブロックになる）
  const sameKind = (bar: number) => now[bar].drum === now[bar - 1].drum && now[bar].fx === now[bar - 1].fx;
  let edits = o.edits ?? [];
  for (const unit of units) {
    const offsets = Array.from({ length: unit.length }, (_, i) => i);
    const want   = offsets.map(i => playing[unit.start + i]);
    const std    = offsets.map(i => base[unit.start + i].active.has(part));
    const splits = offsets.filter(i => {
      const bar = unit.start + i;
      return bar > 0 && starts[bar] && playing[bar - 1] && ((part !== "drum" && part !== "fx") || sameKind(bar));
    });
    let patch: { on?: boolean; bars?: number[]; splits?: number[] };
    if (want.every((w, i) => w === std[i])) patch = { on: undefined, bars: undefined };
    else if (want.every(w => w))             patch = { on: true, bars: undefined };
    else if (want.every(w => !w))            patch = { on: false, bars: undefined };
    else patch = { on: undefined, bars: offsets.filter(i => want[i]) };
    patch.splits = splits.length > 0 ? splits : undefined;
    edits = withEdit(edits, unit, part, patch);
  }
  return edits;
}

// 今の曲で、パートのブロックの並びを変える（editsWithPartBlocks を今の AppState で）
export function currentEditsWithPartBlocks(part: LayerName, blocks: { start: number; length: number }[]): ArrangeEdit[] {
  const o = currentOptions(true);
  return o ? editsWithPartBlocks(o, part, blocks) : getState().arrangeEdits;
}

// ===== 以前の形式（ブロックの並び）からの読み替え =====
// 以前はアレンジを編集すると、ブロックの並びそのもの（AppState.arrangement）を保存していた。
// 読み込むときに、ジャンルの標準とセクションごとに比べて「変えた所」に直す（小節単位の細かい違いは、
// セクションの半分以上で鳴っているかどうかにまとめる）
export function editsFromLegacy(
  legacy: Partial<Arrangement>, genre: string, loopBars: number, totalBars: number, sections?: Section[] | null,
): ArrangeEdit[] {
  const { bars: base, units } = buildBars({ genre, loopBars, totalBars, sections });
  const edits: ArrangeEdit[] = [];
  for (const unit of units) {
    for (const part of LAYERS) {
      const blocks = legacy[part] ?? [];
      let saved = 0, standard = 0;
      let drum: string | undefined;
      let fx: FxType | undefined;
      for (let bar = unit.start; bar < unit.start + unit.length; bar++) {
        const block = findBlock(blocks, bar);
        if (block) {
          saved++;
          drum ??= block.drum;
          fx   ??= block.fx && block.fx !== "auto" ? block.fx : undefined;
        }
        if (base[bar].active.has(part)) standard++;
      }
      const half = unit.length / 2;
      let on: boolean | undefined;
      if (saved === unit.length && standard < unit.length) on = true;
      else if (saved === 0 && standard > 0) on = false;
      else if (saved >= half && standard < half) on = true;
      else if (saved < half && standard >= half) on = false;
      const edit: ArrangeEdit = { section: unit.section, nth: unit.nth, part };
      if (on !== undefined) edit.on = on;
      if (part === "drum" && drum) edit.drum = drum;
      if (part === "fx" && fx) edit.fx = fx;
      if (edit.on !== undefined || edit.drum || edit.fx) edits.push(edit);
    }
  }
  return edits;
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
