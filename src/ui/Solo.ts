import { getState } from "../engine/AppState";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import { LAYERS } from "../engine/LoopArranger";

// ソロ：1つのパートだけ ON にし、ほかを OFF にする。もう一度ソロを切り替えると、ソロにする前の ON/OFF に戻す。
// アレンジャー（ON/OFF ボタンの右クリック）とピアノロール（ツールバーの「ソロ」ボタン）で共通。
// ソロにする前の ON/OFF は表示上の一時的な状態としてモジュール内に持つ（保存しない）。
// 手で ON/OFF を変えた・元に戻した・曲を開いたなどで「そのパートだけ ON」でなくなったら、ソロは解けたものとして扱う
let solo: { part: LayerName; before: Record<LayerName, boolean> } | null = null;

// 今の ON/OFF が「part だけ ON」か
function isSoloOf(part: LayerName): boolean {
  const parts = getState().parts;
  return LAYERS.every(name => parts[name] === (name === part));
}

// ソロ中のパート（ソロが解けていれば null）
export function soloPart(): LayerName | null {
  if (solo && !isSoloOf(solo.part)) solo = null;
  return solo?.part ?? null;
}

// パートの ON/OFF をまとめて当てる（変わるものだけ。OFF を先にして、鳴っている音を先に止める）
function applyParts(next: Record<LayerName, boolean>): void {
  const parts = getState().parts;
  const changed = LAYERS.filter(name => parts[name] !== next[name]);
  for (const name of changed.filter(n => !next[n])) setLayerEnabled(name, false);
  for (const name of changed.filter(n => next[n]))  setLayerEnabled(name, true);
}

// part をソロにする。すでに part のソロ中なら、ソロにする前の ON/OFF に戻す。
// ソロ中にほかのパートをソロにしたら、戻す先（ソロにする前の ON/OFF）は最初のまま持ち続ける
export function toggleSolo(part: LayerName): void {
  if (soloPart() === part) {
    const before = solo!.before;
    solo = null;
    applyParts(before);
    return;
  }
  const before = solo ? solo.before : { ...getState().parts };
  const next = { ...getState().parts };
  for (const name of LAYERS) next[name] = name === part;
  applyParts(next);
  solo = { part, before };
}
