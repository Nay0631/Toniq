import { getState, setState, PianoRollLength, Section } from "../engine/AppState";
import {
  MelodyNote, noteToMidi, midiToNote,
  timeToUnits, durationToUnits, unitsToTime, unitsToDuration,
} from "../engine/MelodyGenerator";
import { reloadLayer } from "../engine/LayerManager";
import { previewMelodyNote } from "../engine/MelodyPlayer";
import * as Playback from "../engine/Playback";
import { NOTE_INDEX, scaleSemitones } from "../data/degree_resolver";
import { onRender, render } from "./Router";
import { SCALE_LABELS, chordSpans, displayNote } from "./format";
import { chorusProgression, generateSongMelodies } from "../engine/SongForm";
import type { ChordProgression } from "../data/types";

// 表示する音域（MIDI ノート番号。C3〜C7）
const LOW  = 48;
const HIGH = 96;
const ROWS = HIGH - LOW + 1;

const OCTAVE_MIN = 3;
const OCTAVE_MAX = 6;

// 入力する音符の長さ（units は16分音符単位）
const LENGTHS: { value: PianoRollLength; label: string; name: string; units: number }[] = [
  { value: "2n",  label: "2分",  name: "2分音符",  units: 8 },
  { value: "4n",  label: "4分",  name: "4分音符",  units: 4 },
  { value: "8n",  label: "8分",  name: "8分音符",  units: 2 },
  { value: "16n", label: "16分", name: "16分音符", units: 1 },
];

// 鍵盤入力：A〜K の段を白鍵、W E T Y U を黒鍵として、オクターブの C からの半音数に割り当てる
const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
};

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

// ピアノロール上の音（start / units は16分音符単位。メロディは単音なので start は重ならない）
interface RollNote {
  midi:  number;
  start: number;
  units: number;
}

// 選択中の音（開始位置）と鍵盤入力の位置。表示上の一時的な状態なので AppState には置かない
let selected: number | null = null;
let cursor = 0;

// 編集中のセクション（A = Aメロ、B = サビ。サビは AppState.chorusMelodyNotes）。表示上の一時的な状態
let section: Section = "A";

// 編集中のセクションのコード進行（サビの進行がなければ Aメロと同じ）
function rollProgression(): ChordProgression | null {
  const s = getState();
  return section === "B" ? chorusProgression() ?? s.chordPattern : s.chordPattern;
}

// 編集中のセクションのメロディ（サビのメロディがまだなければ、サビでも鳴る Aメロのメロディを見せる）
function sectionNotes(): MelodyNote[] {
  const s = getState();
  return section === "B" && s.chorusMelodyNotes.length > 0 ? s.chorusMelodyNotes : s.melodyNotes;
}

// ===== メロディ（AppState.melodyNotes）との変換 =====

function loopUnits(): number {
  return (getState().chordPattern?.length_bars ?? 4) * 16;
}

function lengthUnits(): number {
  return LENGTHS.find(l => l.value === getState().pianoRollLength)?.units ?? 4;
}

// 配置・移動の刻み（2分音符を選んでいても4分音符単位で置ける）
function snapUnits(): number {
  return Math.min(lengthUnits(), 4);
}

// 休符は持たず、鳴る音だけを扱う。コード進行1周より後ろの音は表示しない
function readNotes(): RollNote[] {
  const total = loopUnits();
  return sectionNotes()
    .filter((n): n is MelodyNote & { note: string } => n.note !== null)
    .map(n => ({ midi: noteToMidi(n.note), start: timeToUnits(n.time), units: durationToUnits(n.duration) }))
    .filter(n => n.start < total);
}

// 編集したらメロディは「自分で入力」になる。再生中ならメロディだけ読み込み直してすぐ反映する
function writeNotes(notes: RollNote[]): void {
  const melodyNotes: MelodyNote[] = [...notes]
    .sort((a, b) => a.start - b.start)
    .map(n => ({ note: midiToNote(n.midi), duration: unitsToDuration(n.units), time: unitsToTime(n.start) }));
  setState(section === "B" ? { chorusMelodyNotes: melodyNotes, melodyMethod: "manual" } : { melodyNotes, melodyMethod: "manual" });
  if (Playback.isPlaying() && getState().parts.melody) reloadLayer("melody");
  render();
}

// 音を置く。メロディは単音なので、重なる前の音は手前で切り、範囲内で始まる音は消す
function placeNote(others: RollNote[], note: RollNote): RollNote[] {
  const end = note.start + note.units;
  const rest = others.flatMap(n => {
    if (n.start + n.units <= note.start || n.start >= end) return [n];
    if (n.start < note.start) return [{ ...n, units: note.start - n.start }];
    return [];
  });
  return [...rest, note];
}

// ===== スケール =====

function scaleName(): string {
  return getState().chordPattern?.base_scale ?? "minor";
}

// スケールの7音（ピッチクラス）。メロディ生成と同じ SCALE_TONES から作る
function scalePitchClasses(): Set<number> {
  const root = NOTE_INDEX[getState().key] ?? 0;
  return new Set(scaleSemitones(scaleName()).map(d => (root + d) % 12));
}

function allowed(midi: number, scale: Set<number>): boolean {
  return midi >= LOW && midi <= HIGH && (!getState().pianoRollScaleLock || scale.has(midi % 12));
}

// スケールロック中にスケール外へ動かしたときは、動かした向きの隣のスケール音に寄せる
function snapToScale(midi: number, dir: number): number {
  const scale = scalePitchClasses();
  for (let d = 0; d <= 2; d++) {
    for (const m of dir >= 0 ? [midi + d, midi - d] : [midi - d, midi + d]) {
      if (allowed(m, scale)) return m;
    }
  }
  return midi;
}

// ===== 表示 =====

const pct = (units: number) => `${(units / loopUnits()) * 100}%`;
const rowTop = (midi: number) => `calc(${HIGH - midi} * var(--row-h))`;

// 表示中のピアノロール（シンプルモード・カスタムモードの画面にそれぞれある）
function currentRoot(): HTMLElement | null {
  const s = getState();
  if (s.tab !== "pianoroll" || (s.screen !== "simple" && s.screen !== "custom")) return null;
  return document.querySelector<HTMLElement>(`[data-screen="${s.screen}"] .pianoroll`);
}

function q<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
  return root.querySelector<T>(selector)!;
}

const LOCK_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>
  </svg>`;

const TRASH_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>
  </svg>`;

// 枠組みは最初の1回だけ作る（スクロール位置を保つため、描画では中身だけ作り直す）
function buildSkeleton(root: HTMLElement): void {
  root.innerHTML = `
    <div class="pr-toolbar">
      <div class="pr-seg" role="group" aria-label="編集するセクション" data-term="section">
        <button data-pr-section="A">Aメロ</button><button data-pr-section="B">サビ</button>
      </div>
      <span class="pr-sep"></span>
      <div class="pr-seg" role="group" aria-label="入力する音符の長さ" data-term="noteLength">
        ${LENGTHS.map(l => `<button data-pr-length="${l.value}">${l.label}</button>`).join("")}
      </div>
      <span class="pr-sep"></span>
      <button class="btn btn-small pr-lock" data-pr-lock data-term="scaleLock">${LOCK_ICON}スケールロック</button>
      <span class="pr-sep"></span>
      <span class="pr-label" data-term="octave">オクターブ</span>
      <button class="btn btn-small btn-icon" data-pr-octave="-1" aria-label="オクターブを下げる">−</button>
      <b class="pr-octave" data-pr-octave-value></b>
      <button class="btn btn-small btn-icon" data-pr-octave="1" aria-label="オクターブを上げる">＋</button>
      <span class="pr-sep"></span>
      <button class="btn btn-small" data-pr-auto title="ジャンルに合わせてメロディを自動で作り直す">✦ 自動生成</button>
      <button class="btn btn-small" data-pr-clear>${TRASH_ICON}クリア</button>
      <span class="pr-hint">クリック：配置／ドラッグ：移動・長さ／右クリック：削除</span>
    </div>
    <div class="pr-scroll">
      <div class="pr-ruler">
        <div class="pr-corner"></div>
        <div class="pr-ticks" title="クリックで鍵盤入力の位置を指定"></div>
      </div>
      <div class="pr-main">
        <div class="pr-keys"></div>
        <div class="pr-grid"></div>
      </div>
    </div>
    <div class="pr-status">
      <span class="pr-status-lock" data-pr-status-lock></span>
      <span class="pr-key-chip" data-pr-status-key></span>
      <span class="pr-status-sep"></span>
      <span>入力中の音符長：<span data-pr-status-length></span></span>
      <span class="pr-status-sep"></span>
      <span>オクターブ：<span data-pr-status-octave></span></span>
      <span class="pr-status-keys">
        <kbd>Z</kbd><kbd>X</kbd> オクターブ切替
        <kbd>Del</kbd> 削除
        <kbd>A〜K</kbd> 鍵盤入力
      </span>
    </div>`;
}

export function renderPianoRoll(): void {
  const root = currentRoot();
  const s = getState();
  if (!root || !s.chordPattern || drag) return;

  const total = loopUnits();
  const bars  = s.chordPattern.length_bars;
  const scale = scalePitchClasses();
  const tonic = NOTE_INDEX[s.key] ?? 0;
  const notes = readNotes();
  if (cursor >= total) cursor = 0;
  if (selected !== null && !notes.some(n => n.start === selected)) selected = null;

  root.style.setProperty("--bars", String(bars));
  root.classList.toggle("is-locked", s.pianoRollScaleLock);

  // ツールバー
  root.querySelectorAll<HTMLElement>("[data-pr-length]").forEach(btn =>
    btn.classList.toggle("is-active", btn.dataset.prLength === s.pianoRollLength));
  root.querySelectorAll<HTMLElement>("[data-pr-section]").forEach(btn =>
    btn.classList.toggle("is-active", btn.dataset.prSection === section));
  const lock = q(root, "[data-pr-lock]");
  lock.classList.toggle("is-on", s.pianoRollScaleLock);
  lock.setAttribute("aria-pressed", String(s.pianoRollScaleLock));
  q(root, "[data-pr-octave-value]").textContent = String(s.pianoRollOctave);
  q<HTMLButtonElement>(root, '[data-pr-octave="-1"]').disabled = s.pianoRollOctave <= OCTAVE_MIN;
  q<HTMLButtonElement>(root, '[data-pr-octave="1"]').disabled  = s.pianoRollOctave >= OCTAVE_MAX;

  // 目盛り：小節番号とその小節のコード
  let chords: { bar: number; bars: number; name: string }[] = [];
  try {
    chords = chordSpans(rollProgression() ?? s.chordPattern, s.key);
  } catch (e) {
    console.warn("ピアノロール：コード名の解決に失敗", e);
  }
  q(root, ".pr-ticks").innerHTML =
    Array.from({ length: bars }, (_, bar) =>
      `<span class="pr-bar-no" style="left:${pct(bar * 16)}">${bar + 1}</span>`).join("") +
    chords.map(c =>
      `<span class="pr-chord" style="left:${pct(c.bar * 16)};width:${pct(c.bars * 16)}">${c.name}</span>`).join("") +
    `<span class="pr-cursor-marker" style="left:${pct(cursor)}"></span>`;

  // 鍵盤と行
  const keys: string[] = [];
  const rows: string[] = [];
  for (let midi = HIGH; midi >= LOW; midi--) {
    const pc  = midi % 12;
    const cls = [
      BLACK_KEYS.has(pc) ? "is-black" : "",
      scale.has(pc) ? "" : "is-out",
      pc === tonic ? "is-tonic" : "",
    ].join(" ");
    keys.push(`<div class="pr-key ${cls}" data-midi="${midi}">${displayNote(midiToNote(midi))}</div>`);
    rows.push(`<div class="pr-row ${cls}"></div>`);
  }
  q(root, ".pr-keys").innerHTML = keys.join("");

  const grid = q(root, ".pr-grid");
  grid.innerHTML = rows.join("") +
    notes.map(n => `
      <div class="pr-note${n.start === selected ? " is-selected" : ""}${scale.has(n.midi % 12) ? "" : " is-out"}"
           data-start="${n.start}" style="left:${pct(n.start)};width:${pct(n.units)};top:${rowTop(n.midi)}"
           title="${displayNote(midiToNote(n.midi))}（ドラッグで移動・右端で長さを変更・右クリックで削除）">
        <span class="pr-note-label">${displayNote(midiToNote(n.midi))}</span>
        <span class="pr-note-handle"></span>
      </div>`).join("") +
    `<div class="pr-cursor" style="left:${pct(cursor)}"></div>
     <div class="pr-playhead" hidden></div>`;

  // ステータスバー
  const length = LENGTHS.find(l => l.value === s.pianoRollLength);
  q(root, "[data-pr-status-lock]").innerHTML = `${LOCK_ICON}スケールロック${s.pianoRollScaleLock ? "有効" : "無効"}`;
  q(root, "[data-pr-status-key]").textContent    = `${s.key}${SCALE_LABELS[scaleName()] ?? ""}`;
  q(root, "[data-pr-status-length]").textContent = length?.name ?? "";
  q(root, "[data-pr-status-octave]").textContent = String(s.pianoRollOctave);

  // 初めて表示したときは、鍵盤入力のオクターブが見える位置までスクロールする
  if (!root.dataset.scrolled) {
    root.dataset.scrolled = "1";
    scrollToOctave(root);
  }
  renderPlayhead();
}

function scrollToOctave(root: HTMLElement): void {
  const scroller = q(root, ".pr-scroll");
  const rowH  = q(root, ".pr-grid").getBoundingClientRect().height / ROWS;
  const center = (getState().pianoRollOctave + 1) * 12 + 6;  // オクターブの中央（F#）
  scroller.scrollTop = (HIGH - center) * rowH - scroller.clientHeight / 2 + rowH;
}

function renderPlayhead(): void {
  const root = currentRoot();
  const s = getState();
  if (!root || !s.chordPattern) return;
  const playhead = root.querySelector<HTMLElement>(".pr-playhead");
  if (!playhead) return;
  const playing = Playback.isPlaying();
  playhead.hidden = !playing;
  if (playing) {
    // メロディはコード進行1周でループするので、周回内の位置を表示する
    const bars = s.chordPattern.length_bars;
    playhead.style.left = `${((Playback.getPositionBars() % bars) / bars) * 100}%`;
  }
}

let rafId: number | null = null;

// 再生中は再生位置の線を動かす
export function startPianoRollPlayhead(): void {
  if (rafId !== null) return;
  const tick = () => {
    renderPlayhead();
    rafId = Playback.isPlaying() ? requestAnimationFrame(tick) : null;
  };
  rafId = requestAnimationFrame(tick);
}

// ===== 編集 =====

function setOctave(octave: number): void {
  const next = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, octave));
  if (next === getState().pianoRollOctave) return;
  setState({ pianoRollOctave: next });
  render();
  const root = currentRoot();
  if (root) scrollToOctave(root);
}

function removeNote(start: number): void {
  if (selected === start) selected = null;
  writeNotes(readNotes().filter(n => n.start !== start));
}

// 鍵盤入力：入力位置に音を置き、入力位置を音の後ろへ進める
function inputKey(offset: number): void {
  const s    = getState();
  const midi = (s.pianoRollOctave + 1) * 12 + offset;
  if (!allowed(midi, scalePitchClasses())) return;

  const total = loopUnits();
  if (cursor >= total) cursor = 0;
  const note = { midi, start: cursor, units: Math.min(lengthUnits(), total - cursor) };
  selected = note.start;
  cursor   = (note.start + note.units) % total;
  writeNotes(placeNote(readNotes(), note));
  void previewMelodyNote(midiToNote(midi));
}

interface Drag {
  el:      HTMLElement;
  mode:    "move" | "resize";
  isNew:   boolean;    // 空いている所をクリックして置いた音（動かさなくても確定する）
  x:       number;
  y:       number;
  stepPx:  number;
  rowPx:   number;
  orig:    RollNote;
  next:    RollNote;
  others:  RollNote[];
}

let drag: Drag | null = null;

function updateDragElement(): void {
  if (!drag) return;
  const { el, next } = drag;
  el.style.left  = pct(next.start);
  el.style.width = pct(next.units);
  el.style.top   = rowTop(next.midi);
  el.querySelector(".pr-note-label")!.textContent = midiToNote(next.midi);
}

function startDrag(e: PointerEvent, grid: HTMLElement): void {
  const rect  = grid.getBoundingClientRect();
  const total = loopUnits();
  const snap  = snapUnits();
  const notes = readNotes();
  const target  = e.target as HTMLElement;
  const noteEl  = target.closest<HTMLElement>(".pr-note");
  const base = { x: e.clientX, y: e.clientY, stepPx: rect.width / total, rowPx: rect.height / ROWS };

  if (noteEl) {
    // 置いてある音：選択して、ドラッグで移動（右端は長さを変更）
    const note = notes.find(n => n.start === Number(noteEl.dataset.start));
    if (!note) return;
    selected = note.start;
    grid.querySelectorAll(".pr-note.is-selected").forEach(el => el.classList.remove("is-selected"));
    noteEl.classList.add("is-selected");
    drag = {
      ...base, el: noteEl, isNew: false,
      mode:   target.classList.contains("pr-note-handle") ? "resize" : "move",
      orig:   note,
      next:   { ...note },
      others: notes.filter(n => n !== note),
    };
    void previewMelodyNote(midiToNote(note.midi));
  } else {
    // 空いている所：クリックした位置に入力中の長さの音を置く（そのままドラッグで長さを変えられる）
    const midi  = HIGH - Math.floor((e.clientY - rect.top) / base.rowPx);
    const start = Math.floor((e.clientX - rect.left) / base.stepPx / snap) * snap;
    if (start < 0 || start >= total || !allowed(midi, scalePitchClasses())) return;

    const note = { midi, start, units: Math.min(lengthUnits(), total - start) };
    const el = document.createElement("div");
    el.className = "pr-note is-selected";
    el.innerHTML = `<span class="pr-note-label"></span><span class="pr-note-handle"></span>`;
    grid.querySelectorAll(".pr-note.is-selected").forEach(n => n.classList.remove("is-selected"));
    grid.appendChild(el);
    drag = { ...base, el, isNew: true, mode: "resize", orig: note, next: { ...note }, others: notes };
    updateDragElement();
    void previewMelodyNote(midiToNote(midi));
  }

  drag.el.classList.add("is-dragging");
  drag.el.setPointerCapture(e.pointerId);
}

function moveDrag(e: PointerEvent): void {
  if (!drag) return;
  const { orig } = drag;
  const total = loopUnits();
  const snap  = snapUnits();
  const dStep = Math.round((e.clientX - drag.x) / drag.stepPx / snap) * snap;

  if (drag.mode === "move") {
    const dRow  = Math.round((e.clientY - drag.y) / drag.rowPx);
    const raw   = Math.max(LOW, Math.min(HIGH, orig.midi - dRow));
    const midi  = snapToScale(raw, -dRow);
    const start = Math.max(0, Math.min(orig.start + dStep, total - orig.units));
    if (midi !== drag.next.midi) void previewMelodyNote(midiToNote(midi));
    drag.next = { midi, start, units: orig.units };
  } else {
    const end = Math.max(orig.start + snap, Math.min(orig.start + orig.units + dStep, total));
    drag.next = { ...orig, units: end - orig.start };
  }
  updateDragElement();
}

function endDrag(): void {
  if (!drag) return;
  const { isNew, orig, next, others } = drag;
  drag = null;
  const changed = next.midi !== orig.midi || next.start !== orig.start || next.units !== orig.units;
  if (isNew || changed) {
    selected = next.start;
    cursor   = (next.start + next.units) % loopUnits();
    writeNotes(placeNote(others, next));
  } else {
    renderPianoRoll();
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, select, textarea, [contenteditable]");
}

export function initPianoRoll(): void {
  onRender(renderPianoRoll);

  document.querySelectorAll<HTMLElement>(".pianoroll").forEach(rootEl => {
    buildSkeleton(rootEl);

    // ツールバー
    rootEl.querySelectorAll<HTMLElement>("[data-pr-length]").forEach(btn =>
      btn.addEventListener("click", () => {
        setState({ pianoRollLength: btn.dataset.prLength as PianoRollLength });
        render();
      }));
    rootEl.querySelectorAll<HTMLElement>("[data-pr-section]").forEach(btn =>
      btn.addEventListener("click", () => {
        section = btn.dataset.prSection === "B" ? "B" : "A";
        selected = null;
        render();
      }));
    q(rootEl, "[data-pr-lock]").addEventListener("click", () => {
      setState({ pianoRollScaleLock: !getState().pianoRollScaleLock });
      render();
    });
    rootEl.querySelectorAll<HTMLElement>("[data-pr-octave]").forEach(btn =>
      btn.addEventListener("click", () => setOctave(getState().pianoRollOctave + Number(btn.dataset.prOctave))));
    q(rootEl, "[data-pr-clear]").addEventListener("click", () => {
      if (readNotes().length > 0 && !confirm("ピアノロールの音をすべて消しますか？")) return;
      selected = null;
      cursor   = 0;
      writeNotes([]);
    });
    q(rootEl, "[data-pr-auto]").addEventListener("click", () => {
      const s = getState();
      if (!s.chordPattern) return;
      if (s.melodyMethod === "manual" && readNotes().length > 0
          && !confirm("入力したメロディを自動生成のメロディに置き換えますか？")) return;
      selected = null;
      // Aメロとサビの両方を作り直す
      setState({
        ...generateSongMelodies(),
        melodyMethod:  "auto",
        melodyVersion: s.melodyVersion + 1,
      });
      if (Playback.isPlaying() && getState().parts.melody) reloadLayer("melody");
      render();
    });

    // 目盛りをクリック：鍵盤入力の位置を決める
    q(rootEl, ".pr-ticks").addEventListener("pointerdown", e => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const snap = snapUnits();
      const step = Math.floor(((e.clientX - rect.left) / rect.width) * loopUnits() / snap) * snap;
      cursor = Math.max(0, Math.min(step, loopUnits() - 1));
      renderPianoRoll();
    });

    // 鍵盤をクリック：その音を試聴する
    q(rootEl, ".pr-keys").addEventListener("pointerdown", e => {
      const key = (e.target as HTMLElement).closest<HTMLElement>(".pr-key");
      if (key) void previewMelodyNote(midiToNote(Number(key.dataset.midi)));
    });

    const grid = q(rootEl, ".pr-grid");
    grid.addEventListener("pointerdown", e => {
      if (e.button === 2) {
        const noteEl = (e.target as HTMLElement).closest<HTMLElement>(".pr-note");
        if (noteEl) removeNote(Number(noteEl.dataset.start));
        return;
      }
      if (e.button === 0) startDrag(e, grid);
    });
    grid.addEventListener("contextmenu", e => e.preventDefault());
    grid.addEventListener("pointermove", moveDrag);
    grid.addEventListener("pointerup", endDrag);
    grid.addEventListener("pointercancel", endDrag);
  });

  // キーボード：A〜K で鍵盤入力、Z / X でオクターブ切替、Delete で選択中の音を削除
  document.addEventListener("keydown", e => {
    if (!currentRoot() || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || drag) return;

    if (e.code === "KeyZ" || e.code === "KeyX") {
      setOctave(getState().pianoRollOctave + (e.code === "KeyZ" ? -1 : 1));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selected === null) return;
      removeNote(selected);
    } else if (e.code in KEYMAP) {
      if (e.repeat) return;
      inputKey(KEYMAP[e.code]);
    } else {
      return;
    }
    e.preventDefault();
  });
}
