import { getState } from "../engine/AppState";
import { undo, redo, canUndo, canRedo, onHistoryChange, resetHistory, withoutHistory, TrackedField } from "../engine/History";
import { reloadLayer, setLayerEnabled, LayerName } from "../engine/LayerManager";
import { applyAllVolumes } from "../engine/VolumeManager";
import { applySwing } from "../engine/Groove";
import * as Playback from "../engine/Playback";
import { restartIfPlaying as restartCustom } from "./CustomScreen";
import { restartIfPlaying as restartSimple } from "./SimpleScreen";
import { onRender, render } from "./Router";

// 元に戻す／やり直す（シンプルモード・カスタムモードの情報バーのボタンと Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y）

// 再生し直さなくても反映できる項目（アレンジは再生中も AppState を見ている）
const LIGHT_FIELDS: TrackedField[] = [
  "arrangement", "volumes", "parts", "melodyNotes", "melodyMethod", "melodyVersion", "swing", "sidechain",
];

function renderButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-undo]").forEach(btn => { btn.disabled = !canUndo(); });
  document.querySelectorAll<HTMLButtonElement>("[data-redo]").forEach(btn => { btn.disabled = !canRedo(); });
}

// 戻した内容を音と画面にそろえる
async function applyChanges(changed: TrackedField[], before: Record<LayerName, boolean>): Promise<void> {
  if (changed.includes("volumes")) applyAllVolumes();
  if (changed.includes("swing"))   applySwing();  // サイドチェインはキックのたびに AppState を読むのでそのままでよい

  if (Playback.isPlaying()) {
    if (changed.every(f => LIGHT_FIELDS.includes(f))) {
      const s = getState();
      // ON/OFF が変わったパートだけ読み込み直す・破棄する（setLayerEnabled の状態更新は履歴に残さない）
      (Object.keys(before) as LayerName[]).forEach(part => {
        if (before[part] !== s.parts[part]) withoutHistory(() => setLayerEnabled(part, s.parts[part]));
      });
      if (changed.some(f => f.startsWith("melody")) && s.parts.melody) reloadLayer("melody");
    } else if (getState().screen === "custom") {
      await restartCustom();
    } else {
      await restartSimple();
    }
  }
  render();
}

async function step(direction: "undo" | "redo"): Promise<void> {
  const screen = getState().screen;
  if (screen !== "simple" && screen !== "custom") return;
  // ジャンルのサンプル中は曲のパターンを差し替えているので、止めて元に戻してから履歴をたどる
  Playback.stopSample();
  const before = { ...getState().parts };
  const changed = direction === "undo" ? undo() : redo();
  if (changed) await applyChanges(changed, before);
}

// 文字を入力している欄では、ブラウザ標準の元に戻すを使う
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && ["text", "search", "number", "email", "url"].includes(target.type);
}

export function initHistoryControls(): void {
  onRender(renderButtons);
  onHistoryChange(renderButtons);

  document.querySelectorAll<HTMLButtonElement>("[data-undo]").forEach(btn =>
    btn.addEventListener("click", () => void step("undo")));
  document.querySelectorAll<HTMLButtonElement>("[data-redo]").forEach(btn =>
    btn.addEventListener("click", () => void step("redo")));

  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextInput(e.target)) return;
    const key = e.key.toLowerCase();
    const isUndo = key === "z" && !e.shiftKey;
    const isRedo = (key === "z" && e.shiftKey) || key === "y";
    if (!isUndo && !isRedo) return;
    const screen = getState().screen;
    if (screen !== "simple" && screen !== "custom") return;
    e.preventDefault();
    void step(isUndo ? "undo" : "redo");
  });

  // 起動時の初期設定は元に戻す対象にしない
  resetHistory();
}
