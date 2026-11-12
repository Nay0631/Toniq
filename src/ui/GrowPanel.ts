import { getState } from "../engine/AppState";
import {
  loadGrow, isGrowLoaded, growParamList, growPresetNames, growPresetIds, currentGrowValues, growSettings, applyGrowLive,
  storedGrowSound, setGrowSound, standardGrowPreset,
  formatGrowParam, growToNormalised, growFromNormalised, type GrowParamMeta, type GrowPart,
} from "../engine/Grow";
import { onRender, render as renderAll } from "./Router";

// grow（テスト中）の音作りのパネル（カスタムモードの設定タブの下 #c-grow）。
// 暫定のパネルで、最終的にはプリセットを選ぶだけにする予定。
// パラメーターの並び・名前・範囲・表示は grow のコアの表（wasm）から作るので、ここでは持たない。
// 値はメロディが AppState.growPreset（プリセット）と growParams（変えた値。null = プリセットのまま）、
// コードが growChordPreset / growChordParams、ベース・パッド・アルペジオ・シグネチャーが growSounds（どのパートもプリセットの null = ジャンルの標準）。
// どのパートを編集するかはパネル上部の「対象」で切り替える（メロディは音色が grow のときだけ選べる）

const RANGE_STEPS = 1000;  // 連続値のつまみの細かさ（0〜1 の位置をこの数で刻む）

type LoadState = "idle" | "loading" | "ok" | "failed";
let loadState: LoadState = "idle";
let built = false;
// 編集している対象（表示上の一時的な状態。grow で鳴らしているパートのどれか）
let target: GrowPart = "melody";

const TARGET_LABELS: Record<GrowPart, string> = {
  melody: "メロディ", chord: "コード", bass: "ベース", pad: "パッド", arp: "アルペジオ", signature: "シグネチャー",
};

// grow で鳴らしているパート（メロディ以外はいつも grow）
function growTargets(): GrowPart[] {
  const list: GrowPart[] = [];
  if (getState().melodyInstrument === "grow") list.push("melody");
  list.push("chord", "bass", "pad", "arp", "signature");
  return list;
}

// プリセットのセレクトの「ジャンルの標準」の値
const STANDARD_VALUE = "";  // ID は空にならないので、空を「ジャンルの標準」に使う

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
  const ids = growPresetIds();
  const presets = growPresetNames().map((n, i) => `<option value="${escapeHtml(ids[i])}">${escapeHtml(n)}</option>`).join("");
  const modules = [...groups].map(([group, list]) => `
    <section class="grow-module">
      <h4 class="grow-module-title">${escapeHtml(group)}</h4>
      ${list.map(controlHtml).join("")}
    </section>`).join("");

  panel.querySelector(".grow-body")!.innerHTML = `
    <div class="grow-toolbar">
      <label class="grow-control grow-preset"><span class="grow-name">対象</span>
        <select class="select" id="c-grow-target"></select></label>
      <label class="grow-control grow-preset"><span class="grow-name">プリセット</span>
        <select class="select" id="c-grow-preset">
          <option value="${STANDARD_VALUE}" id="c-grow-standard"></option>${presets}
        </select></label>
      <button class="btn btn-small" id="c-grow-reset">プリセットに戻す</button>
      <span class="grow-edited" id="c-grow-edited"></span>
    </div>
    <div class="grow-grid">${modules}</div>`;

  ($("c-grow-target") as HTMLSelectElement).addEventListener("change", e => {
    target = (e.target as HTMLSelectElement).value as GrowPart;
    renderPanel();
  });
  ($("c-grow-preset") as HTMLSelectElement).addEventListener("change", e => {
    const value = (e.target as HTMLSelectElement).value;
    setGrowSound(target, value === STANDARD_VALUE ? null : value, null);
    applyGrowLive();
    renderPanel();
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

  // 「ジャンルの標準」は今のジャンルの標準のプリセット名を添える
  const standard = $("c-grow-standard") as HTMLOptionElement;
  standard.textContent = `ジャンルの標準（${growPresetNames()[standardGrowPreset(target)] ?? ""}）`;
  ($("c-grow-preset") as HTMLSelectElement).value = stored.preset === null ? STANDARD_VALUE : growPresetIds()[settings.preset] ?? "";
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
}

function render(): void {
  const s = getState();
  if (s.screen !== "custom") return;
  const panel = $("c-grow");
  panel.hidden = false;  // パッド・アルペジオ・シグネチャーはいつも grow なので、いつも出す
  const targets = growTargets();
  if (!targets.includes(target)) target = targets[0];

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
  $("c-grow").innerHTML = `
    <div class="panel-title"><span data-term="grow">grow</span>（テスト中）</div>
    <p class="grow-status" id="c-grow-status"></p>
    <div class="grow-body"></div>`;
  onRender(render);
}
