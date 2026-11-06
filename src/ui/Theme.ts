import { getState, setState, Theme, ThemeMode, Skin } from "../engine/AppState";

// 画面の配色（ライト／ダーク／OS に合わせる）と、カスタムモードのスキン（デフォルト／フラット／スタジオ／ポップ）の切り替え。
// どちらも曲データとは別に localStorage に保存する（配色が未保存か "system" なら OS の設定に合わせる）。
// 起動直後のちらつきを防ぐため、index.html の <head> でも同じキーを読んで先に data-theme / data-skin を付けている。
const STORAGE_KEY = "toniq.theme";
const SKIN_KEY    = "toniq.skin";

const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

function systemTheme(): Theme {
  return darkQuery?.matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): Theme {
  return mode === "system" ? systemTheme() : mode;
}

function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* 保存領域が使えないときは OS の設定に合わせる */ }
  return "system";
}

// 旧名で保存されたスキン（plugin → flat、daw → studio）も読めるようにする
const SKIN_ALIASES: Record<string, Skin> = {
  default: "default", flat: "flat", studio: "studio", pop: "pop",
  plugin:  "flat",    daw:  "studio",
};

function loadSkin(): Skin {
  try {
    const saved = localStorage.getItem(SKIN_KEY);
    if (saved && SKIN_ALIASES[saved]) return SKIN_ALIASES[saved];
  } catch { /* 保存領域が使えないときはデフォルトのスキン */ }
  return "default";
}

const listeners = new Set<() => void>();

// 配色・スキンが変わったときに呼ぶ（設定画面の表示をそろえる）
export function onAppearanceChange(fn: () => void): void {
  listeners.add(fn);
}

// AppState.theme を <html data-theme> とボタンの表示に反映する
function applyTheme(): void {
  const { theme } = getState();
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    const label = theme === "dark" ? "ライトモードにする" : "ダークモードにする";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
  listeners.forEach(fn => fn());
}

// AppState.skin を <html data-skin> に反映する（スキンは設定画面で選ぶ）
function applySkin(): void {
  document.documentElement.dataset.skin = getState().skin;
  listeners.forEach(fn => fn());
}

export function setThemeMode(themeMode: ThemeMode): void {
  setState({ themeMode, theme: resolveTheme(themeMode) });
  try { localStorage.setItem(STORAGE_KEY, themeMode); } catch { /* 保存できなくても表示は切り替える */ }
  applyTheme();
}

// ヘッダーのボタン：ライト／ダークを明示的に選ぶ
export function setTheme(theme: Theme): void {
  setThemeMode(theme);
}

export function setSkin(skin: Skin): void {
  setState({ skin });
  try { localStorage.setItem(SKIN_KEY, skin); } catch { /* 保存できなくても表示は切り替える */ }
  applySkin();
}

export function initTheme(): void {
  const themeMode = loadThemeMode();
  setState({ themeMode, theme: resolveTheme(themeMode), skin: loadSkin() });
  applyTheme();
  applySkin();

  // 「OS に合わせる」のときは、OS の配色が変わったら追従する
  darkQuery?.addEventListener?.("change", () => {
    if (getState().themeMode !== "system") return;
    setState({ theme: systemTheme() });
    applyTheme();
  });

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    setTheme(getState().theme === "dark" ? "light" : "dark");
  });
}
