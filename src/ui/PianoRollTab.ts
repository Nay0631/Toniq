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
import { buildDrumRoll, initDrumRoll, renderDrumPlayhead, renderDrumRoll } from "./DrumRoll";
import { beatsPerBar, isTriplet, unitsPerBar, unitsPerBeat } from "../engine/Meter";
import { typingKeyMidi } from "./TypingKeys";
import { soloPart, toggleSolo } from "./Solo";

// 表示する音域（MIDI ノート番号。C3〜C7）
const LOW  = 48;
const HIGH = 96;
const ROWS = HIGH - LOW + 1;

// 鍵盤入力の基準のオクターブ（下の段の C）。上の段は1オクターブ上から G まで届くので、5 で C6〜G7（C7 より上は置けない）
const OCTAVE_MIN = 3;
const OCTAVE_MAX = 5;

// 入力する音符の長さ（units はマスの数。4/4・3/4 は 1 マス = 16分音符）
interface LengthDef { value: PianoRollLength; label: string; name: string; units: number }
const STRAIGHT_LENGTHS: LengthDef[] = [
  { value: "2n",  label: "2分",  name: "2分音符",  units: 8 },
  { value: "4n",  label: "4分",  name: "4分音符",  units: 4 },
  { value: "8n",  label: "8分",  name: "8分音符",  units: 2 },
  { value: "16n", label: "16分", name: "16分音符", units: 1 },
];
// 3連符の拍子（1 マス = 8分3連符。1拍 = 3 マス）では、8分・16分の代わりに3連符の長さを選ぶ（AppState の値は同じものを使い回す）
const TRIPLET_LENGTHS: LengthDef[] = [
  { value: "2n",  label: "2分",    name: "2分音符",   units: 6 },
  { value: "4n",  label: "4分",    name: "4分音符",   units: 3 },
  { value: "8n",  label: "4分3連", name: "4分3連符",  units: 2 },
  { value: "16n", label: "8分3連", name: "8分3連符",  units: 1 },
];
const lengths = (): LengthDef[] => isTriplet() ? TRIPLET_LENGTHS : STRAIGHT_LENGTHS;

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

// ピアノロール上の音（start / units はマスの数。Meter.ts。メロディは単音なので start は重ならない）
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

// 編集するパート（メロディ／ドラム。ドラムは DrumRoll.ts）。表示上の一時的な状態
type RollTarget = "melody" | "drum";
let target: RollTarget = "melody";

// メロディ／ドラムの切り替え（両方のツールバーの先頭に置く）
const TARGET_SEG = `
  <div class="pr-seg pr-target" role="group" aria-label="編集するパート">
    <button data-pr-target="melody">メロディ</button><button data-pr-target="drum" data-term="pianorollDrum">ドラム</button>
  </div>
  <button class="btn btn-small pr-solo" data-pr-solo aria-pressed="false"
          title="編集中のパートだけを鳴らす（ほかのパートは OFF。もう一度押すと元の ON/OFF に戻す）">ソロ</button>`;

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
  return (getState().chordPattern?.length_bars ?? 4) * unitsPerBar();
}

function lengthUnits(): number {
  return lengths().find(l => l.value === getState().pianoRollLength)?.units ?? unitsPerBeat();
}

// 配置・移動の刻み（2分音符を選んでいても4分音符単位で置ける）
function snapUnits(): number {
  return Math.min(lengthUnits(), unitsPerBeat());
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
    <div class="pr-pane" data-pr-pane="melody">
    <div class="pr-toolbar">
      ${TARGET_SEG}
      <span class="pr-sep"></span>
      <div class="pr-seg" role="group" aria-label="編集するセクション" data-term="section">
        <button data-pr-section="A">Aメロ</button><button data-pr-section="B">サビ</button>
      </div>
      <span class="pr-sep"></span>
      <div class="pr-seg" role="group" aria-label="入力する音符の長さ" data-term="noteLength">
        ${STRAIGHT_LENGTHS.map(l => `<button data-pr-length="${l.value}">${l.label}</button>`).join("")}
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
        <kbd>↓</kbd><kbd>↑</kbd> オクターブ切替
        <kbd>Del</kbd> 削除
        <kbd>Z〜/</kbd><kbd>Q〜]</kbd> 鍵盤入力
      </span>
    </div>
    </div>
    <div class="pr-pane dr-pane" data-pr-pane="drum" hidden></div>`;
  buildDrumRoll(q(root, '[data-pr-pane="drum"]'), TARGET_SEG);
}

function pane(root: HTMLElement, name: RollTarget): HTMLElement {
  return q(root, `[data-pr-pane="${name}"]`);
}

export function renderPianoRoll(): void {
  const root = currentRoot();
  const s = getState();
  if (!root || !s.chordPattern || drag) return;

  root.querySelectorAll<HTMLElement>("[data-pr-target]").forEach(btn =>
    btn.classList.toggle("is-active", btn.dataset.prTarget === target));
  // ソロ：編集中のパートのソロ中なら点ける（アレンジャーの右クリックでのソロとも共通）
  const soloOn = soloPart() === target;
  root.querySelectorAll<HTMLElement>("[data-pr-solo]").forEach(btn => {
    btn.classList.toggle("is-on", soloOn);
    btn.setAttribute("aria-pressed", String(soloOn));
  });
  pane(root, "melody").hidden = target !== "melody";
  pane(root, "drum").hidden   = target !== "drum";
  if (target === "drum") {
    renderDrumRoll(pane(root, "drum"));
    if (Playback.isPlaying()) startPianoRollPlayhead();
    return;
  }

  const total = loopUnits();
  const bars  = s.chordPattern.length_bars;
  const scale = scalePitchClasses();
  const tonic = NOTE_INDEX[s.key] ?? 0;
  const notes = readNotes();
  if (cursor >= total) cursor = 0;
  if (selected !== null && !notes.some(n => n.start === selected)) selected = null;

  const BAR = unitsPerBar();
  root.style.setProperty("--bars", String(bars));
  root.style.setProperty("--beats", String(beatsPerBar()));
  root.style.setProperty("--steps", String(BAR));
  root.classList.toggle("is-locked", s.pianoRollScaleLock);

  // ツールバー（音符の長さのボタンの名前は拍子で変わる：3連符の拍子では 4分3連・8分3連）
  root.querySelectorAll<HTMLElement>("[data-pr-length]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.prLength === s.pianoRollLength);
    btn.textContent = lengths().find(l => l.value === btn.dataset.prLength)?.label ?? btn.textContent;
  });
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
      `<span class="pr-bar-no" style="left:${pct(bar * BAR)}">${bar + 1}</span>`).join("") +
    chords.map(c =>
      `<span class="pr-chord" style="left:${pct(c.bar * BAR)};width:${pct(c.bars * BAR)}">${c.name}</span>`).join("") +
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
  const length = lengths().find(l => l.value === s.pianoRollLength);
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
  // ほかの画面で始めた再生でも、表示したら再生位置の線を動かす
  if (Playback.isPlaying()) startPianoRollPlayhead();
}

function scrollToOctave(root: HTMLElement): void {
  const scroller = q(root, ".pr-scroll");
  const rowH  = q(root, ".pr-grid").getBoundingClientRect().height / ROWS;
  const center = (getState().pianoRollOctave + 2) * 12;  // 鍵盤入力の音域（基準の C〜2オクターブ上の G）の中ほど
  scroller.scrollTop = (HIGH - center) * rowH - scroller.clientHeight / 2 + rowH;
}

function renderPlayhead(): void {
  const root = currentRoot();
  const s = getState();
  if (!root || !s.chordPattern) return;
  if (target === "drum") {
    renderDrumPlayhead(pane(root, "drum"));
    return;
  }
  const playhead = pane(root, "melody").querySelector<HTMLElement>(".pr-playhead");
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
function inputKey(midi: number): void {
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
    initDrumRoll(pane(rootEl, "drum"));

    // メロディ／ドラムの切り替え
    rootEl.querySelectorAll<HTMLElement>("[data-pr-target]").forEach(btn =>
      btn.addEventListener("click", () => {
        target = btn.dataset.prTarget === "drum" ? "drum" : "melody";
        selected = null;
        render();
        // 隠している間にスクロール位置が戻ることがあるので、鍵盤入力のオクターブが見える位置へスクロールし直す
        if (target === "melody") scrollToOctave(rootEl);
      }));

    // ソロ：編集中のパート（メロディ／ドラム）だけを鳴らす。もう一度押すとソロにする前の ON/OFF に戻す
    rootEl.querySelectorAll<HTMLElement>("[data-pr-solo]").forEach(btn =>
      btn.addEventListener("click", () => {
        toggleSolo(target);
        render();
      }));

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

  // キーボード：タイピングピアノ（TypingKeys.ts）で鍵盤入力、↓ / ↑ でオクターブ切替、Delete で選択中の音を削除
  document.addEventListener("keydown", e => {
    if (!currentRoot() || target !== "melody" || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || drag) return;
    const midi = typingKeyMidi(e.code, getState().pianoRollOctave);

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setOctave(getState().pianoRollOctave + (e.key === "ArrowDown" ? -1 : 1));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selected === null) return;
      removeNote(selected);
    } else if (midi !== null) {
      if (e.repeat) return;
      inputKey(midi);
    } else {
      return;
    }
    e.preventDefault();
  });
}
