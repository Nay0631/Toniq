import { getState, setState, ArrangeBlock, ArrangePreset, FxType } from "../engine/AppState";
import {
  getArrangement, currentUnits, currentEditsWithPartBlocks, findBlock, withEdit, ARRANGE_PRESETS, arrangePresetLabel,
  type ArrangeUnit,
} from "../engine/LoopArranger";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import * as Playback from "../engine/Playback";
import { signatureLabel } from "../engine/SignaturePlayer";
import { fxLabel, FX_OPTIONS } from "../engine/FxPlayer";
import { percLabel } from "../engine/PercPlayer";
import { bassSubOn } from "../engine/BassPlayer";
import drumDB from "../data/drum_patterns.json";
import { CUSTOM_DRUM_ID, DrumPattern } from "../data/types";
import { render } from "./Router";
import { formatTimePrecise } from "./format";
import { chorusProgression, getSections, loopBars } from "../engine/SongForm";

// アレンジャー：構成のプリセット（AppState.arrangePreset）を選び、ブロックをドラッグで動かす・端で長さを変える・× で消す。
// 結果はセクション（8小節）ごとのプリセットとの差として「何回目の Aメロ／サビ のどのパートか」で AppState.arrangeEdits に持つので、
// ジャンル・小節数・コード進行の長さを変えても、プリセットを組み直したうえで当て直される（LoopArranger.ts）

// アレンジャーのレーン（上から表示する順）
const LANES: { name: LayerName; label: string }[] = [
  { name: "drum",   label: "ドラム" },
  { name: "perc",   label: "パーカッション" },
  { name: "bass",   label: "ベース" },
  { name: "chord",  label: "コード" },
  { name: "melody", label: "メロディ" },
  { name: "counter", label: "カウンター" },
  { name: "pad",    label: "パッド" },
  { name: "arp",    label: "アルペジオ" },
  { name: "signature", label: "シグネチャー" },
  { name: "fx",     label: "FX / SE" },
];

const $ = (id: string) => document.getElementById(id);

const DRUM_PATTERNS = drumDB as unknown as DrumPattern[];

// ブロックのラベルの位置に置くセレクト（FX の種類・ドラムのパターン）
const BLOCK_SELECT = ".arr-block-select";

// ===== 表示 =====

function patternNo(id: string): string {
  if (id === CUSTOM_DRUM_ID) return "オリジナル";
  return `#${id.replace(/\D/g, "")}`;
}

// レーン見出しの2行目とブロックに書く内容
function laneLabels(part: LayerName): { sub: string; block: string } {
  const s = getState();
  switch (part) {
    case "drum": {
      const no = s.drumPattern ? patternNo(s.drumPattern.id) : "";
      return { sub: no, block: `パターン ${no}` };
    }
    case "chord": {
      const no = s.chordPattern ? patternNo(s.chordPattern.id) : "";
      return { sub: `進行 ${no}`, block: `進行 ${no}` };
    }
    case "melody": {
      if (s.melodyMethod === "manual") return { sub: "ピアノロール", block: "ピアノロール" };
      if (s.melodyNotes.length === 0) return { sub: "未作成", block: "未作成" };
      const phrase = `フレーズ${String.fromCharCode(65 + (s.melodyVersion % 26))}`;
      return { sub: phrase, block: phrase };
    }
    case "bass": return { sub: bassSubOn() ? "ルート追従＋サブ" : "ルート追従", block: "ルート追従" };
    case "counter": return { sub: "ハモり／合いの手", block: "カウンター" };
    case "perc": {
      const label = percLabel(s.genre);
      return { sub: label, block: label };
    }
    case "pad":  return { sub: "コード追従", block: "パッド" };
    case "arp":  return { sub: "8分音符",   block: "アルペジオ" };
    case "signature": {
      const label = signatureLabel(s.genre);
      return { sub: label, block: label };
    }
    case "fx": {
      const label = fxLabel();
      return { sub: label, block: label };
    }
  }
}

// 小節番号の間引き（小節数が多いときは2小節・4小節おき）
function rulerStep(bars: number): number {
  return bars <= 8 ? 1 : bars <= 32 ? 2 : 4;
}

// FX のブロックの種類選び（"" = 曲の設定。設定タブの「FX / SE」の種類）
function fxSelect(b: ArrangeBlock): string {
  const current = b.fx && b.fx !== "auto" ? b.fx : "";
  const options = [
    { value: "", label: `標準（${fxLabel()}）` },
    ...FX_OPTIONS,
  ].map(o => option(o.value, o.label, current)).join("");
  return `<select class="arr-block-label arr-block-select" data-select="fx" aria-label="このセクションの FX の種類" title="このセクションで鳴らす FX の種類">${options}</select>`;
}

function option(value: string, label: string, current: string): string {
  return `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
}

// ドラムのブロックのパターン選び（"" = 曲の設定。設定タブのドラムパターン）。今のジャンルのパターンを先に並べる
function drumSelect(b: ArrangeBlock): string {
  const s = getState();
  const current = b.drum ?? "";
  const label = (d: DrumPattern) => `${patternNo(d.id)} ${d.name}`;
  const group = (title: string, items: DrumPattern[]) => items.length === 0 ? ""
    : `<optgroup label="${title}">${items.map(d => option(d.id, label(d), current)).join("")}</optgroup>`;
  const inGenre = DRUM_PATTERNS.filter(d => d.genre.includes(s.genre));
  const others  = DRUM_PATTERNS.filter(d => !d.genre.includes(s.genre));
  const base    = s.drumPattern ? `標準（${patternNo(s.drumPattern.id)}）` : "標準";
  const options = option("", base, current) + group(s.genre, inGenre) + group("ほかのジャンル", others);
  return `<select class="arr-block-label arr-block-select" data-select="drum" aria-label="このセクションのドラムパターン" title="このセクションで鳴らすドラムパターン">${options}</select>`;
}

function blockLabel(part: LayerName, b: ArrangeBlock, label: string): string {
  if (part === "fx")   return fxSelect(b);
  if (part === "drum") return drumSelect(b);
  return `<span class="arr-block-label">${label}</span>`;
}

// セクション（Aメロ／サビ）の行：周回ごとのボタン。クリックで切り替える
function sectionLane(bars: number): string {
  const L = loopBars();
  const chorus = chorusProgression();
  const cells = getSections().map((section, i) => {
    const start = i * L;
    if (start >= bars) return "";
    const length = Math.min(L, bars - start);
    return `<button class="arr-section is-${section}" data-section-loop="${i}" style="${blockStyle({ start, length }, bars)}"
              title="${start + 1}〜${start + length}小節（クリックで Aメロ／サビ を切り替え）">${section === "B" ? "サビ" : "Aメロ"}</button>`;
  }).join("");
  const sub = chorus ? `サビ 進行 ${patternNo(chorus.id)}` : "サビも同じ進行";
  return `
    <div class="arr-lane arr-section-lane">
      <div class="arr-head">
        <div>
          <div class="arr-name" data-term="section">セクション</div>
          <div class="arr-sub">${sub}</div>
        </div>
      </div>
      <div class="arr-sections">${cells}</div>
    </div>`;
}

function blockStyle(b: { start: number; length: number }, bars: number): string {
  const end = Math.min(b.start + b.length, bars);
  return `left:${(b.start / bars) * 100}%;width:${((end - b.start) / bars) * 100}%`;
}

// 構成のプリセットのセレクト
function renderPresetSelect(): void {
  const select = $("c-arr-preset") as HTMLSelectElement | null;
  if (!select) return;
  if (select.options.length !== ARRANGE_PRESETS.length) {
    select.innerHTML = ARRANGE_PRESETS
      .map(p => `<option value="${p.id}" data-term="arrangePreset.${p.id}" title="${p.desc}">${p.label}</option>`).join("");
  }
  select.value = getState().arrangePreset;
}

export function renderArranger(): void {
  const root = $("c-arranger");
  const s = getState();
  if (!root || !s.chordPattern || drag) return;
  // ブロックの種類・パターンを選んでいる途中に描き直すとドロップダウンが閉じるので待つ（選び終えると blur して描き直す）
  if (document.activeElement?.closest(BLOCK_SELECT)) return;
  const bars        = s.bars;
  const arrangement = getArrangement();
  const units       = currentUnits();
  root.style.setProperty("--bars", String(bars));
  root.style.setProperty("--loop", String(s.chordPattern.length_bars));

  const step  = rulerStep(bars);
  const ticks = Array.from({ length: Math.ceil(bars / step) }, (_, i) => i * step)
    .map(bar => `<span style="left:${(bar / bars) * 100}%">${bar + 1}</span>`).join("");

  const lanes = LANES.map(({ name, label }) => {
    const on     = s.parts[name];
    const labels = laneLabels(name);
    const blocks = arrangement[name].filter(b => b.start < bars);
    const sub    = !on ? "OFF" : blocks.length === 0 ? "鳴らさない" : labels.sub;
    const body   = blocks.length === 0
      ? `<div class="arr-empty">クリックして配置…</div>`
      : blocks.map(b => `
          <div class="arr-block arr-${name}" tabindex="0" data-start="${b.start}" style="${blockStyle(b, bars)}"
               title="${b.start + 1}〜${b.start + b.length}小節（ドラッグで移動・端で長さを変更・× ／右クリック／Delete で削除）">
            <span class="arr-handle arr-handle-left"></span>
            ${blockLabel(name, b, labels.block)}
            <button class="arr-del" aria-label="削除" title="このブロックを消す">×</button>
            <span class="arr-handle arr-handle-right"></span>
          </div>`).join("");
    return `
      <div class="arr-lane${on ? "" : " is-off"}">
        <div class="arr-head">
          <div>
            <div class="arr-name" data-term="${name}">${label}</div>
            <div class="arr-sub">${sub}</div>
          </div>
          <button class="pill${on ? " is-on" : ""}" data-arr-toggle="${name}" aria-pressed="${on}">${on ? "ON" : "OFF"}</button>
        </div>
        <div class="arr-track" data-part="${name}">${body}</div>
      </div>`;
  }).join("");

  // セクションの区切り線（アレンジを変える単位）
  const unitLines = units.slice(1)
    .map(u => `<div class="arr-unit-line" style="left:${(u.start / bars) * 100}%"></div>`).join("");
  const startLeft = `${(Math.min(s.startBar, bars - 1) / bars) * 100}%`;
  root.innerHTML = `
    <div class="arr-ruler">
      <div class="arr-head arr-ruler-head">再生開始 <b>${Math.min(s.startBar, bars - 1) + 1}</b> 小節目</div>
      <div class="arr-ticks" title="クリックで再生開始位置を指定">${ticks}<span class="arr-start-marker" style="left:${startLeft}"></span></div>
    </div>
    ${sectionLane(bars)}
    ${lanes}
    <div class="arr-overlay">
      ${unitLines}
      <div class="arr-start-line" style="left:${startLeft}"></div>
      <div class="arr-playhead" id="c-arr-playhead" hidden></div>
    </div>`;

  // 今の構成：プリセットと、変えた所の数
  const edits = s.arrangeEdits.length;
  const changed = edits > 0 || s.sections !== null;
  const notes = [edits > 0 ? `変更 ${edits}か所` : "", s.sections !== null ? "セクションを変更" : ""].filter(Boolean);
  $("c-arr-mode")!.textContent = notes.length > 0
    ? `${arrangePresetLabel(s.arrangePreset)} ＋ ${notes.join("・")}`
    : `${s.genre} の${arrangePresetLabel(s.arrangePreset)}の構成`;
  $("c-arr-mode")!.classList.toggle("is-edited", changed);
  ($("c-arr-reset") as HTMLButtonElement).disabled = !changed;
  renderPresetSelect();
  renderPlayhead();
  // ほかの画面（シンプルモードなど）で始めた再生でも、表示したら再生位置の線を動かす
  if (Playback.isPlaying()) startArrangerPlayhead();
}

function renderPlayhead(): void {
  const playing = Playback.isPlaying();
  const total = Playback.getSongSeconds();
  const playhead = $("c-arr-playhead");
  if (playhead) {
    playhead.hidden = !playing;
    if (playing) {
      const progress = Math.min(1, Playback.getPositionSeconds() / total);
      playhead.style.left = `${progress * 100}%`;
    }
  }
  renderTime(playing, total);
}

// 再生位置の時間（再生中は今の位置、停止中は再生開始位置）と曲全体の長さ
function renderTime(playing: boolean, total: number): void {
  const time = $("c-arr-time");
  if (!time) return;
  const s = getState();
  const startSec = (Math.min(s.startBar, s.bars - 1) * 4 * 60) / s.bpm;
  const sec = playing ? Math.min(total, Playback.getPositionSeconds()) : startSec;
  const text = `${formatTimePrecise(sec)} / ${formatTimePrecise(total)}`;
  if (time.textContent !== text) time.textContent = text;
  time.classList.toggle("is-playing", playing);
}

let rafId: number | null = null;

// 再生中は再生位置の線を動かす
export function startArrangerPlayhead(): void {
  if (rafId !== null) return;
  const tick = () => {
    renderPlayhead();
    rafId = Playback.isPlaying() ? requestAnimationFrame(tick) : null;
  };
  rafId = requestAnimationFrame(tick);
}

// ===== 編集（ブロックを置く・動かす・長さを変える・消す） =====
// 編集の結果は「パートのブロックの並び」として LoopArranger の currentEditsWithPartBlocks に渡し、
// セクションごとのプリセットとの差（変えた所）に直して保存する。隣のブロックとは結合しない（切れ目も変えた所に持つ）

// ブロック（orig）を next の位置・長さに変える。next = null なら消す。新しい所に置くときは orig = null
function changeBlock(
  part: LayerName, orig: { start: number; length: number } | null, next: { start: number; length: number } | null,
): void {
  const blocks: { start: number; length: number }[] = getArrangement()[part]
    .filter(b => b.start !== orig?.start)
    .map(b => ({ start: b.start, length: b.length }));
  if (next) blocks.push(next);
  setState({ arrangeEdits: currentEditsWithPartBlocks(part, blocks) });
}

// ブロックが動ける範囲（前後のブロックと曲の長さ）
function freeRange(blocks: ArrangeBlock[], target: ArrangeBlock | null, bar: number): { min: number; max: number } {
  const others = blocks.filter(b => b !== target);
  const min = Math.max(0, ...others.filter(b => b.start + b.length <= bar).map(b => b.start + b.length));
  const max = Math.min(getState().bars, ...others.filter(b => b.start > bar).map(b => b.start));
  return { min, max };
}

function unitAtBar(bar: number): ArrangeUnit | undefined {
  return currentUnits().find(u => bar >= u.start && bar < u.start + u.length);
}

// 空いている所をクリック：その小節を含むセクションの空いている所にブロックを置く。OFF のパートは ON にする
function addBlock(part: LayerName, bar: number): void {
  const blocks = getArrangement()[part];
  const unit   = unitAtBar(bar);
  if (!unit || findBlock(blocks, bar)) return;
  const { min, max } = freeRange(blocks, null, bar);
  const start = Math.max(min, unit.start);
  const end   = Math.min(max, unit.start + unit.length);
  changeBlock(part, null, { start, length: end - start });
  if (!getState().parts[part]) setLayerEnabled(part, true);
}

function removeBlock(part: LayerName, start: number): void {
  const block = getArrangement()[part].find(b => b.start === start);
  if (block) changeBlock(part, block, null);
}

interface Drag {
  part:  LayerName;
  el:    HTMLElement;
  mode:  "move" | "left" | "right";
  x:     number;
  barPx: number;
  orig:  ArrangeBlock;
  min:   number;
  max:   number;
  next:  { start: number; length: number };
}

// ドラッグ中のブロック（ドラッグ中は描き直さない。離したときに保存して描き直す）
let drag: Drag | null = null;

function startDrag(e: PointerEvent, part: LayerName, el: HTMLElement, track: HTMLElement): void {
  const blocks = getArrangement()[part];
  const block  = blocks.find(b => b.start === Number(el.dataset.start));
  if (!block) return;
  const target = e.target as HTMLElement;
  const mode = target.classList.contains("arr-handle-left")  ? "left"
             : target.classList.contains("arr-handle-right") ? "right"
             : "move";
  const { min, max } = freeRange(blocks, block, block.start);
  drag = {
    part, el, mode, min, max,
    x:     e.clientX,
    barPx: track.getBoundingClientRect().width / getState().bars,
    orig:  { ...block },
    next:  { start: block.start, length: block.length },
  };
  el.classList.add("is-dragging");
  el.setPointerCapture(e.pointerId);
}

// 1小節単位で動かす。前後のブロックには重ならない
function moveDrag(e: PointerEvent): void {
  if (!drag) return;
  const { orig, min, max } = drag;
  const d   = Math.round((e.clientX - drag.x) / drag.barPx);
  const end = orig.start + orig.length;
  if (drag.mode === "move") {
    drag.next = { start: Math.max(min, Math.min(orig.start + d, max - orig.length)), length: orig.length };
  } else if (drag.mode === "left") {
    const start = Math.max(min, Math.min(orig.start + d, end - 1));
    drag.next = { start, length: end - start };
  } else {
    const newEnd = Math.max(orig.start + 1, Math.min(end + d, max));
    drag.next = { start: orig.start, length: newEnd - orig.start };
  }
  drag.el.setAttribute("style", blockStyle(drag.next, getState().bars));
}

function endDrag(): void {
  if (!drag) return;
  const { part, orig, next } = drag;
  drag = null;
  if (next.start !== orig.start || next.length !== orig.length) changeBlock(part, orig, next);
  renderArranger();
}

// ブロックが重なっているセクション
function unitsOfBlock(start: number, part: LayerName): ArrangeUnit[] {
  const block = getArrangement()[part].find(b => b.start === start);
  if (!block) return [];
  return currentUnits().filter(u => u.start < block.start + block.length && block.start < u.start + u.length);
}

// トラックの上の位置（clientX）の小節
function barAt(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect();
  const bars = getState().bars;
  return Math.max(0, Math.min(bars - 1, Math.floor(((clientX - rect.left) / rect.width) * bars)));
}

// onSeek：再生開始位置を変えたときに呼ぶ（再生中ならその位置から再生し直す）
// onSongChange：セクション・構成のプリセットなど、読み込み直しが要る変更をしたときに呼ぶ（再生中なら再生し直す）
export function initArranger(onSeek: () => void, onSongChange: () => void): void {
  const root = $("c-arranger");
  if (!root) return;

  // トラック：ブロックをつかんでドラッグ（移動・端で長さを変える）、空いている所を押すとブロックを置く
  root.addEventListener("pointerdown", e => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest(`.arr-del, ${BLOCK_SELECT}`)) return;
    const track = target.closest<HTMLElement>(".arr-track");
    if (!track) return;
    const part  = track.dataset.part as LayerName;
    const block = target.closest<HTMLElement>(".arr-block");
    if (block) {
      startDrag(e, part, block, track);
    } else {
      addBlock(part, barAt(track, e.clientX));
      render();
    }
  });
  root.addEventListener("pointermove", moveDrag);
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  root.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    if (target.closest(BLOCK_SELECT)) return;

    // 小節番号の目盛りをクリック：その小節を再生開始位置にする
    const ticks = target.closest<HTMLElement>(".arr-ticks");
    if (ticks) {
      setState({ startBar: barAt(ticks, e.clientX) });
      onSeek();
      return;
    }
    // セクションの切り替え（コードとメロディの並びが変わるので、再生中なら再生し直す）
    const section = target.closest<HTMLElement>("[data-section-loop]");
    if (section) {
      const sections = getSections();
      const i = Number(section.dataset.sectionLoop);
      sections[i] = sections[i] === "B" ? "A" : "B";
      setState({ sections });
      onSongChange();
      return;
    }
    const toggle = target.closest<HTMLElement>("[data-arr-toggle]");
    if (toggle) {
      const part = toggle.dataset.arrToggle as LayerName;
      setLayerEnabled(part, !getState().parts[part]);
      render();  // 設定タブの ON/OFF ボタンなど、アレンジャー以外の表示もそろえる
      return;
    }
    // × ボタン：ブロックを消す（再生中もすぐ反映される）
    const del = target.closest(".arr-del");
    if (del) {
      const block = del.closest<HTMLElement>(".arr-block")!;
      removeBlock(block.closest<HTMLElement>(".arr-track")!.dataset.part as LayerName, Number(block.dataset.start));
      render();
    }
  });

  // ブロックを右クリック：消す（ピアノロールと同じ操作。ブラウザの右クリックメニューは出さない）
  root.addEventListener("contextmenu", e => {
    const block = (e.target as HTMLElement).closest<HTMLElement>(".arr-block");
    if (!block) return;
    e.preventDefault();
    if (drag) return;
    removeBlock(block.closest<HTMLElement>(".arr-track")!.dataset.part as LayerName, Number(block.dataset.start));
    render();
  });

  // FX のブロックの種類・ドラムのブロックのパターンを変える。ブロックが重なっているセクションの変えた所にする
  // （再生中も次に鳴らすところから反映される）
  root.addEventListener("change", e => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>(BLOCK_SELECT);
    if (!select) return;
    const start = Number(select.closest<HTMLElement>(".arr-block")!.dataset.start);
    const part  = select.dataset.select === "drum" ? "drum" : "fx";
    const value = select.value || undefined;
    let edits = getState().arrangeEdits;
    for (const unit of unitsOfBlock(start, part)) {
      edits = withEdit(edits, unit, part, part === "drum" ? { drum: value } : { fx: value as FxType | undefined });
    }
    setState({ arrangeEdits: edits });
    select.blur();
    renderArranger();
  });

  // フォーカス中のブロックは Delete / Backspace で消す（種類のセレクトを操作中は除く）
  root.addEventListener("keydown", e => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if ((e.target as HTMLElement).closest(BLOCK_SELECT)) return;
    const block = (e.target as HTMLElement).closest<HTMLElement>(".arr-block");
    if (!block) return;
    removeBlock(block.closest<HTMLElement>(".arr-track")!.dataset.part as LayerName, Number(block.dataset.start));
    render();
  });

  $("c-arr-to-start")?.addEventListener("click", () => {
    setState({ startBar: 0 });
    onSeek();
  });

  // 構成のプリセット：セクションの並び（短く繰り返す）も変わるので、再生中なら再生し直す。変えた所はそのまま当て直す
  ($("c-arr-preset") as HTMLSelectElement | null)?.addEventListener("change", e => {
    setState({ arrangePreset: (e.target as HTMLSelectElement).value as ArrangePreset });
    onSongChange();
  });

  // 変えた所を消す（構成のプリセットはそのまま）
  $("c-arr-reset")?.addEventListener("click", () => {
    const sectionsEdited = getState().sections !== null;
    setState({ arrangeEdits: [], sections: null });
    if (sectionsEdited) onSongChange();
    else render();
  });
}
