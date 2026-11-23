import { getState } from "../engine/AppState";
import {
  loadGrow, isGrowLoaded, growParamList, growPresetNames, growPresetIds, currentGrowValues, growSettings, applyGrowLive,
  storedGrowSound, setGrowSound, standardGrowPreset, growPresetChoices, growCategoryName,
  formatGrowParam, growToNormalised, growFromNormalised, type GrowParamMeta, type GrowPart,
} from "../engine/Grow";
import { previewGrowSound, growKeyDown, growKeyUp, stopGrowKeys } from "../engine/GrowPreview";
import { onRender, render as renderAll } from "./Router";
import { renderCustomMore } from "./CustomMore";
import { typingKeyMidi } from "./TypingKeys";
import { isTyping, modalOpen } from "./SpaceKey";

// grow（テスト中）の音作りのパネル（カスタムモードの設定タブの下 #c-grow）。
// 暫定のパネルで、最終的にはプリセットを選ぶだけにする予定。
// パラメーターの並び・名前・範囲・表示は grow のコアの表（wasm）から作るので、ここでは持たない。
// 値はメロディが AppState.growPreset（プリセット）と growParams（変えた値。null = プリセットのまま）、
// コードが growChordPreset / growChordParams、ベース・パッド・アルペジオ・シグネチャー・カウンターメロディが growSounds（どのパートもプリセットの null = ジャンルの標準）。
// どのパートを編集するかはパネル上部の「対象」で切り替える。プリセットはカテゴリごとのチップの一覧で選ぶ
// （押すと選んで1音鳴らす。マウスを乗せると説明（Glossary.ts の sound.<ID>）。←→ で前後のプリセットへ送る）

const RANGE_STEPS = 1000;  // 連続値のつまみの細かさ（0〜1 の位置をこの数で刻む）

type LoadState = "idle" | "loading" | "ok" | "failed";
let loadState: LoadState = "idle";
let built = false;
// 編集している対象（表示上の一時的な状態。grow で鳴らしているパートのどれか）
let target: GrowPart = "melody";

const TARGET_LABELS: Record<GrowPart, string> = {
  melody: "メロディ", chord: "コード", bass: "ベース", pad: "パッド", arp: "アルペジオ", signature: "シグネチャー",
  counter: "カウンターメロディ",
};

// grow で鳴らしているパート（すべていつも grow）
function growTargets(): GrowPart[] {
  return ["melody", "counter", "chord", "bass", "pad", "arp", "signature"];
}

// ===== キーボードでの試し弾き（タイピングピアノ。TypingKeys.ts） =====
// カスタムモードの設定タブ・アレンジャータブで、パネルの「対象」のパートの今の音色（プリセット＋つまみ）を、押している間だけ鳴らす。
// ピアノロールのタブでは同じキーがメロディの入力になるので鳴らさない。
// 基準のオクターブはパートごとの表示上の一時的な状態（ベースは 2、それ以外は 4 から）。↓ / ↑ で切り替える
const KEY_OCTAVE_MIN = 1;
const KEY_OCTAVE_MAX = 6;
const keyOctaves: Partial<Record<GrowPart, number>> = {};
const pressed = new Map<string, number>();  // 押しているキー（code）→ 鳴らした MIDI ノート番号（離すときにオクターブが変わっていても同じ音を止める）

function keyOctave(): number {
  return keyOctaves[target] ?? (target === "bass" ? 2 : 4);
}

function keysActive(): boolean {
  const s = getState();
  return s.screen === "custom" && s.tab !== "pianoroll" && isGrowLoaded() && !modalOpen();
}

function releaseAllKeys(): void {
  pressed.clear();
  stopGrowKeys();
}

function onKeyDown(e: KeyboardEvent): void {
  if (!keysActive() || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    // つまみ・フェーダー・スライダーにフォーカスがあるときは、矢印はその値の変更に使う
    if ((e.target as HTMLElement | null)?.closest?.("input, select, [role=slider]")) return;
    e.preventDefault();
    const next = Math.max(KEY_OCTAVE_MIN, Math.min(KEY_OCTAVE_MAX, keyOctave() + (e.key === "ArrowDown" ? -1 : 1)));
    keyOctaves[target] = next;
    renderKeyHint();
    return;
  }
  const midi = typingKeyMidi(e.code, keyOctave());
  if (midi === null) return;
  e.preventDefault();
  if (e.repeat || pressed.has(e.code)) return;
  pressed.set(e.code, midi);
  void growKeyDown(target, midi);
}

function onKeyUp(e: KeyboardEvent): void {
  const midi = pressed.get(e.code);
  if (midi === undefined) return;
  pressed.delete(e.code);
  growKeyUp(midi);
}

function renderKeyHint(): void {
  const hint = document.getElementById("c-grow-keys");
  if (!hint) return;
  const o = keyOctave();
  hint.innerHTML = `⌨ キーボードで試し弾き：<kbd>Z</kbd>〜<kbd>/</kbd> が C${o}〜、<kbd>Q</kbd>〜<kbd>]</kbd> が C${o + 1}〜（<kbd>↓</kbd><kbd>↑</kbd> オクターブ）`;
}

// プリセットの一覧の「ジャンルの標準」の値
const STANDARD_VALUE = "";  // ID は空にならないので、空を「ジャンルの標準」に使う
// 今のプリセットの一覧の中身（作り直すかの判定用。innerHTML の文字列はブラウザが書き直すので比べない）
let presetsHtml = "";

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

// 1つのパラメーターの値を変える。曲には変えた値を全部まとめて持つ（プリセットを差し替えても音が変わらないように）
function setGrowValue(index: number, value: number): void {
  const values = currentGrowValues(target);
  if (!values) return;
  const map: Record<string, number> = {};
  growParamList().forEach(p => { map[p.id] = p.index === index ? value : values[p.index]; });
  setGrowSound(target, storedGrowSound(target).preset, map);
  applyGrowLive();
  renderPanel();
}

function controlHtml(p: GrowParamMeta): string {
  const name = escapeHtml(p.name);
  if (p.kind === "choice") {
    const options = p.choices.map((c, i) => `<option value="${p.min + i}">${escapeHtml(c)}</option>`).join("");
    return `<label class="grow-control"><span class="grow-name">${name}</span>
      <select class="select grow-select" data-grow-index="${p.index}">${options}</select></label>`;
  }
  if (p.kind === "toggle") {
    return `<label class="grow-control grow-toggle"><span class="grow-name">${name}</span>
      <input type="checkbox" data-grow-index="${p.index}"></label>`;
  }
  return `<label class="grow-control"><span class="grow-name">${name}</span>
    <input type="range" min="0" max="${RANGE_STEPS}" step="1" data-grow-index="${p.index}">
    <span class="grow-value" data-grow-value="${p.index}"></span></label>`;
}

// パネルの中身を作る（wasm を読み込んだあと1回だけ）
function build(): void {
  const panel = $("c-grow");
  const groups = new Map<string, GrowParamMeta[]>();
  growParamList().forEach(p => {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  });
  const modules = [...groups].map(([group, list]) => `
    <section class="grow-module">
      <h4 class="grow-module-title">${escapeHtml(group)}</h4>
      ${list.map(controlHtml).join("")}
    </section>`).join("");

  panel.querySelector(".grow-body")!.innerHTML = `
    <div class="grow-toolbar">
      <label class="grow-control grow-target"><span class="grow-name">対象</span>
        <select class="select" id="c-grow-target"></select></label>
      <button class="btn btn-small" id="c-grow-reset">プリセットに戻す</button>
      <span class="grow-edited" id="c-grow-edited"></span>
    </div>
    <div class="grow-presets" id="c-grow-presets" role="radiogroup" aria-label="プリセット"></div>
    <p class="grow-keys" id="c-grow-keys"></p>
    <div class="grow-grid">${modules}</div>`;

  ($("c-grow-target") as HTMLSelectElement).addEventListener("change", e => {
    target = (e.target as HTMLSelectElement).value as GrowPart;
    releaseAllKeys();
    renderPanel();
  });
  const presets = $("c-grow-presets");
  presets.addEventListener("click", e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-grow-preset]");
    if (chip) choosePreset(chip.dataset.growPreset!);
  });
  // ←→ で前後のプリセットへ送る（聴き比べ。↑↓ は試し弾きのオクターブのまま）
  presets.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const chips = Array.from(presets.querySelectorAll<HTMLElement>("[data-grow-preset]"));
    const now = chips.findIndex(c => c.classList.contains("is-active"));
    const next = chips[Math.max(0, Math.min(chips.length - 1, now + (e.key === "ArrowLeft" ? -1 : 1)))];
    e.preventDefault();
    if (next && next !== chips[now]) choosePreset(next.dataset.growPreset!);
  });
  $("c-grow-reset").addEventListener("click", () => {
    setGrowSound(target, storedGrowSound(target).preset, null);
    applyGrowLive();
    renderPanel();
  });

  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-grow-index]").forEach(el => {
    const index = Number(el.dataset.growIndex);
    if (el instanceof HTMLSelectElement) {
      el.addEventListener("change", () => setGrowValue(index, Number(el.value)));
    } else if (el.type === "checkbox") {
      el.addEventListener("change", () => setGrowValue(index, el.checked ? 1 : 0));
    } else {
      el.addEventListener("input", () => setGrowValue(index, growFromNormalised(index, Number(el.value) / RANGE_STEPS)));
    }
  });
  built = true;
}

// プリセットを選ぶ（チップを押す・←→）。選んだ音色を1音鳴らす（曲の再生中は鳴らさず、鳴っている音にすぐ当てる）。
// 今のプリセットをもう一度押したときは鳴らすだけ（つまみで変えた値は消さない）
function choosePreset(value: string): void {
  if (value !== activePresetValue()) {
    setGrowSound(target, value === STANDARD_VALUE ? null : value, null);
    applyGrowLive();
    renderPanel();
    // 一覧を作り直したとき（「その他」がなくなったなど）も、選んだチップにフォーカスを戻す（続けて ←→ で送れるように）
    $("c-grow-presets").querySelector<HTMLElement>(`[data-grow-preset="${value}"]`)?.focus();
  }
  void previewGrowSound(target);
}

// 今選んでいるプリセットの一覧の値（ジャンルの標準なら STANDARD_VALUE）
function activePresetValue(): string {
  const stored = storedGrowSound(target);
  return stored.preset === null ? STANDARD_VALUE : growPresetIds()[growSettings(target).preset] ?? "";
}

// プリセットの一覧の中身：「ジャンルの標準」（今のジャンルの標準のプリセット名を添える）と、
// 対象のパートで選べるカテゴリ（Grow.ts の PART_CATEGORIES）＋初期化のプリセットをカテゴリの行ごとにチップで並べる。
// ほかのカテゴリのプリセットを選んでいる曲（以前はどのプリセットでも選べた）は、その音を「その他」に足す
function presetChipsHtml(selected: string | null): string {
  const ids = growPresetIds(), names = growPresetNames();
  const chip = (value: string, label: string, term = "") =>
    `<button type="button" class="grow-chip" role="radio" aria-checked="false" data-grow-preset="${escapeHtml(value)}"${term}>${escapeHtml(label)}</button>`;
  const preset = (i: number) => chip(ids[i], names[i], ` data-term="sound.${escapeHtml(ids[i])}"`);
  // 行の名前には用語の説明（Glossary.ts の growCategory.<カテゴリ>）を付ける
  const row = (name: string, term: string, chips: string) =>
    `<div class="grow-preset-group"><span class="grow-preset-group-name" data-term="growCategory.${term}">${escapeHtml(name)}</span><div class="grow-chips">${chips}</div></div>`;
  const groups = growPresetChoices(target, true);
  const listed = new Set(groups.flatMap(g => g.presets));
  const selectedIndex = selected === null ? -1 : ids.indexOf(selected);
  const others = selectedIndex >= 0 && !listed.has(selectedIndex) ? [selectedIndex] : [];
  return row("標準", "standard", chip(STANDARD_VALUE, `ジャンルの標準（${names[standardGrowPreset(target)] ?? ""}）`, ` data-term="sound.auto"`))
    + groups.map(g => row(growCategoryName(g.category), g.category, g.presets.map(preset).join(""))).join("")
    + (others.length ? row("その他", "other", others.map(preset).join("")) : "");
}

// 値の表示を AppState にそろえる（曲の内容は書き換えない）
function renderPanel(): void {
  const values = currentGrowValues(target);
  if (!values) return;
  const settings = growSettings(target);
  const stored   = storedGrowSound(target);
  const targets  = growTargets();
  const panel = $("c-grow");

  const targetSelect = $("c-grow-target") as HTMLSelectElement;
  targetSelect.innerHTML = targets.map(t => `<option value="${t}">${TARGET_LABELS[t]}</option>`).join("");
  targetSelect.value = target;

  const presets = $("c-grow-presets");
  const html = presetChipsHtml(stored.preset);
  if (presetsHtml !== html) {
    presets.innerHTML = html;
    presetsHtml = html;
  }
  const active = activePresetValue();
  presets.querySelectorAll<HTMLElement>("[data-grow-preset]").forEach(chip => {
    const on = chip.dataset.growPreset === active;
    chip.classList.toggle("is-active", on);
    chip.setAttribute("aria-checked", String(on));
  });
  ($("c-grow-reset") as HTMLButtonElement).disabled = settings.params === null;
  $("c-grow-edited").textContent = settings.params === null ? "" : "プリセットから変更しています";

  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-grow-index]").forEach(el => {
    const index = Number(el.dataset.growIndex);
    const value = values[index];
    if (el instanceof HTMLSelectElement) el.value = String(value);
    else if (el.type === "checkbox") el.checked = value > 0.5;
    else if (document.activeElement !== el) el.value = String(Math.round(growToNormalised(index, value) * RANGE_STEPS));
  });
  panel.querySelectorAll<HTMLElement>("[data-grow-value]").forEach(el => {
    const index = Number(el.dataset.growValue);
    el.textContent = formatGrowParam(index, values[index]);
  });
  renderKeyHint();
  renderCustomMore();  // 「grow の音作り」の欄の変更の数
}

function render(): void {
  const s = getState();
  // 試し弾きを鳴らせない画面・タブへ移ったら、押したままの音を止める
  if (!keysActive() && pressed.size > 0) releaseAllKeys();
  if (s.screen !== "custom") return;
  const panel = $("c-grow");
  panel.hidden = false;  // パッド・アルペジオ・シグネチャーはいつも grow なので、いつも出す
  const targets = growTargets();
  if (!targets.includes(target)) {
    target = targets[0];
    releaseAllKeys();
  }

  if (loadState === "idle") {
    loadState = "loading";
    void loadGrow().then(ok => {
      loadState = ok ? "ok" : "failed";
      renderAll();
    });
  }

  const status = $("c-grow-status");
  status.textContent =
    loadState === "failed"  ? "grow の wasm（public/grow/grow.wasm）がありません。npm run grow:wasm でビルドしてください。それまでメロディはジャンルの標準の音色、コードはソフトパッド、ベース・パッド・アルペジオ・シグネチャー・FX / SE は Tone.js の音色で鳴ります。"
    : loadState === "loading" ? "grow を読み込んでいます…"
    : "テスト中の暫定のパネルです。最終的にはプリセットを選ぶだけになる予定です。";

  if (!isGrowLoaded()) return;
  if (!built) build();
  renderPanel();
}

export function initGrowPanel(): void {
  // 「もっと調整」と同じ畳める欄にする（開閉・変更の数・標準に戻すは CustomMore.ts）
  $("c-grow").innerHTML = `
    <details class="panel-more grow-more" data-more="grow">
      <summary class="panel-more-summary"><span class="panel-more-label"><span data-term="grow">grow</span> の音作り（テスト中）</span><span class="panel-more-items">パートごとのプリセット・つまみ</span><span class="panel-more-badge"></span></summary>
      <div class="panel-more-body">
        <p class="grow-status" id="c-grow-status"></p>
        <div class="grow-body"></div>
        <div class="panel-more-foot"><button class="btn btn-small" data-more-reset>すべてのパートをジャンルの標準に戻す</button></div>
      </div>
    </details>`;
  onRender(render);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  // ウィンドウを離れると keyup が届かないので、押したままの音を止める
  window.addEventListener("blur", releaseAllKeys);
}
