import { getState, setState, onBeforeSetState, AppState, SONG_FIELDS, SongFields } from "./AppState";

// 元に戻す／やり直す：曲の内容（SONG_FIELDS）が変わる直前の状態を積んでおく。
// 1回の操作（ドラッグ・ノブを回す・クリック）で起きた変更はまとめて1つの履歴にする。
// モードは画面の切り替えで変わるので履歴の対象にしない

const LIMIT   = 100;  // 残す履歴の数
const IDLE_MS = 600;  // 操作が途切れてからこの時間たったら、次の変更は新しい履歴にする

const TRACKED = SONG_FIELDS.filter(f => f !== "mode");
type TrackedField = typeof TRACKED[number];
type Snapshot = Pick<SongFields, TrackedField>;

let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

let grouping    = false;  // 今の操作の履歴を積んだあと、まだまとめている途中か
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDown = false;
let suspended   = 0;      // > 0 のあいだは履歴を取らない（サンプル試聴の差し替え・元に戻す処理そのもの）

const listeners = new Set<() => void>();

function snapshot(s: AppState): Snapshot {
  const fields = {} as Record<string, unknown>;
  TRACKED.forEach(f => { fields[f] = s[f]; });
  return structuredClone(fields) as Snapshot;
}

function notify(): void {
  listeners.forEach(fn => fn());
}

function closeGroup(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  grouping  = false;
}

function scheduleClose(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = pointerDown ? null : setTimeout(closeGroup, IDLE_MS);
}

onBeforeSetState((prev, partial) => {
  if (suspended > 0) return;
  const changed = TRACKED.some(f => f in partial && partial[f] !== prev[f]);
  if (!changed) return;
  if (!grouping) {
    undoStack.push(snapshot(prev));
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack = [];
    grouping  = true;
    notify();
  }
  scheduleClose();
});

// 押した・キーを打ったところから新しい操作。ドラッグ中（押している間）の変更は1つにまとめる
window.addEventListener("pointerdown", () => { pointerDown = true; closeGroup(); }, true);
const release = () => {
  pointerDown = false;
  if (grouping) scheduleClose();
};
window.addEventListener("pointerup", release, true);
window.addEventListener("pointercancel", release, true);
window.addEventListener("keydown", e => {
  if (!e.repeat) closeGroup();
}, true);

// 履歴を取らずに状態を変える（表示用の一時的な差し替えなど）
export function withoutHistory<T>(fn: () => T): T {
  suspended++;
  try {
    return fn();
  } finally {
    suspended--;
  }
}

// 曲を開いた・新しく作ったときは履歴を捨てる
export function resetHistory(): void {
  closeGroup();
  undoStack = [];
  redoStack = [];
  notify();
}

export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }

export function onHistoryChange(fn: () => void): void {
  listeners.add(fn);
}

// 戻した結果、内容が変わった項目を返す（再生中の読み込み直しの判断に使う）
function restore(target: Snapshot): TrackedField[] {
  const current = getState();
  const changed = TRACKED.filter(f => JSON.stringify(current[f]) !== JSON.stringify(target[f]));
  withoutHistory(() => setState(structuredClone(target)));
  return changed;
}

export function undo(): TrackedField[] | null {
  closeGroup();
  const target = undoStack.pop();
  if (!target) return null;
  redoStack.push(snapshot(getState()));
  const changed = restore(target);
  notify();
  return changed;
}

export function redo(): TrackedField[] | null {
  closeGroup();
  const target = redoStack.pop();
  if (!target) return null;
  undoStack.push(snapshot(getState()));
  const changed = restore(target);
  notify();
  return changed;
}

export type { TrackedField };
