import { getState, setState, defaultState } from "../engine/AppState";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import { applySwing } from "../engine/Groove";
import { applyGrowLive, setGrowSound, storedGrowSound, type GrowPart } from "../engine/Grow";

// カスタムモードの設定タブの「もっと調整」（<details class="panel-more" data-more="…">）。
// 標準（ジャンルに合わせる・初期値）のままでも曲として鳴る項目を畳んでおき、ふだんは目に入らないようにする。
// - 見出しには、標準から変えている項目の数を出す（畳んでいても変えたことがわかる）
// - 変えている項目の名前（data-std="…"）には印（●）を付ける
// - 「この欄を標準に戻す」で、その欄の項目をまとめて標準に戻す
// 開いているかどうかは端末ごとの表示の設定として localStorage（toniq.more.<欄>）に保存する（曲には保存しない）

type MoreGroup = "basic" | "chord" | "parts" | "grow";

// 追加パート（設定タブの「追加パートを使う」でまとめて ON/OFF する。1つずつはアレンジャー・ミキサーで切り替える）
export const EXTRA_PARTS: LayerName[] = ["pad", "arp", "signature", "counter", "perc"];

// 標準から変えているか（data-std の名前 → 判定）
const GROW_PARTS: GrowPart[] = ["melody", "chord", "bass", "pad", "arp", "signature", "counter"];

function growChanged(part: GrowPart): boolean {
  const { preset, params } = storedGrowSound(part);
  return preset !== null || params !== null;
}

const CHANGED: Record<string, () => boolean> = {
  // メロディの音色は grow（初期値）とジャンルに合わせる（auto）が標準
  melodySound: () => !["grow", "auto"].includes(getState().melodyInstrument),
  swing:       () => getState().swing !== null,
  sidechain:   () => getState().sidechain !== null,
  scaleLock:   () => getState().scaleLock !== defaultState.scaleLock,
  chordRhythm: () => getState().chordRhythm !== defaultState.chordRhythm,
  chordSound:  () => getState().growChordPreset !== null,
  bassSub:     () => getState().bassSub !== null,
  fxType:      () => getState().fxType !== "auto",
  extraParts:  () => EXTRA_PARTS.some(p => getState().parts[p] !== defaultState.parts[p]),
};

// 欄ごとの変更の数（grow の欄は音作りを変えているパートの数）
function changedCount(group: MoreGroup, details: HTMLElement): number {
  if (group === "grow") return GROW_PARTS.filter(growChanged).length;
  return Array.from(details.querySelectorAll<HTMLElement>("[data-std]"))
    .filter(el => CHANGED[el.dataset.std!]?.()).length;
}

// 欄の項目を標準に戻す。再生し直しが要るか（音色は再生開始時に作るため）を返す
function resetGroup(group: MoreGroup): boolean {
  const s = getState();
  switch (group) {
    case "basic":
      if (CHANGED.melodySound()) setState({ melodyInstrument: defaultState.melodyInstrument });
      setState({ swing: null, sidechain: null });
      applySwing();
      return true;
    case "chord":
      setState({ scaleLock: defaultState.scaleLock, chordRhythm: defaultState.chordRhythm });
      if (CHANGED.chordSound()) setGrowSound("chord", null, null);
      return true;
    case "parts":
      for (const p of EXTRA_PARTS) {
        if (s.parts[p] !== defaultState.parts[p]) setLayerEnabled(p, defaultState.parts[p]);
      }
      setState({ bassSub: null, fxType: "auto" });
      return true;
    case "grow":
      for (const p of GROW_PARTS) if (growChanged(p)) setGrowSound(p, null, null);
      applyGrowLive();  // 鳴っている grow にすぐ当てる（作り直さない）
      return false;
  }
}

const storageKey = (group: string) => `toniq.more.${group}`;

function readOpen(group: string): boolean {
  try { return localStorage.getItem(storageKey(group)) === "open"; } catch { return false; }
}

function writeOpen(group: string, open: boolean): void {
  try { localStorage.setItem(storageKey(group), open ? "open" : "closed"); } catch { /* 保存できなくても開閉はできる */ }
}

function moreElements(): HTMLDetailsElement[] {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-screen="custom"] details[data-more]'));
}

// 印・変更の数・「標準に戻す」の状態を AppState にそろえる。
// 設定タブの操作はそれぞれの描画（CustomScreen.ts の render、GrowPanel.ts の renderPanel）から呼ぶ
export function renderCustomMore(): void {
  if (getState().screen !== "custom") return;
  for (const details of moreElements()) {
    const group = details.dataset.more as MoreGroup;
    details.querySelectorAll<HTMLElement>("[data-std]").forEach(el => {
      const changed = !!CHANGED[el.dataset.std!]?.();
      el.classList.toggle("is-changed", changed);
      if (changed) el.title = "標準から変えています";
      else el.removeAttribute("title");
    });
    const count = changedCount(group, details);
    const badge = details.querySelector<HTMLElement>(".panel-more-badge");
    if (badge) {
      badge.textContent = count > 0 ? `${count}件変更` : "標準";
      badge.classList.toggle("is-changed", count > 0);
    }
    const reset = details.querySelector<HTMLButtonElement>("[data-more-reset]");
    if (reset) reset.disabled = count === 0;
  }
}

// details は HTML（grow の欄は GrowPanel.ts が作る）にあるものを使うので、initGrowPanel のあとに呼ぶ。
// afterReset：標準に戻したあとの描画と、要るときの再生し直し（CustomScreen.ts から渡す）
export function initCustomMore(afterReset: (restart: boolean) => Promise<void>): void {
  for (const details of moreElements()) {
    const group = details.dataset.more as MoreGroup;
    details.open = readOpen(group);
    details.addEventListener("toggle", () => writeOpen(group, details.open));
    details.querySelector("[data-more-reset]")?.addEventListener("click", async () => {
      await afterReset(resetGroup(group));
    });
  }
}
