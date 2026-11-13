import * as Playback from "../engine/Playback";
import { render } from "./Router";

// 文字の入力中か（スペースは入力に使うので、再生／停止にしない）
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(
    "input:not([type=range]):not([type=checkbox]), select, textarea, [contenteditable]");
}

// 書き出しの進み具合などのダイアログが出ているか
export function modalOpen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]'))
    .some(el => el.getClientRects().length > 0);
}

// active() が true の間、スペースキーで再生／停止する（再生は start で始める）。
// ボタンにフォーカスがあってもクリックさせないよう、キャプチャで受けて既定の動作を止める
export function bindSpaceToPlay(active: () => boolean, start: () => Promise<void>): void {
  document.addEventListener("keydown", e => {
    if (!active()) return;
    if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isTyping(e.target) || modalOpen()) return;
    e.preventDefault();
    if (e.repeat) return;
    if (Playback.isPlaying()) {
      Playback.stop();
      render();
    } else {
      void start();
    }
  }, { capture: true });
}
