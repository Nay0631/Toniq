import * as Tone from "tone";
import { getState, setState } from "../engine/AppState";
import {
  TONIQ_PRESETS, matchingPreset, formatParam,
  type ToniqSynthParams, type ToniqKnobKey,
} from "../engine/ToniqSynth";
import { applyToniqSynthLive, previewToniqPhrase, isToniqPreviewOn, stopToniqPreview } from "../engine/MelodyPlayer";
import { scaleSemitones } from "../data/degree_resolver";
import * as Playback from "../engine/Playback";
import { attachKnob, syncControls } from "./Controls";

// Toniq シンセ（テスト中）の音作りのパネル（カスタムモードの設定タブの下、#c-toniq）。
// 設定画面で ON のときだけ出す。値は AppState.toniqSynth に置き、変えるとすぐ鳴っている音にも当てる

type Ctl =
  | { key: ToniqKnobKey; label: string; kind: "knob" }
  | { key: keyof ToniqSynthParams; label: string; kind: "select"; options: [string, string][] };

interface Module {
  title: string;
  term?: string;  // 用語のツールチップ（Glossary.ts の TERMS）
  controls: Ctl[];
}

const WAVES: [string, string][] = [["sawtooth", "ノコギリ"], ["square", "矩形"], ["triangle", "三角"], ["sine", "サイン"]];
const knob = (key: ToniqKnobKey, label: string): Ctl => ({ key, label, kind: "knob" });

const MODULES: Module[] = [
  { title: "OSC 1", term: "oscillator", controls: [
    { key: "osc1Wave", label: "波形", kind: "select", options: WAVES },
    knob("osc1Level", "音量"),
  ] },
  { title: "OSC 2", term: "oscillator", controls: [
    { key: "osc2Wave", label: "波形", kind: "select", options: WAVES },
    { key: "osc2Octave", label: "オクターブ", kind: "select",
      options: [["-2", "-2"], ["-1", "-1"], ["0", "0"], ["1", "+1"], ["2", "+2"]] },
    knob("osc2Level", "音量"),
    knob("osc2Detune", "ずらし"),
  ] },
  { title: "ボイス", term: "unison", controls: [
    knob("subLevel", "サブ"),
    knob("noiseLevel", "ノイズ"),
    knob("unison", "ユニゾン"),
    knob("spread", "広がり"),
    knob("glide", "グライド"),
  ] },
  { title: "フィルター", term: "filter", controls: [
    { key: "filterType", label: "種類", kind: "select",
      options: [["lowpass", "ローパス"], ["highpass", "ハイパス"], ["bandpass", "バンドパス"]] },
    knob("cutoff", "カットオフ"),
    knob("resonance", "レゾナンス"),
    knob("envAmount", "EG の量"),
  ] },
  { title: "フィルター EG", term: "envelope", controls: [
    knob("fAttack", "A"), knob("fDecay", "D"), knob("fSustain", "S"), knob("fRelease", "R"),
  ] },
  { title: "アンプ EG", term: "envelope", controls: [
    knob("attack", "A"), knob("decay", "D"), knob("sustain", "S"), knob("release", "R"),
  ] },
  { title: "LFO", term: "lfo", controls: [
    { key: "lfoTarget", label: "行き先", kind: "select",
      options: [["off", "OFF"], ["pitch", "音の高さ"], ["filter", "フィルター"], ["amp", "音量"]] },
    knob("lfoRate", "速さ"),
    knob("lfoDepth", "深さ"),
  ] },
  { title: "エフェクト・出力", controls: [
    knob("drive", "ドライブ"),
    knob("chorus", "コーラス"),
    knob("delay", "ディレイ"),
    knob("level", "レベル"),
  ] },
];

// 数値の項目（オクターブはセレクトで選ぶが値は数）
const NUMERIC_SELECTS = new Set<keyof ToniqSynthParams>(["osc2Octave"]);

let onInstrumentChange: () => Promise<void> = async () => {};
let previewEndTimer: ReturnType<typeof setTimeout> | null = null;

const $ = (id: string) => document.getElementById(id);

function build(root: HTMLElement): void {
  const modules = MODULES.map(m => `
    <div class="toniq-module">
      <div class="toniq-module-title">${m.term ? `<span data-term="${m.term}">${m.title}</span>` : m.title}</div>
      <div class="toniq-controls">
        ${m.controls.map(c => c.kind === "knob" ? `
          <div class="toniq-ctl">
            <span class="toniq-ctl-label">${c.label}</span>
            <input type="range" class="range" id="tq-${c.key}" min="0" max="100" step="1" aria-label="${m.title} ${c.label}">
            <span class="lcd toniq-value" id="tq-${c.key}-value"></span>
          </div>` : `
          <label class="toniq-ctl toniq-ctl-select">
            <span class="toniq-ctl-label">${c.label}</span>
            <select class="select" id="tq-${c.key}" aria-label="${m.title} ${c.label}">
              ${c.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
            </select>
          </label>`).join("")}
      </div>
    </div>`).join("");

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
    <div class="toniq-grid">${modules}</div>
    <p class="toniq-hint" id="tq-hint"></p>`;
}

function update(partial: Partial<ToniqSynthParams>): void {
  setState({ toniqSynth: { ...getState().toniqSynth, ...partial } });
  applyToniqSynthLive();
  renderToniqSynthPanel();
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

export function renderToniqSynthPanel(): void {
  const s = getState();
  const root = $("c-toniq");
  if (!root) return;
  root.hidden = !s.toniqSynthEnabled;
  if (s.screen !== "custom" || !s.toniqSynthEnabled) return;

  const p = s.toniqSynth;
  for (const m of MODULES) {
    for (const c of m.controls) {
      const el = $(`tq-${c.key}`) as HTMLInputElement | HTMLSelectElement;
      if (document.activeElement !== el) el.value = String(p[c.key]);
      if (c.kind === "knob") $(`tq-${c.key}-value`)!.textContent = formatParam(c.key, p[c.key]);
    }
  }
  syncControls();

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

  for (const m of MODULES) {
    for (const c of m.controls) {
      const el = $(`tq-${c.key}`) as HTMLInputElement | HTMLSelectElement;
      if (c.kind === "knob") {
        attachKnob(el as HTMLInputElement, `${m.title} ${c.label}`, "sm");
        el.addEventListener("input", () => update({ [c.key]: parseInt(el.value) }));
      } else {
        el.addEventListener("change", () => update({
          [c.key]: NUMERIC_SELECTS.has(c.key) ? parseInt(el.value) : el.value,
        } as Partial<ToniqSynthParams>));
      }
    }
  }

  $("tq-preset")!.addEventListener("change", e => {
    const preset = TONIQ_PRESETS.find(p => p.id === (e.target as HTMLSelectElement).value);
    if (preset) update({ ...preset.params });
  });
  $("tq-preview")!.addEventListener("click", () => void togglePreview());
  $("tq-use")!.addEventListener("click", async () => {
    setState({ melodyInstrument: "toniq" });
    await onInstrumentChange();
  });


}
