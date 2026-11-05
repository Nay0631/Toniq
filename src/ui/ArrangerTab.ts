import { getState, setState, ArrangeBlock, Arrangement } from "../engine/AppState";
import { getArrangement, cloneArrangement, findBlock } from "../engine/LoopArranger";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import * as Playback from "../engine/Playback";
import { signatureLabel } from "../engine/SignaturePlayer";

// アレンジャーのレーン（上から表示する順）
const LANES: { name: LayerName; label: string }[] = [
  { name: "drum",   label: "ドラム" },
  { name: "bass",   label: "ベース" },
  { name: "chord",  label: "コード" },
  { name: "melody", label: "メロディ" },
  { name: "pad",    label: "パッド" },
  { name: "arp",    label: "アルペジオ" },
  { name: "signature", label: "シグネチャー" },
  { name: "fx",     label: "FX / SE" },
];

const $ = (id: string) => document.getElementById(id);

// ===== 表示 =====

function patternNo(id: string): string {
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
    case "bass": return { sub: "ルート追従", block: "ルート追従" };
    case "pad":  return { sub: "コード追従", block: "パッド" };
    case "arp":  return { sub: "8分音符",   block: "アルペジオ" };
    case "signature": {
      const label = signatureLabel(s.genre);
      return { sub: label, block: label };
    }
    case "fx":   return { sub: "ライザーSE", block: "ライザーSE" };
  }
}

// 小節番号の間引き（小節数が多いときは2小節・4小節おき）
function rulerStep(bars: number): number {
  return bars <= 8 ? 1 : bars <= 32 ? 2 : 4;
}

function blockStyle(b: ArrangeBlock, bars: number): string {
  const end = Math.min(b.start + b.length, bars);
  return `left:${(b.start / bars) * 100}%;width:${((end - b.start) / bars) * 100}%`;
}

export function renderArranger(): void {
  const root = $("c-arranger");
  const s = getState();
  if (!root || !s.chordPattern || drag) return;

  const bars        = s.bars;
  const arrangement = getArrangement();
  root.style.setProperty("--bars", String(bars));
  root.style.setProperty("--loop", String(s.chordPattern.length_bars));

  const step  = rulerStep(bars);
  const ticks = Array.from({ length: Math.ceil(bars / step) }, (_, i) => i * step)
    .map(bar => `<span style="left:${(bar / bars) * 100}%">${bar + 1}</span>`).join("");

  const lanes = LANES.map(({ name, label }) => {
    const on     = s.parts[name];
    const labels = laneLabels(name);
    const blocks = arrangement[name].filter(b => b.start < bars);
    const sub    = !on ? "OFF" : blocks.length === 0 ? "未配置" : labels.sub;
    const body   = blocks.length === 0
      ? `<div class="arr-empty">クリックして配置…</div>`
      : blocks.map(b => `
          <div class="arr-block arr-${name}" tabindex="0" data-start="${b.start}" style="${blockStyle(b, bars)}"
               title="${b.start + 1}〜${b.start + b.length}小節（ドラッグで移動・端で長さを変更・Delete で削除）">
            <span class="arr-handle arr-handle-left"></span>
            <span class="arr-block-label">${labels.block}</span>
            <button class="arr-del" aria-label="削除">×</button>
            <span class="arr-handle arr-handle-right"></span>
          </div>`).join("");
    return `
      <div class="arr-lane${on ? "" : " is-off"}">
        <div class="arr-head">
          <div>
            <div class="arr-name">${label}</div>
            <div class="arr-sub">${sub}</div>
          </div>
          <button class="pill${on ? " is-on" : ""}" data-arr-toggle="${name}" aria-pressed="${on}">${on ? "ON" : "OFF"}</button>
        </div>
        <div class="arr-track" data-part="${name}">${body}</div>
      </div>`;
  }).join("");

  const startLeft = `${(Math.min(s.startBar, bars - 1) / bars) * 100}%`;
  root.innerHTML = `
    <div class="arr-ruler">
      <div class="arr-head arr-ruler-head">再生開始 <b>${Math.min(s.startBar, bars - 1) + 1}</b> 小節目</div>
      <div class="arr-ticks" title="クリックで再生開始位置を指定">${ticks}<span class="arr-start-marker" style="left:${startLeft}"></span></div>
    </div>
    ${lanes}
    <div class="arr-overlay">
      <div class="arr-start-line" style="left:${startLeft}"></div>
      <div class="arr-playhead" id="c-arr-playhead" hidden></div>
    </div>`;

  const edited = s.arrangement !== null;
  $("c-arr-mode")!.textContent = edited ? "編集済み" : `${s.genre} の標準アレンジ`;
  $("c-arr-mode")!.classList.toggle("is-edited", edited);
  ($("c-arr-reset") as HTMLButtonElement).disabled = !edited;
  renderPlayhead();
}

function renderPlayhead(): void {
  const playhead = $("c-arr-playhead");
  if (!playhead) return;
  const playing = Playback.isPlaying();
  playhead.hidden = !playing;
  if (playing) {
    const progress = Math.min(1, Playback.getPositionSeconds() / Playback.getSongSeconds());
    playhead.style.left = `${progress * 100}%`;
  }
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

// ===== 編集 =====

// 標準アレンジのままなら、ここで初めて AppState に書き込む（以降は編集済みとして扱う）
function editArrangement(fn: (a: Arrangement) => void): void {
  const next = cloneArrangement(getArrangement());
  fn(next);
  for (const { name } of LANES) next[name].sort((a, b) => a.start - b.start);
  setState({ arrangement: next });
}

// ブロックが動ける範囲（前後のブロックと曲の長さ）
function freeRange(blocks: ArrangeBlock[], target: ArrangeBlock | null, bar: number): { min: number; max: number } {
  const others = blocks.filter(b => b !== target);
  const min = Math.max(0, ...others.filter(b => b.start + b.length <= bar).map(b => b.start + b.length));
  const max = Math.min(getState().bars, ...others.filter(b => b.start > bar).map(b => b.start));
  return { min, max };
}

// 空いている所をクリック：その小節を含む周回（コード進行1周）ぶんのブロックを置く
function addBlock(part: LayerName, bar: number): void {
  const s = getState();
  const blocks = getArrangement()[part];
  if (!s.chordPattern || findBlock(blocks, bar)) return;

  const loopBars = s.chordPattern.length_bars;
  const { min, max } = freeRange(blocks, null, bar);
  const start = Math.max(min, Math.floor(bar / loopBars) * loopBars);
  const end   = Math.min(max, start + loopBars);
  editArrangement(a => a[part].push({ start, length: end - start }));

  // OFF のパートに置いたら ON にする
  if (!s.parts[part]) setLayerEnabled(part, true);
}

function removeBlock(part: LayerName, start: number): void {
  editArrangement(a => { a[part] = a[part].filter(b => b.start !== start); });
}

interface Drag {
  part:   LayerName;
  el:     HTMLElement;
  mode:   "move" | "left" | "right";
  x:      number;
  barPx:  number;
  orig:   ArrangeBlock;
  min:    number;
  max:    number;
  next:   ArrangeBlock;
}

let drag: Drag | null = null;

function startDrag(e: PointerEvent, part: LayerName, el: HTMLElement, track: HTMLElement): void {
  const s     = getState();
  const start = Number(el.dataset.start);
  const blocks = getArrangement()[part];
  const block  = blocks.find(b => b.start === start);
  if (!block) return;

  const target = e.target as HTMLElement;
  const mode = target.classList.contains("arr-handle-left")  ? "left"
             : target.classList.contains("arr-handle-right") ? "right"
             : "move";
  const { min, max } = freeRange(blocks, block, block.start);
  drag = {
    part, el, mode,
    x:     e.clientX,
    barPx: track.getBoundingClientRect().width / s.bars,
    orig:  { ...block },
    min, max,
    next:  { ...block },
  };
  el.classList.add("is-dragging");
  el.setPointerCapture(e.pointerId);
}

function moveDrag(e: PointerEvent): void {
  if (!drag) return;
  const { orig, min, max } = drag;
  const d   = Math.round((e.clientX - drag.x) / drag.barPx);
  const end = orig.start + orig.length;

  if (drag.mode === "move") {
    const start = Math.max(min, Math.min(orig.start + d, max - orig.length));
    drag.next = { start, length: orig.length };
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
  if (next.start !== orig.start || next.length !== orig.length) {
    editArrangement(a => {
      const block = a[part].find(b => b.start === orig.start);
      if (block) Object.assign(block, next);
    });
  }
  renderArranger();
}

// onSeek：再生開始位置を変えたときに呼ぶ（再生中ならその位置から再生し直す）
export function initArranger(onSeek: () => void): void {
  const root = $("c-arranger");
  if (!root) return;

  root.addEventListener("pointerdown", e => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest(".arr-del, [data-arr-toggle]")) return;

    // 小節番号の目盛りをクリック：その小節を再生開始位置にする
    const ticks = target.closest<HTMLElement>(".arr-ticks");
    if (ticks) {
      const rect = ticks.getBoundingClientRect();
      const bars = getState().bars;
      const bar  = Math.floor(((e.clientX - rect.left) / rect.width) * bars);
      setState({ startBar: Math.max(0, Math.min(bar, bars - 1)) });
      onSeek();
      return;
    }

    const track = target.closest<HTMLElement>(".arr-track");
    if (!track) return;
    const part  = track.dataset.part as LayerName;
    const block = target.closest<HTMLElement>(".arr-block");

    if (block) {
      startDrag(e, part, block, track);
    } else {
      const rect = track.getBoundingClientRect();
      const bar  = Math.floor(((e.clientX - rect.left) / rect.width) * getState().bars);
      addBlock(part, bar);
      renderArranger();
    }
  });
  root.addEventListener("pointermove", moveDrag);
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  root.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLElement>("[data-arr-toggle]");
    if (toggle) {
      const part = toggle.dataset.arrToggle as LayerName;
      setLayerEnabled(part, !getState().parts[part]);
      renderArranger();
      return;
    }
    const del = target.closest(".arr-del");
    if (del) {
      const block = del.closest<HTMLElement>(".arr-block")!;
      const part  = block.closest<HTMLElement>(".arr-track")!.dataset.part as LayerName;
      removeBlock(part, Number(block.dataset.start));
      renderArranger();
    }
  });

  // フォーカス中のブロックは Delete / Backspace で削除
  root.addEventListener("keydown", e => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const block = (e.target as HTMLElement).closest<HTMLElement>(".arr-block");
    if (!block) return;
    const part = block.closest<HTMLElement>(".arr-track")!.dataset.part as LayerName;
    removeBlock(part, Number(block.dataset.start));
    renderArranger();
  });

  $("c-arr-to-start")?.addEventListener("click", () => {
    setState({ startBar: 0 });
    onSeek();
  });

  $("c-arr-reset")?.addEventListener("click", () => {
    setState({ arrangement: null });
    renderArranger();
  });
}
