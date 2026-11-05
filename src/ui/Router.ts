import { getState, setState, applySimpleToCustom, Screen, Tab } from "../engine/AppState";
import { stopMetronome } from "../engine/Metronome";
import { stopSample } from "../engine/Playback";

// 画面ごとのパンくず表示（メニュー画面は表示しない）
const SCREEN_TITLES: Record<Screen, string> = {
  menu:      "",
  simple:    "シンプルモード",
  custom:    "カスタムモード",
  musiclist: "ミュージックリスト",
  quiz:      "音楽クイズ",
  settings:  "設定",
};

// 各画面モジュールが登録する描画関数
const renderers: (() => void)[] = [];

export function onRender(fn: () => void): void {
  renderers.push(fn);
}

// 画面を切り替える。表示状態は AppState.screen だけで管理する
export function showScreen(screen: Screen): void {
  stopMetronome();  // BPM のクリック音は画面を離れたら止める
  stopSample();     // ジャンルのサンプルも止める（差し替えていたパターンを元に戻す）
  if (screen === "custom" && getState().mode === "simple") {
    // シンプルモードで決めた値をカスタムモードへ引き継ぐ
    applySimpleToCustom();
  } else if (screen === "simple") {
    setState({ mode: "simple" });
  }
  setState({ screen, tab: "settings" });
  render();
}

export function showTab(tab: Tab): void {
  setState({ tab });
  render();
}

// AppState に合わせて DOM を更新する
export function render(): void {
  const { screen, tab } = getState();

  document.querySelectorAll<HTMLElement>("[data-screen]").forEach(el => {
    el.hidden = el.dataset.screen !== screen;
  });

  // タブ（各画面の中にある data-tab / data-tab-panel）
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach(el => {
    el.hidden = el.dataset.tabPanel !== tab;
  });

  // パンくず（「メニューに戻る」と画面名）はメニュー以外のすべての画面で表示する
  const breadcrumb = document.getElementById("breadcrumb");
  const crumbTitle = document.getElementById("breadcrumb-title");
  if (breadcrumb) breadcrumb.hidden = screen === "menu";
  if (crumbTitle) crumbTitle.textContent = SCREEN_TITLES[screen];

  renderers.forEach(fn => fn());
}

// 画面遷移に関わるUIイベントを登録する
export function initRouter(): void {
  // data-goto 属性を持つ要素で画面を切り替える
  document.querySelectorAll<HTMLElement>("[data-goto]").forEach(el => {
    el.addEventListener("click", () => showScreen(el.dataset.goto as Screen));
  });

  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab as Tab));
  });

  render();
}
