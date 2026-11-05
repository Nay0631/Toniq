import { getState, setState, Theme } from "../engine/AppState";

// 画面の配色（ライト／ダーク）の切り替え。
// 選んだ配色は曲データとは別に localStorage に保存する（未保存なら OS の設定に合わせる）。
// 起動直後のちらつきを防ぐため、index.html の <head> でも同じキーを読んで先に data-theme を付けている。
const STORAGE_KEY = "toniq.theme";

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* 保存領域が使えないときは OS の設定に合わせる */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

export function setTheme(theme: Theme): void {
  setState({ theme });
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* 保存できなくても表示は切り替える */ }
  applyTheme();
}

export function initTheme(): void {
  setState({ theme: loadTheme() });
  applyTheme();
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    setTheme(getState().theme === "dark" ? "light" : "dark");
  });
}
