import { getState, setState, applySimpleToCustom, Screen, Tab } from "../engine/AppState";
import { stopMetronome } from "../engine/Metronome";
import { stopScalePreview } from "../engine/ScalePreview";
import { isPlaying, stop, stopSample } from "../engine/Playback";

// 画面ごとのパンくず表示（メニュー画面は表示しない）
const SCREEN_TITLES: Record<Screen, string> = {
  menu:      "メニュー",
  simple:    "シンプルモード",
  custom:    "カスタムモード",
  musiclist: "ミュージックリスト",
  quiz:      "音楽クイズ",
  settings:  "設定",
  rating:    "メロディの評価",
};

const TAB_TITLES: Record<Tab, string> = { settings: "設定", arranger: "アレンジャー", pianoroll: "ピアノロール" };

// パンくずの1段（screen / tab があれば押してそこへ移れる。最後の段は今いる場所で押せない）
interface Crumb {
  label:   string;
  screen?: Screen;
  tab?:    Tab;
}

// 今いる場所までの道すじ。メニュー › 画面 ›（タブ・表示）
function crumbsFor(): Crumb[] {
  const s = getState();
  const crumbs: Crumb[] = [{ label: SCREEN_TITLES.menu, screen: "menu" }];
  switch (s.screen) {
    case "simple":
      // 設定タブは、生成前なら「設定」、生成後なら「生成した曲」
      crumbs.push({ label: SCREEN_TITLES.simple, screen: "simple", tab: "settings" });
      if (s.tab === "pianoroll") {
        if (s.generated) crumbs.push({ label: "生成した曲", screen: "simple", tab: "settings" });
        crumbs.push({ label: TAB_TITLES.pianoroll });
      } else {
        crumbs.push({ label: s.generated ? "生成した曲" : "設定" });
      }
      break;
    case "custom":
      crumbs.push({ label: SCREEN_TITLES.custom, screen: "custom", tab: "settings" }, { label: TAB_TITLES[s.tab] });
      break;
    case "musiclist":
      crumbs.push({ label: SCREEN_TITLES.musiclist }, { label: s.musicListView === "files" ? "書き出したファイル" : "保存した曲" });
      break;
    case "rating":
      // メロディの評価は設定画面の「開発用」から開く
      crumbs.push({ label: SCREEN_TITLES.settings, screen: "settings" }, { label: SCREEN_TITLES.rating });
      break;
    default:
      crumbs.push({ label: SCREEN_TITLES[s.screen] });
  }
  // 最後の段は今いる場所なので押せなくする
  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}

export function renderBreadcrumb(): void {
  const trail = document.getElementById("breadcrumb-trail");
  if (!trail) return;
  const crumbs = crumbsFor();
  trail.replaceChildren(...crumbs.map((crumb, i) => {
    const li = document.createElement("li");
    li.className = i === 0 ? "breadcrumb-item breadcrumb-home" : "breadcrumb-item";
    if (crumb.screen) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "breadcrumb-link";
      btn.textContent = i === 0 ? `‹ ${crumb.label}に戻る` : crumb.label;
      btn.dataset.crumbScreen = crumb.screen;
      if (crumb.tab) btn.dataset.crumbTab = crumb.tab;
      li.append(btn);
    } else {
      const span = document.createElement("span");
      span.className = "breadcrumb-current";
      span.textContent = crumb.label;
      if (i === crumbs.length - 1) span.setAttribute("aria-current", "page");
      li.append(span);
    }
    return li;
  }));
}

// 各画面モジュールが登録する描画関数
const renderers: (() => void)[] = [];

export function onRender(fn: () => void): void {
  renderers.push(fn);
}

// 画面が切り替わるときに呼ぶ関数（画面を離れるときの後片付けなど。切り替え前の画面と次の画面を渡す）
const screenChangeHandlers: ((prev: Screen, next: Screen) => void)[] = [];

export function onScreenChange(fn: (prev: Screen, next: Screen) => void): void {
  screenChangeHandlers.push(fn);
}

// パンくずの「‹ メニューに戻る」を押したときの確かめ（保存していない曲の保存など。MusicListScreen が登録する）。
// false を返したら戻らない。循環 import を避けるため、Router は中身を知らずに呼ぶだけにする
let menuGuard: (() => Promise<boolean>) | null = null;

export function setMenuGuard(fn: () => Promise<boolean>): void {
  menuGuard = fn;
}

// タブのある画面（離れたときのタブを覚えておき、戻ったときに同じタブを開く）
const SCREENS_WITH_TABS: Screen[] = ["simple", "custom"];

// 画面を切り替える。表示状態は AppState.screen だけで管理する
export function showScreen(screen: Screen): void {
  const { screen: prev, tab, screenTabs } = getState();
  if (prev !== screen) screenChangeHandlers.forEach(fn => fn(prev, screen));
  // 画面を移ったら曲の再生も止める（メニューに戻ったとき・ピアノロールからほかの画面へ移ったときに鳴り続けないように）
  if (prev !== screen && isPlaying()) stop();
  stopMetronome();     // BPM のクリック音は画面を離れたら止める
  stopScalePreview();  // キー・スケールの試聴も止める
  stopSample();     // ジャンルのサンプルも止める（差し替えていたパターンを元に戻す）
  if (screen === "custom" && getState().mode === "simple") {
    // シンプルモードで決めた値をカスタムモードへ引き継ぐ
    applySimpleToCustom();
  } else if (screen === "simple") {
    setState({ mode: "simple" });
  }
  // 離れる画面のタブを覚え、行き先の画面は前に開いていたタブで開く（初めてなら設定タブ）
  const tabs = prev !== screen && SCREENS_WITH_TABS.includes(prev) ? { ...screenTabs, [prev]: tab } : screenTabs;
  const nextTab = prev === screen ? tab : (tabs[screen] ?? "settings");
  setState({ screen, tab: nextTab, screenTabs: tabs });
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

  // パンくずはメニュー以外のすべての画面で表示する
  const breadcrumb = document.getElementById("breadcrumb");
  if (breadcrumb) breadcrumb.hidden = screen === "menu";
  if (screen !== "menu") renderBreadcrumb();

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

  // パンくずの段を押すと、その画面（・タブ）へ移る
  document.getElementById("breadcrumb-trail")?.addEventListener("click", async e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-crumb-screen]");
    if (!btn) return;
    const screen = btn.dataset.crumbScreen as Screen;
    if (screen === "menu" && menuGuard && !await menuGuard()) return;
    if (screen !== getState().screen) showScreen(screen);
    const tab = btn.dataset.crumbTab as Tab | undefined;
    if (tab && tab !== getState().tab) showTab(tab);
  });

  render();
}
