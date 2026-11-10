import { getState, Skin, ThemeMode, NoteNames } from "../engine/AppState";
import type { DrumSource } from "../engine/SynthFactory";
import { setThemeMode, setSkin, onAppearanceChange } from "./Theme";
import { setTooltips } from "./Glossary";
import { setNoteNames, setLoopPlayback, setDrumSource, setToniqSynthEnabled } from "./Preferences";
import { onRender, render as renderAll } from "./Router";

// 設定画面：配色・カスタムモードのスキン・音名の表記・ループ再生・ドラムの音源・Toniq シンセ（テスト中）・用語のツールチップ。
// 値は AppState に置き、保存は Theme.ts（配色・スキン）／Preferences.ts（音名・ループ・ドラムの音源・Toniq シンセ）／
// Glossary.ts（ツールチップ）が localStorage に行う（曲には保存しない）

const SKIN_DESCRIPTIONS: Record<Skin, string> = {
  default: "ほかの画面と同じ、すっきりした見た目です。",
  flat:    "シンセサイザーのプラグインのような、フラットなグレーの見た目です。",
  studio:  "音楽制作ソフト（DAW）のような、少し暗いスタジオ風の見た目です。",
  pop:     "パートごとに色分けした、にぎやかなグルーヴボックス風の見た目です。",
};

function setActive(attr: string, value: string): void {
  document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach(btn => {
    const on = btn.getAttribute(attr) === value;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-checked", String(on));
  });
}

function setSwitch(id: string, on: boolean): void {
  const el = document.getElementById(id)!;
  el.classList.toggle("is-on", on);
  el.setAttribute("aria-checked", String(on));
}

function render(): void {
  const s = getState();
  if (s.screen !== "settings") return;

  setActive("data-theme-mode", s.themeMode);
  setActive("data-settings-skin", s.skin);
  document.getElementById("settings-skin-desc")!.textContent = SKIN_DESCRIPTIONS[s.skin];
  setActive("data-settings-notes", s.noteNames);
  setActive("data-settings-drum-source", s.drumSource);
  setSwitch("settings-loop", s.loopPlayback);
  setSwitch("settings-tooltips", s.tooltips);
  setSwitch("settings-toniq-synth", s.toniqSynthEnabled);
}

function onClick(attr: string, fn: (value: string) => void): void {
  document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach(btn =>
    btn.addEventListener("click", () => fn(btn.getAttribute(attr)!)));
}

export function initSettingsScreen(): void {
  onRender(render);
  // ヘッダーのボタン・OS の配色の変化・カスタムモードのスキン切り替えも表示にそろえる
  onAppearanceChange(render);

  onClick("data-theme-mode",    v => setThemeMode(v as ThemeMode));
  onClick("data-settings-skin", v => setSkin(v as Skin));
  // 音名はピアノロールなど他の画面にも出るので、アプリ全体を描き直す
  onClick("data-settings-notes", v => { setNoteNames(v as NoteNames); renderAll(); });
  onClick("data-settings-drum-source", v => {
    void setDrumSource(v as DrumSource);
    render();
  });

  document.getElementById("settings-loop")?.addEventListener("click", () => {
    setLoopPlayback(!getState().loopPlayback);
    render();
  });
  document.getElementById("settings-tooltips")?.addEventListener("click", () => {
    setTooltips(!getState().tooltips);
    render();
  });
  // Toniq シンセ（テスト中）：カスタムモードの音色の選択肢・音作りのパネルも出し入れするので全体を描き直す
  document.getElementById("settings-toniq-synth")?.addEventListener("click", () => {
    setToniqSynthEnabled(!getState().toniqSynthEnabled);
    renderAll();
  });
}
