import * as Tone from "tone";
import { getState, setState } from "../engine/AppState";
import {
  TONIQ_PRESETS, matchingPreset, formatParam, cloneToniqSynth,
  type ToniqSynthParams, type ToniqLayerParams, type ToniqLayerKnobKey, type ToniqGlobalKnobKey,
} from "../engine/ToniqSynth";
import { applyToniqSynthLive, previewToniqPhrase, isToniqPreviewOn, stopToniqPreview } from "../engine/MelodyPlayer";
import { scaleSemitones } from "../data/degree_resolver";
import * as Playback from "../engine/Playback";
import { attachKnob, syncControls } from "./Controls";

// grow（Toniq の内部シンセサイザー。画面上は旧名の「Toniq シンセ」。テスト中）の音作りのパネル（カスタムモードの設定タブの下、#c-toniq）。
// 設定画面で ON のときだけ出す。値は AppState.toniqSynth に置き、変えるとすぐ鳴っている音にも当てる。
// 上段はレイヤーごとの音作り（A / B のタブで切り替え、同じノブで編集中のレイヤーを動かす）、下段は両方のレイヤーで共通の LFO・エフェクト・出力

type LayerCtl =
  | { key: ToniqLayerKnobKey; label: string; kind: "knob" }
  | { key: keyof ToniqLayerParams; label: string; kind: "select"; options: [string, string][] };
type GlobalCtl =
  | { key: ToniqGlobalKnobKey; label: string; kind: "knob" }
  | { key: keyof ToniqSynthParams; label: string; kind: "select"; options: [string, string][] };

interface Module<C> {
  title: string;
  term?: string;  // 用語のツールチップ（Glossary.ts の TERMS）
  controls: C[];
}

const WAVES: [string, string][] = [["sawtooth", "ノコギリ"], ["square", "矩形"], ["triangle", "三角"], ["sine", "サイン"]];
const OCTAVES: [string, string][] = [["-2", "-2"], ["-1", "-1"], ["0", "0"], ["1", "+1"], ["2", "+2"]];
const lknob = (key: ToniqLayerKnobKey, label: string): LayerCtl => ({ key, label, kind: "knob" });
const gknob = (key: ToniqGlobalKnobKey, label: string): GlobalCtl => ({ key, label, kind: "knob" });

const LAYER_MODULES: Module<LayerCtl>[] = [
  { title: "レイヤー", term: "synthLayer", controls: [
    { key: "octave", label: "オクターブ", kind: "select", options: OCTAVES },
    lknob("volume", "音量"),
  ] },
  { title: "OSC 1", term: "oscillator", controls: [
    { key: "osc1Wave", label: "波形", kind: "select", options: WAVES },
    lknob("osc1Level", "音量"),
  ] },
  { title: "OSC 2", term: "oscillator", controls: [
    { key: "osc2Wave", label: "波形", kind: "select", options: WAVES },
    { key: "osc2Octave", label: "オクターブ", kind: "select", options: OCTAVES },
    lknob("osc2Level", "音量"),
    lknob("osc2Detune", "ずらし"),
  ] },
  { title: "サブ・ノイズ", controls: [
    lknob("subLevel", "サブ"),
    lknob("noiseLevel", "ノイズ"),
  ] },
  { title: "ユニゾン", term: "unison", controls: [
    lknob("unison", "枚数"),
    lknob("spread", "デチューン"),
    lknob("width", "ステレオ幅"),
  ] },
  { title: "フィルター", term: "filter", controls: [
    { key: "filterType", label: "種類", kind: "select",
      options: [["lowpass", "ローパス"], ["highpass", "ハイパス"], ["bandpass", "バンドパス"]] },
    lknob("cutoff", "カットオフ"),
    lknob("resonance", "レゾナンス"),
    lknob("envAmount", "EG の量"),
  ] },
  { title: "フィルター EG", term: "envelope", controls: [
    lknob("fAttack", "A"), lknob("fDecay", "D"), lknob("fSustain", "S"), lknob("fRelease", "R"),
  ] },
  { title: "アンプ EG", term: "envelope", controls: [
    lknob("attack", "A"), lknob("decay", "D"), lknob("sustain", "S"), lknob("release", "R"),
  ] },
];

const GLOBAL_MODULES: Module<GlobalCtl>[] = [
  { title: "LFO", term: "lfo", controls: [
    { key: "lfoTarget", label: "行き先", kind: "select",
      options: [["off", "OFF"], ["pitch", "音の高さ"], ["filter", "フィルター"], ["amp", "音量"]] },
    gknob("lfoRate", "速さ"),
    gknob("lfoDepth", "深さ"),
  ] },
  { title: "エフェクト", controls: [
    gknob("drive", "ドライブ"),
    gknob("chorus", "コーラス"),
    gknob("delay", "ディレイ"),
  ] },
  { title: "演奏・出力", controls: [
    gknob("glide", "グライド"),
    gknob("level", "レベル"),
  ] },
];

// 数値の項目（オクターブはセレクトで選ぶが値は数）
const NUMERIC_SELECTS = new Set<string>(["octave", "osc2Octave"]);
const LAYER_NAMES = ["A", "B"];

let onInstrumentChange: () => Promise<void> = async () => {};
let previewEndTimer: ReturnType<typeof setTimeout> | null = null;
// 編集中のレイヤー（0 = A、1 = B。表示上の一時的な状態）
let editingLayer = 0;

const $ = (id: string) => document.getElementById(id);
const layerId  = (key: string) => `tq-L-${key}`;
const globalId = (key: string) => `tq-${key}`;

function controlHtml(c: LayerCtl | GlobalCtl, id: string, title: string): string {
  return c.kind === "knob" ? `
    <div class="toniq-ctl">
      <span class="toniq-ctl-label">${c.label}</span>
      <input type="range" class="range" id="${id}" min="0" max="100" step="1" aria-label="${title} ${c.label}">
      <span class="lcd toniq-value" id="${id}-value"></span>
    </div>` : `
    <label class="toniq-ctl toniq-ctl-select">
      <span class="toniq-ctl-label">${c.label}</span>
      <select class="select" id="${id}" aria-label="${title} ${c.label}">
        ${c.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
      </select>
    </label>`;
}

function modulesHtml<C extends LayerCtl | GlobalCtl>(modules: Module<C>[], idOf: (key: string) => string): string {
  return modules.map(m => `
    <div class="toniq-module">
      <div class="toniq-module-title">${m.term ? `<span data-term="${m.term}">${m.title}</span>` : m.title}</div>
      <div class="toniq-controls">
        ${m.controls.map(c => controlHtml(c, idOf(c.key), m.title)).join("")}
      </div>
    </div>`).join("");
}

function build(root: HTMLElement): void {
  root.innerHTML = `
    <div class="toniq-head">
      <div class="panel-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12h3l2-7 4 14 4-14 2 7h5"/>
        </svg>
        <span data-term="toniqSynth">Toniq シンセ</span>
        <span class="toniq-badge">テスト中</span>
      </div>
      <label class="toniq-preset">
        <span class="toniq-ctl-label">プリセット</span>
        <select class="select" id="tq-preset" aria-label="Toniq シンセのプリセット">
          ${TONIQ_PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join("")}
          <option value="" disabled>カスタム</option>
        </select>
      </label>
      <button class="btn btn-small" id="tq-preview" title="今の音色で、今のキー・スケールの短いフレーズを鳴らします">▷ 試聴</button>
      <button class="btn btn-small" id="tq-use"></button>
    </div>
    <div class="toniq-layer-bar">
      <span class="toniq-section-label" data-term="synthLayer">レイヤー</span>
      <div class="toniq-layer-tabs" role="tablist">
        ${LAYER_NAMES.map((n, i) => `<button class="btn btn-small toniq-layer-tab" role="tab" data-layer="${i}">${n}</button>`).join("")}
      </div>
      <button class="btn btn-small toniq-layer-on" id="tq-layer-on" title="レイヤー B を重ねて鳴らすかどうか"></button>
      <span class="toniq-layer-note" id="tq-layer-note"></span>
    </div>
    <div class="toniq-grid">${modulesHtml(LAYER_MODULES, layerId)}</div>
    <div class="toniq-section-label toniq-section-common">共通（両方のレイヤー）</div>
    <div class="toniq-grid toniq-grid-common">${modulesHtml(GLOBAL_MODULES, globalId)}</div>
    <p class="toniq-hint" id="tq-hint"></p>`;
}

function commit(next: ToniqSynthParams): void {
  setState({ toniqSynth: next });
  applyToniqSynthLive();
  renderToniqSynthPanel();
}

function updateGlobal(partial: Partial<ToniqSynthParams>): void {
  commit({ ...cloneToniqSynth(getState().toniqSynth), ...partial });
}

function updateLayer(index: number, partial: Partial<ToniqLayerParams>): void {
  const next = cloneToniqSynth(getState().toniqSynth);
  next.layers[index] = { ...next.layers[index], ...partial };
  commit(next);
}

// 試聴のフレーズ：今のキー・スケールで 1-3-5-8-5-3-1（主音は C4〜B4 → F#4 より上なら1オクターブ下げる）
function phrase(): [string, number][] {
  const s = getState();
  const steps = scaleSemitones(s.chordPattern?.base_scale ?? "minor");
  let root = Tone.Frequency(`${s.key}4`).toMidi();
  if (root > 66) root -= 12;
  const at = (i: number) => {
    const octave = Math.floor(i / steps.length);
    return Tone.Frequency(root + 12 * octave + steps[i % steps.length], "midi").toNote();
  };
  const degrees: [number, number][] = [[0, 0.5], [2, 0.5], [4, 0.5], [7, 1], [4, 0.5], [2, 0.5], [0, 2]];
  return degrees.map(([d, beats]) => [at(d), beats]);
}

async function togglePreview(): Promise<void> {
  if (previewEndTimer) clearTimeout(previewEndTimer);
  if (isToniqPreviewOn()) {
    stopToniqPreview();
    renderToniqSynthPanel();
    return;
  }
  Playback.stop();  // 曲の再生とは重ねない
  const sec = await previewToniqPhrase(phrase(), getState().bpm);
  renderToniqSynthPanel();
  previewEndTimer = setTimeout(renderToniqSynthPanel, sec * 1000 + 100);
}

function setControlValue(id: string, kind: "knob" | "select", key: string, value: number | string): void {
  const el = $(id) as HTMLInputElement | HTMLSelectElement;
  if (document.activeElement !== el) el.value = String(value);
  if (kind === "knob") $(`${id}-value`)!.textContent = formatParam(key as ToniqLayerKnobKey, value as number);
}

export function renderToniqSynthPanel(): void {
  const s = getState();
  const root = $("c-toniq");
  if (!root) return;
  root.hidden = !s.toniqSynthEnabled;
  if (s.screen !== "custom" || !s.toniqSynthEnabled) return;

  const p = s.toniqSynth;
  const layer = p.layers[editingLayer];
  for (const m of LAYER_MODULES) {
    for (const c of m.controls) setControlValue(layerId(c.key), c.kind, c.key, layer[c.key] as number | string);
  }
  for (const m of GLOBAL_MODULES) {
    for (const c of m.controls) setControlValue(globalId(c.key), c.kind, c.key, p[c.key] as number | string);
  }
  syncControls();

  // レイヤーのタブ・B の ON/OFF
  const bOn = p.layers[1].on;
  root.querySelectorAll<HTMLButtonElement>(".toniq-layer-tab").forEach(tab => {
    const i = Number(tab.dataset.layer);
    const active = i === editingLayer;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.classList.toggle("is-muted", i === 1 && !bOn);
  });
  const onBtn = $("tq-layer-on") as HTMLButtonElement;
  onBtn.textContent = bOn ? "B：ON" : "B：OFF";
  onBtn.classList.toggle("is-active", bOn);
  $("tq-layer-note")!.textContent = editingLayer === 0
    ? "A は常に鳴ります。B を ON にすると、別に作った音を重ねられます。"
    : bOn ? "B を A に重ねて鳴らしています。" : "B は OFF です（音を作っておいて、ON にすると重なります）。";

  ($("tq-preset") as HTMLSelectElement).value = matchingPreset(p)?.id ?? "";

  const preview = $("tq-preview")!;
  const on = isToniqPreviewOn();
  preview.textContent = on ? "■ 停止" : "▷ 試聴";
  preview.classList.toggle("is-active", on);

  const using = s.melodyInstrument === "toniq";
  const use = $("tq-use") as HTMLButtonElement;
  use.textContent = using ? "✓ メロディで使用中" : "メロディに使う";
  use.classList.toggle("is-active", using);
  use.disabled = using;
  $("tq-hint")!.textContent = using
    ? "ノブを回すと、再生中のメロディにもすぐ反映されます。値は曲と一緒に保存されます。"
    : "今はメロディの音色が別のものになっています。「メロディに使う」を押すか、基本設定の「インスト」で Toniq シンセを選ぶと曲で鳴ります。";
}

/** options.onInstrumentChange：「メロディに使う」でメロディの音色を変えたあとに呼ぶ（画面の描き直し・再生し直し） */
export function initToniqSynthPanel(options: { onInstrumentChange: () => Promise<void> }): void {
  onInstrumentChange = options.onInstrumentChange;
  const root = $("c-toniq");
  if (!root) return;
  build(root);

  const parse = (key: string, el: HTMLInputElement | HTMLSelectElement, kind: "knob" | "select") =>
    kind === "knob" || NUMERIC_SELECTS.has(key) ? parseInt(el.value) : el.value;

  for (const m of LAYER_MODULES) {
    for (const c of m.controls) {
      const el = $(layerId(c.key)) as HTMLInputElement | HTMLSelectElement;
      if (c.kind === "knob") attachKnob(el as HTMLInputElement, `${m.title} ${c.label}`, "sm");
      el.addEventListener(c.kind === "knob" ? "input" : "change", () =>
        updateLayer(editingLayer, { [c.key]: parse(c.key, el, c.kind) } as Partial<ToniqLayerParams>));
    }
  }
  for (const m of GLOBAL_MODULES) {
    for (const c of m.controls) {
      const el = $(globalId(c.key)) as HTMLInputElement | HTMLSelectElement;
      if (c.kind === "knob") attachKnob(el as HTMLInputElement, `${m.title} ${c.label}`, "sm");
      el.addEventListener(c.kind === "knob" ? "input" : "change", () =>
        updateGlobal({ [c.key]: parse(c.key, el, c.kind) } as Partial<ToniqSynthParams>));
    }
  }

  root.querySelectorAll<HTMLButtonElement>(".toniq-layer-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      editingLayer = Number(tab.dataset.layer);
      renderToniqSynthPanel();
    });
  });
  $("tq-layer-on")!.addEventListener("click", () => {
    const on = !getState().toniqSynth.layers[1].on;
    if (on) editingLayer = 1;  // ON にしたら B の音作りを開く
    updateLayer(1, { on });
  });

  $("tq-preset")!.addEventListener("change", e => {
    const preset = TONIQ_PRESETS.find(p => p.id === (e.target as HTMLSelectElement).value);
    if (preset) commit(cloneToniqSynth(preset.params));
  });
  $("tq-preview")!.addEventListener("click", () => void togglePreview());
  $("tq-use")!.addEventListener("click", async () => {
    setState({ melodyInstrument: "toniq" });
    await onInstrumentChange();
  });
}
