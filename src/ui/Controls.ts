// シンセサイザー風の操作部品（つまみ＝ノブ／フェーダー）。
// 見た目と操作だけを受け持ち、値は隠した <input type="range"> に持たせる。
// 値を変えると range に input イベントを送るので、呼び出し側は今までどおり range の input イベントで AppState を更新する。
// AppState から range.value を書き換えたあとは syncControls() で見た目をそろえる。

type Kind = "knob" | "fader";

interface Control {
  input: HTMLInputElement;
  el:    HTMLElement;
  kind:  Kind;
  arc?:  SVGPathElement;
}

const controls: Control[] = [];

// ノブの回る角度（真上を 0 として左右に 135°ずつ）
const KNOB_SWEEP = 270;
// ノブ：上下にこのピクセル数ドラッグすると端から端まで動く（Shift で細かく）
const KNOB_DRAG_PX = 200;
const FINE = 4;

function bounds(input: HTMLInputElement): { min: number; max: number; step: number } {
  const min  = parseFloat(input.min  || "0");
  const max  = parseFloat(input.max  || "100");
  const step = parseFloat(input.step || "1") || 1;
  return { min, max, step };
}

function ratio(c: Control): number {
  const { min, max } = bounds(c.input);
  const v = parseFloat(c.input.value);
  return max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
}

function sync(c: Control): void {
  const p = ratio(c);
  c.el.style.setProperty("--p", p.toFixed(4));
  c.el.setAttribute("aria-valuenow", c.input.value);
  c.arc?.setAttribute("stroke-dasharray", `${(p * 100).toFixed(2)} 100`);
}

// 値を変えて input イベントを送る
function setValue(c: Control, value: number): void {
  const { min, max, step } = bounds(c.input);
  const snapped = Math.max(min, Math.min(max, Math.round((value - min) / step) * step + min));
  if (String(snapped) !== c.input.value) {
    c.input.value = String(snapped);
    c.input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  sync(c);
}

// キー操作・ホイールは両方の部品で共通
function bindCommon(c: Control): void {
  c.el.addEventListener("keydown", e => {
    const { min, max, step } = bounds(c.input);
    const v    = parseFloat(c.input.value);
    const page = Math.max(step, (max - min) / 10);
    const next: Record<string, number> = {
      ArrowUp: v + step, ArrowRight: v + step, ArrowDown: v - step, ArrowLeft: v - step,
      PageUp: v + page, PageDown: v - page, Home: min, End: max,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    setValue(c, next[e.key]);
  });

  c.el.addEventListener("wheel", e => {
    e.preventDefault();
    const { step } = bounds(c.input);
    setValue(c, parseFloat(c.input.value) + (e.deltaY < 0 ? step : -step));
  }, { passive: false });
}

function register(input: HTMLInputElement, el: HTMLElement, kind: Kind, label: string): Control {
  const { min, max } = bounds(input);
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", label);
  el.setAttribute("aria-valuemin", String(min));
  el.setAttribute("aria-valuemax", String(max));
  el.setAttribute("aria-orientation", "vertical");

  // 元の range は値の入れ物として残し、画面からは隠す
  input.hidden   = true;
  input.tabIndex = -1;
  input.insertAdjacentElement("afterend", el);

  const c: Control = { input, el, kind };
  controls.push(c);
  return c;
}

// 真上を 0°とした角度 deg、半径 r の点（viewBox 100×100 の中心から）
function point(deg: number, r: number): string {
  const rad = (deg * Math.PI) / 180;
  return `${(50 + r * Math.sin(rad)).toFixed(2)} ${(50 - r * Math.cos(rad)).toFixed(2)}`;
}

/** range をノブ（回すつまみ）にする。上下ドラッグ・ホイール・矢印キーで操作 */
export function attachKnob(input: HTMLInputElement, label: string, size: "sm" | "md" | "lg" = "md"): void {
  const half = KNOB_SWEEP / 2;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const deg = -half + (KNOB_SWEEP * i) / 10;
    return `<path class="knob-tick" d="M ${point(deg, 46)} L ${point(deg, 50)}"/>`;
  }).join("");
  const arc = `M ${point(-half, 40)} A 40 40 0 1 1 ${point(half, 40)}`;

  const el = document.createElement("div");
  el.className = `knob knob-${size}`;
  el.innerHTML = `
    <svg class="knob-ring" viewBox="0 0 100 100" aria-hidden="true">
      ${ticks}
      <path class="knob-track" d="${arc}" pathLength="100"/>
      <path class="knob-value" d="${arc}" pathLength="100"/>
    </svg>
    <div class="knob-cap"><span class="knob-pointer"></span></div>`;

  const c = register(input, el, "knob", label);
  c.arc = el.querySelector<SVGPathElement>(".knob-value")!;
  bindCommon(c);

  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
    const { min, max } = bounds(input);
    const startY = e.clientY;
    const startV = parseFloat(input.value);

    const move = (ev: PointerEvent) => {
      const px = KNOB_DRAG_PX * (ev.shiftKey ? FINE : 1);
      setValue(c, startV + ((startY - ev.clientY) / px) * (max - min));
    };
    const up = () => {
      el.classList.remove("is-dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });

  sync(c);
}

/** range を縦フェーダーにする。溝をクリックでその位置へ、つまみを上下ドラッグで操作 */
export function attachFader(input: HTMLInputElement, label: string): void {
  const el = document.createElement("div");
  el.className = "fader";
  el.innerHTML = `
    <span class="fader-slot"><span class="fader-fill"></span></span>
    <span class="fader-cap"></span>`;

  const c = register(input, el, "fader", label);
  bindCommon(c);

  // つまみの中心が動く範囲（溝の上端〜下端）での位置を値にする
  const valueAt = (clientY: number): number => {
    const { min, max } = bounds(input);
    const slot = el.querySelector(".fader-slot")!.getBoundingClientRect();
    const p = (slot.bottom - clientY) / slot.height;
    return min + Math.max(0, Math.min(1, p)) * (max - min);
  };

  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");

    // つまみを掴んだときは掴んだ位置からの相対移動、溝をクリックしたときはその位置へ飛ぶ
    const onCap  = (e.target as HTMLElement).closest(".fader-cap") !== null;
    const offset = onCap ? valueAt(e.clientY) - parseFloat(input.value) : 0;
    if (!onCap) setValue(c, valueAt(e.clientY));

    const move = (ev: PointerEvent) => setValue(c, valueAt(ev.clientY) - offset);
    const up = () => {
      el.classList.remove("is-dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });

  sync(c);
}

/** セレクトの右に ◀ ▶ ボタンを付け、前後の選択肢へ順に切り替えられるようにする（端では反対側へ回る）。
 *  切り替えると select に change イベントを送る */
export function attachStepper(select: HTMLSelectElement, label: string): void {
  const wrap = document.createElement("span");
  wrap.className = "stepper";
  wrap.innerHTML = `
    <button type="button" class="stepper-btn" data-step="-1" aria-label="前の${label}" title="前の${label}">◀</button>
    <button type="button" class="stepper-btn" data-step="1" aria-label="次の${label}" title="次の${label}">▶</button>`;
  select.insertAdjacentElement("afterend", wrap);

  wrap.addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-step]");
    const n   = select.options.length;
    if (!btn || n === 0) return;
    select.selectedIndex = (select.selectedIndex + parseInt(btn.dataset.step!) + n) % n;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** range.value を外から変えたあとに、ノブ・フェーダーの見た目をそろえる */
export function syncControls(): void {
  for (const c of controls) sync(c);
}
