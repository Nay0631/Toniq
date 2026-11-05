import { getState, setState, Theme, Skin } from "../engine/AppState";

// 画面の配色（ライト／ダーク）と、カスタムモードのスキン（プラグイン風／DAW 風）の切り替え。
// どちらも曲データとは別に localStorage に保存する（配色が未保存なら OS の設定に合わせる）。
// 起動直後のちらつきを防ぐため、index.html の <head> でも同じキーを読んで先に data-theme / data-skin を付けている。
const STORAGE_KEY = "toniq.theme";
const SKIN_KEY    = "toniq.skin";

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* 保存領域が使えないときは OS の設定に合わせる */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function loadSkin(): Skin {
  try {
    if (localStorage.getItem(SKIN_KEY) === "daw") return "daw";
  } catch { /* 保存領域が使えないときは標準のスキン */ }
  return "plugin";
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
}

// AppState.skin を <html data-skin> とスキン切り替えボタンの表示に反映する
function applySkin(): void {
  const { skin } = getState();
  document.documentElement.dataset.skin = skin;
  document.querySelectorAll<HTMLElement>("[data-skin-option]").forEach(btn => {
    const on = btn.dataset.skinOption === skin;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

export function setTheme(theme: Theme): void {
  setState({ theme });
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* 保存できなくても表示は切り替える */ }
  applyTheme();
}

export function setSkin(skin: Skin): void {
  setState({ skin });
  try { localStorage.setItem(SKIN_KEY, skin); } catch { /* 保存できなくても表示は切り替える */ }
  applySkin();
}

export function initTheme(): void {
  setState({ theme: loadTheme(), skin: loadSkin() });
  applyTheme();
  applySkin();
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    setTheme(getState().theme === "dark" ? "light" : "dark");
  });
  document.querySelectorAll<HTMLElement>("[data-skin-option]").forEach(btn =>
    btn.addEventListener("click", () => setSkin(btn.dataset.skinOption as Skin)));
}
