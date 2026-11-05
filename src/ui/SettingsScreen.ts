import { getState, Skin, ThemeMode } from "../engine/AppState";
import { setThemeMode, setSkin, onAppearanceChange } from "./Theme";
import { setTooltips } from "./Glossary";
import { onRender } from "./Router";

// 設定画面：配色・カスタムモードのスキン・用語のツールチップ。
// 値は AppState に置き、保存はそれぞれ Theme.ts / Glossary.ts が localStorage に行う（曲には保存しない）

const SKIN_DESCRIPTIONS: Record<Skin, string> = {
  default: "ほかの画面と同じ、すっきりした見た目です。",
  flat:    "シンセサイザーのプラグインのような、フラットなグレーの見た目です。",
  studio:  "音楽制作ソフト（DAW）のような、少し暗いスタジオ風の見た目です。",
  pop:     "パートごとに色分けした、にぎやかなグルーヴボックス風の見た目です。",
};

function setActive(selector: string, attr: string, value: string): void {
  document.querySelectorAll<HTMLElement>(selector).forEach(btn => {
    const on = btn.getAttribute(attr) === value;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-checked", String(on));
  });
}

function render(): void {
  const s = getState();
  if (s.screen !== "settings") return;

  setActive("[data-theme-mode]", "data-theme-mode", s.themeMode);
  setActive("[data-settings-skin]", "data-settings-skin", s.skin);
  document.getElementById("settings-skin-desc")!.textContent = SKIN_DESCRIPTIONS[s.skin];

  const tooltips = document.getElementById("settings-tooltips")!;
  tooltips.classList.toggle("is-on", s.tooltips);
  tooltips.setAttribute("aria-checked", String(s.tooltips));
}

export function initSettingsScreen(): void {
  onRender(render);
  // ヘッダーのボタン・OS の配色の変化・カスタムモードのスキン切り替えも表示にそろえる
  onAppearanceChange(render);

  document.querySelectorAll<HTMLElement>("[data-theme-mode]").forEach(btn =>
    btn.addEventListener("click", () => setThemeMode(btn.dataset.themeMode as ThemeMode)));
  document.querySelectorAll<HTMLElement>("[data-settings-skin]").forEach(btn =>
    btn.addEventListener("click", () => setSkin(btn.dataset.settingsSkin as Skin)));
  document.getElementById("settings-tooltips")?.addEventListener("click", () => {
    setTooltips(!getState().tooltips);
    render();
  });
}
