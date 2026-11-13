import { getState, setState } from "../engine/AppState";
import {
  CUSTOM_DRUM_BARS, DRUM_ROLL_TRACKS, DRUM_TRACK_LABELS,
  customDrumPattern, drumPatternBars, isCustomDrum, previewDrumHit, withDrumHit,
} from "../engine/DrumEngine";
import * as Playback from "../engine/Playback";
import type { DrumPattern } from "../data/types";
import drumDB from "../data/drum_patterns.json";
import { render } from "./Router";

// ピアノロールのドラム：行 = ドラムのトラック（キック・スネアなど）、列 = 16分音符のマス。
// 編集すると AppState.drumPattern がオリジナルのパターン（id = CUSTOM_DRUM_ID）になり、曲と一緒に保存される

const DRUM_PATTERNS = drumDB as unknown as DrumPattern[];

// 置く音の強さ（AppState.drumRollVelocity）
const VELOCITIES: { value: number; label: string }[] = [
  { value: 1,    label: "強" },
  { value: 0.75, label: "中" },
  { value: 0.45, label: "弱" },
];

const ROWS = DRUM_ROLL_TRACKS.length;

const TRASH_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>
  </svg>`;

function q<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
  return root.querySelector<T>(selector)!;
}

function patternLabel(d: DrumPattern): string {
  return isCustomDrum(d) ? d.name : `#${d.id.replace(/\D/g, "")} ${d.name}`;
}

// ===== 表示 =====

// 枠組みは最初の1回だけ作る。target はメロディ／ドラムの切り替え（PianoRollTab と共通の HTML）
export function buildDrumRoll(pane: HTMLElement, target: string): void {
  pane.innerHTML = `
    <div class="pr-toolbar">
      ${target}
      <span class="pr-sep"></span>
      <span class="pr-label">長さ</span>
      <div class="pr-seg" role="group" aria-label="パターンの長さ">
        ${CUSTOM_DRUM_BARS.map(b => `<button data-dr-bars="${b}">${b}小節</button>`).join("")}
      </div>
      <span class="pr-sep"></span>
      <span class="pr-label">強さ</span>
      <div class="pr-seg" role="group" aria-label="置く音の強さ">
        ${VELOCITIES.map(v => `<button data-dr-vel="${v.value}">${v.label}</button>`).join("")}
      </div>
      <span class="pr-sep"></span>
      <select class="dr-load" data-dr-load aria-label="パターンを読み込む" title="ドラムパターンを読み込んで、そこから編集する"></select>
      <button class="btn btn-small" data-dr-clear>${TRASH_ICON}クリア</button>
      <span class="pr-hint">クリック：置く・消す／ドラッグ：まとめて／右クリック：消す／見出し：試聴</span>
    </div>
    <div class="pr-scroll dr-scroll">
      <div class="pr-ruler">
        <div class="pr-corner"></div>
        <div class="pr-ticks dr-ticks"></div>
      </div>
      <div class="pr-main">
        <div class="pr-keys"></div>
        <div class="pr-grid dr-grid"></div>
      </div>
    </div>
    <div class="pr-status">
      <span data-dr-status-pattern></span>
      <span class="pr-status-sep"></span>
      <span data-dr-status-note></span>
    </div>`;
}

export function renderDrumRoll(pane: HTMLElement): void {
  const s = getState();
  if (!s.drumPattern || paint) return;
  const pattern = s.drumPattern;
  const bars = drumPatternBars(pattern);
  pane.style.setProperty("--bars", String(bars));

  // ツールバー
  pane.querySelectorAll<HTMLElement>("[data-dr-bars]").forEach(btn =>
    btn.classList.toggle("is-active", Number(btn.dataset.drBars) === bars));
  pane.querySelectorAll<HTMLElement>("[data-dr-vel]").forEach(btn =>
    btn.classList.toggle("is-active", Number(btn.dataset.drVel) === s.drumRollVelocity));
  renderLoadSelect(q<HTMLSelectElement>(pane, "[data-dr-load]"));

  // 目盛り：小節番号と拍
  q(pane, ".dr-ticks").innerHTML = Array.from({ length: bars * 4 }, (_, beat) => {
    const left = `${(beat / (bars * 4)) * 100}%`;
    return beat % 4 === 0
      ? `<span class="pr-bar-no" style="left:${left}">${beat / 4 + 1}</span>`
      : `<span class="dr-beat-no" style="left:${left}">${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}</span>`;
  }).join("");

  // 行の見出し（クリックで試聴）
  q(pane, ".pr-keys").innerHTML = DRUM_ROLL_TRACKS.map(name =>
    `<div class="pr-key dr-key" data-track="${name}" title="クリックで試聴">${DRUM_TRACK_LABELS[name]}</div>`).join("");

  renderGrid(pane, pattern);

  // ステータスバー
  q(pane, "[data-dr-status-pattern]").textContent = isCustomDrum(pattern)
    ? `ドラム：オリジナル${pattern.notes ? `（${pattern.notes}）` : ""}`
    : `ドラム：${patternLabel(pattern)}（編集するとオリジナルのパターンになります）`;
  const overridden = s.arrangeEdits.some(e => e.part === "drum" && e.drum);
  q(pane, "[data-dr-status-note]").textContent = overridden
    ? "アレンジャーで別のパターンを選んだセクションでは、そちらが鳴ります"
    : `${bars}小節をくり返して鳴らします`;

  renderDrumPlayhead(pane);
}

function renderGrid(pane: HTMLElement, pattern: DrumPattern): void {
  const steps = pattern.steps;
  const pct = (n: number) => `${(n / steps) * 100}%`;
  const hits: string[] = [];
  DRUM_ROLL_TRACKS.forEach((name, row) => {
    const track = pattern.tracks[name];
    if (!track) return;
    for (let i = 0; i < steps; i++) {
      if (!track.pattern[i]) continue;
      const v = track.velocity?.[i] ?? 1;
      hits.push(`<div class="dr-hit" style="left:${pct(i)};width:${pct(1)};top:calc(${row} * var(--row-h));--vel:${v}"
                      title="${DRUM_TRACK_LABELS[name]}（${Math.floor(i / 16) + 1}小節 ${i % 16 + 1}マス目・強さ ${Math.round(v * 100)}）"></div>`);
    }
  });
  q(pane, ".dr-grid").innerHTML =
    DRUM_ROLL_TRACKS.map(() => `<div class="pr-row"></div>`).join("") +
    hits.join("") +
    `<div class="pr-playhead" hidden></div>`;
}

// 読み込むパターンの選択肢（今のジャンルのものを先に並べる）
function renderLoadSelect(select: HTMLSelectElement): void {
  const genre = getState().genre;
  const option = (d: DrumPattern) => `<option value="${d.id}">${patternLabel(d)}</option>`;
  const inGenre = DRUM_PATTERNS.filter(d => d.genre.includes(genre));
  const others  = DRUM_PATTERNS.filter(d => !d.genre.includes(genre));
  select.innerHTML = `<option value="">パターンを読み込む…</option>` +
    `<optgroup label="${genre}">${inGenre.map(option).join("")}</optgroup>` +
    `<optgroup label="ほかのジャンル">${others.map(option).join("")}</optgroup>`;
  select.value = "";
}

// 再生位置（パターンはくり返すので、パターンの中の位置を表示する）
export function renderDrumPlayhead(pane: HTMLElement): void {
  const pattern = getState().drumPattern;
  const playhead = pane.querySelector<HTMLElement>(".pr-playhead");
  if (!pattern || !playhead) return;
  const playing = Playback.isPlaying();
  playhead.hidden = !playing;
  if (playing) {
    const bars = drumPatternBars(pattern);
    playhead.style.left = `${((Playback.getPositionBars() % bars) / bars) * 100}%`;
  }
}

// ===== 編集 =====

// 編集した結果を曲に入れる（再生中のドラムは今の曲の設定のパターンを読むので、読み込み直さなくても反映される）
function commit(pattern: DrumPattern): void {
  setState({ drumPattern: pattern });
  render();
}

// 編集するパターン（DB のパターンなら、同じ長さのオリジナルにしてから編集する）
function editable(): DrumPattern | null {
  const p = getState().drumPattern;
  if (!p) return null;
  return isCustomDrum(p) ? p : customDrumPattern(p, drumPatternBars(p));
}

// ドラッグ中の塗り（add = 置く、erase = 消す）。離したときにまとめて1回だけ setState する（元に戻すも1回で戻る）
interface Paint {
  mode:    "add" | "erase";
  pattern: DrumPattern;
  last:    string;   // 最後に塗ったマス（"行:ステップ"）
  changed: boolean;  // 1マスでも変えたか（変えていなければ曲はそのまま。DB のパターンもオリジナルにしない）
}

let paint: Paint | null = null;

function cellAt(e: PointerEvent, grid: HTMLElement, steps: number): { row: number; step: number } | null {
  const rect = grid.getBoundingClientRect();
  const row  = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
  const step = Math.floor(((e.clientX - rect.left) / rect.width) * steps);
  if (row < 0 || row >= ROWS || step < 0 || step >= steps) return null;
  return { row, step };
}

function paintCell(pane: HTMLElement, row: number, step: number): void {
  if (!paint) return;
  const key = `${row}:${step}`;
  if (key === paint.last) return;
  paint.last = key;
  const name = DRUM_ROLL_TRACKS[row];
  const on   = !!paint.pattern.tracks[name]?.pattern[step];
  if (paint.mode === "add" && !on) {
    const velocity = getState().drumRollVelocity;
    paint.pattern = withDrumHit(paint.pattern, name, step, velocity);
    void previewDrumHit(name, velocity);
  } else if (paint.mode === "erase" && on) {
    paint.pattern = withDrumHit(paint.pattern, name, step, 0);
  } else {
    return;
  }
  paint.changed = true;
  renderGrid(pane, paint.pattern);
  renderDrumPlayhead(pane);
}

function endPaint(): void {
  if (!paint) return;
  const { pattern, changed } = paint;
  paint = null;
  if (changed) commit(pattern);
}

export function initDrumRoll(pane: HTMLElement): void {
  pane.querySelectorAll<HTMLElement>("[data-dr-bars]").forEach(btn =>
    btn.addEventListener("click", () => {
      const p = getState().drumPattern;
      const bars = Number(btn.dataset.drBars);
      if (!p || bars === drumPatternBars(p)) return;
      commit(customDrumPattern(p, bars));
    }));
  pane.querySelectorAll<HTMLElement>("[data-dr-vel]").forEach(btn =>
    btn.addEventListener("click", () => {
      setState({ drumRollVelocity: Number(btn.dataset.drVel) });
      render();
    }));

  q<HTMLSelectElement>(pane, "[data-dr-load]").addEventListener("change", e => {
    const select = e.target as HTMLSelectElement;
    const next = DRUM_PATTERNS.find(d => d.id === select.value);
    select.value = "";
    if (!next) return;
    if (isCustomDrum(getState().drumPattern)
        && !confirm(`作ったドラムを「${patternLabel(next)}」に置き換えますか？`)) {
      return;
    }
    commit(next);
  });

  q(pane, "[data-dr-clear]").addEventListener("click", () => {
    const p = getState().drumPattern;
    if (!p) return;
    const any = Object.values(p.tracks).some(t => t.pattern.some(Boolean));
    if (any && !confirm("ドラムの音をすべて消しますか？")) return;
    commit(customDrumPattern(null, drumPatternBars(p)));
  });

  // 行の見出しをクリック：その音を試聴する
  q(pane, ".pr-keys").addEventListener("pointerdown", e => {
    const key = (e.target as HTMLElement).closest<HTMLElement>(".dr-key");
    if (key?.dataset.track) void previewDrumHit(key.dataset.track, getState().drumRollVelocity);
  });

  const grid = q(pane, ".dr-grid");
  grid.addEventListener("pointerdown", e => {
    if (e.button !== 0 && e.button !== 2) return;
    const pattern = editable();
    if (!pattern) return;
    const cell = cellAt(e, grid, pattern.steps);
    if (!cell) return;
    const on = !!pattern.tracks[DRUM_ROLL_TRACKS[cell.row]]?.pattern[cell.step];
    // 左クリックは押したマスで決める（空いていれば置く・あれば消す）。右クリックはいつも消す
    paint = { mode: e.button === 2 || on ? "erase" : "add", pattern, last: "", changed: false };
    grid.setPointerCapture(e.pointerId);
    paintCell(pane, cell.row, cell.step);
  });
  grid.addEventListener("pointermove", e => {
    if (!paint) return;
    const cell = cellAt(e, grid, paint.pattern.steps);
    if (cell) paintCell(pane, cell.row, cell.step);
  });
  grid.addEventListener("pointerup", endPaint);
  grid.addEventListener("pointercancel", endPaint);
  grid.addEventListener("contextmenu", e => e.preventDefault());
}
