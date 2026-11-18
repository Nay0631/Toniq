// ミキサー（パート別音量）。カスタムモードのアレンジャータブに置く（設定タブには置かない）。
// 1パート＝1チャンネルストリップ（パートの色・名前、ON/OFF の電源ボタン、ソロのボタン（Solo.ts。アレンジャー・ピアノロールと共通）、定位（パン）のノブ、フェーダー、レベルメーター、値）と、
// 右端にマスターのメーター（左右のピーク）・クリップの印・再生を始めてからの最大のピーク。
// メーターは再生中だけ実際の音量を表示する（パートは Tone.Meter の平均の大きさ、マスターはリミッターのあとのサンプルのピーク）。
import { getState } from "../engine/AppState";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import { setVolume, setPan, getPartLevels } from "../engine/VolumeManager";
import { getMasterPeaks } from "../engine/MixerEngine";
import { dbToVolume, panLabel } from "../engine/VolumeCurve";
import * as Playback from "../engine/Playback";
import { attachFader, attachKnob, syncControls } from "./Controls";
import { soloPart, toggleSolo } from "./Solo";

// パートの並び（UI 表示名）
const MIXER_PARTS: { name: LayerName; label: string }[] = [
  { name: "melody",    label: "メロディ" },
  { name: "counter",   label: "カウンター" },
  { name: "chord",     label: "コード" },
  { name: "drum",      label: "ドラム" },
  { name: "perc",      label: "パーカス" },
  { name: "bass",      label: "ベース" },
  { name: "pad",       label: "パッド" },
  { name: "arp",       label: "アルペジオ" },
  { name: "signature", label: "シグネチャー" },
  { name: "fx",        label: "FX/SE" },
];

// フェーダー横の目盛り（dB と、その音量になるフェーダーの位置。換算は VolumeCurve.ts：75 で 0dB、100 で +5dB）
const SCALE = [
  { value: 100,             label: "+5" },
  { value: dbToVolume(0),   label: "0" },
  { value: dbToVolume(-6),  label: "-6" },
  { value: dbToVolume(-12), label: "-12" },
  { value: dbToVolume(-24), label: "-24" },
  { value: 0,               label: "-∞" },
];

// 定位（パン）のノブの刻み。−100（左）〜100（右）
const PAN_STEP = 5;

// メーターの表示範囲（dB）
const METER_FLOOR = -48;
const METER_TOP   = 0;
// メーターが下がる速さ（1秒あたりの割合）と、ピーク表示を止めておく時間（ms）
const FALL_PER_SEC = 1.6;
const PEAK_HOLD_MS = 900;

// マスターのピークがここ（dBFS）に届いたらクリップの印を付ける（0dB を超えると書き出した音が割れる）
const CLIP_DB = -0.1;

// マスターのメーター（左・右）
const MASTER_KEYS = ["masterL", "masterR"];

let lists: HTMLElement[] = [];
let onChangeCb: () => void = () => {};

// 表示中のメーターの値（パート名 / master → 0〜1）
const meterState: Record<string, { level: number; peak: number; peakAt: number }> = {};
let rafId = 0;
let lastFrame = 0;
let lastReadout = 0;
// マスターの、再生を始めてからの最大のピーク（dB）とクリップしたか。次の再生の開始か、印・数値のクリックで消す
let heldPeak = -Infinity;
let clipped  = false;
let wasPlaying = false;

function toRatio(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_FLOOR) / (METER_TOP - METER_FLOOR)));
}

function meterHtml(): string {
  return `<span class="meter" aria-hidden="true"><span class="meter-cover"></span><span class="meter-peak"></span></span>`;
}

function scaleHtml(): string {
  return SCALE.map(s =>
    `<span class="mixer-scale-label" style="--v:${s.value / 100}">${s.label}</span>`).join("");
}

function build(list: HTMLElement): void {
  // 左端の dB 目盛り（チャンネルと同じ縦の並びにして、フェーダーの位置と高さをそろえる）
  const scale = document.createElement("div");
  scale.className = "mixer-ch mixer-scale";
  scale.setAttribute("aria-hidden", "true");
  scale.innerHTML = `
    <span class="mixer-ch-head"><span class="mixer-ch-name">dB</span></span>
    <span class="mixer-power-space"></span>
    <span class="mixer-solo-space"></span>
    <span class="mixer-pan-space"></span>
    <span class="mixer-body">${scaleHtml()}</span>
    <span class="mixer-value-space"></span>`;
  list.appendChild(scale);

  for (const p of MIXER_PARTS) {
    const ch = document.createElement("div");
    ch.className = "mixer-ch";
    ch.dataset.part = p.name;
    ch.innerHTML = `
      <span class="mixer-ch-head"><span class="mixer-color mix-${p.name}"></span><span class="mixer-ch-name"></span></span>
      <button class="mixer-power" data-mixer-toggle="${p.name}"><span class="mixer-power-led"></span><span class="mixer-power-text"></span></button>
      <button class="mixer-solo" data-mixer-solo="${p.name}" aria-pressed="false">SOLO</button>
      <span class="mixer-pan" title="定位（パン）。ダブルクリックで中央">
        <input type="range" class="range" data-mixer-pan min="-100" max="100" step="${PAN_STEP}">
        <span class="mixer-pan-value"></span>
      </span>
      <span class="mixer-body">
        <input type="range" class="range" data-mixer-volume min="0" max="100" step="1">
        ${meterHtml()}
      </span>
      <span class="lcd mixer-value"></span>`;
    const chName = ch.querySelector<HTMLElement>(".mixer-ch-name")!;
    chName.textContent  = p.label;
    chName.dataset.term = p.name;  // 用語のツールチップ（パート名は Glossary.ts の TERMS のキーと同じ）
    // （名前に用語の説明を出すので、チャンネル全体の title は付けない）
    list.appendChild(ch);
    attachFader(ch.querySelector<HTMLInputElement>("[data-mixer-volume]")!, `${p.label}の音量`);
    attachKnob(ch.querySelector<HTMLInputElement>("[data-mixer-pan]")!, `${p.label}の定位（パン）`);
  }

  const master = document.createElement("div");
  master.className = "mixer-ch mixer-master";
  master.dataset.meter = "master";
  master.innerHTML = `
    <span class="mixer-ch-head"><span class="mixer-ch-name">マスター</span></span>
    <span class="mixer-power-space"></span>
    <span class="mixer-solo-space"></span>
    <button type="button" class="mixer-clip" data-mixer-clip aria-label="クリップの印を消す"
      title="音が大きすぎて割れる（クリップ）と赤く点きます。クリックで消えます">CLIP</button>
    <span class="mixer-body">${meterHtml()}${meterHtml()}</span>
    <button type="button" class="lcd mixer-value mixer-master-db" data-mixer-clip aria-label="最大のピークを消す"
      title="再生を始めてからの最大のピーク（dB）。クリックで消えます">-∞</button>`;
  list.appendChild(master);

  // フェーダー・パンのノブ（隠した range の input イベント）
  list.addEventListener("input", e => {
    const input = e.target as HTMLInputElement;
    const ch    = input.closest<HTMLElement>("[data-part]");
    if (!ch) return;
    const value = parseInt(input.value, 10);
    if (input.matches("[data-mixer-pan]")) {
      setPan(ch.dataset.part!, value);
      ch.querySelector(".mixer-pan-value")!.textContent = panLabel(value);
    } else {
      setVolume(ch.dataset.part!, value);
      ch.querySelector(".mixer-value")!.textContent = input.value;
    }
  });

  // パンのノブをダブルクリックすると中央に戻す
  list.addEventListener("dblclick", e => {
    const input = (e.target as HTMLElement).closest(".mixer-pan")?.querySelector<HTMLInputElement>("[data-mixer-pan]");
    if (!input || input.value === "0") return;
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    syncControls();
  });

  // 電源ボタン：パートの ON/OFF。マスターのクリップの印・最大のピーク：クリックで消す
  list.addEventListener("click", e => {
    if ((e.target as HTMLElement).closest("[data-mixer-clip]")) {
      resetPeakHold();
      return;
    }
    // ソロのボタン：そのパートだけ ON にする。もう一度押すとソロにする前の ON/OFF に戻す
    const solo = (e.target as HTMLElement).closest<HTMLElement>("[data-mixer-solo]");
    if (solo) {
      toggleSolo(solo.dataset.mixerSolo as LayerName);
      onChangeCb();
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-mixer-toggle]");
    if (!btn) return;
    const part = btn.dataset.mixerToggle as LayerName;
    setLayerEnabled(part, !getState().parts[part]);
    onChangeCb();
  });
}

/** ミキサーを作る。listIds はミキサーを置く要素の id、onChange はパートの ON/OFF を変えたあとの再描画 */
export function initMixer(listIds: string[], onChange: () => void): void {
  onChangeCb = onChange;
  lists = listIds
    .map(id => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null);
  lists.forEach(build);
  renderMixer();
}

/** AppState（音量・パートの ON/OFF）に合わせて表示を更新する */
export function renderMixer(): void {
  const s = getState();
  const soloing = soloPart();
  for (const list of lists) {
    for (const p of MIXER_PARTS) {
      const ch    = list.querySelector<HTMLElement>(`[data-part="${p.name}"]`)!;
      const range = ch.querySelector<HTMLInputElement>("[data-mixer-volume]")!;
      const pan   = ch.querySelector<HTMLInputElement>("[data-mixer-pan]")!;
      const on    = s.parts[p.name];
      ch.classList.toggle("is-off", !on);
      if (document.activeElement !== range) range.value = String(s.volumes[p.name]);
      ch.querySelector(".mixer-value")!.textContent = String(s.volumes[p.name]);
      pan.value = String(s.pans[p.name]);
      ch.querySelector(".mixer-pan-value")!.textContent = panLabel(s.pans[p.name]);
      const power = ch.querySelector<HTMLElement>(".mixer-power")!;
      power.setAttribute("aria-pressed", String(on));
      power.setAttribute("aria-label", `${p.label}を${on ? "OFF" : "ON"}にする`);
      power.querySelector(".mixer-power-text")!.textContent = on ? "ON" : "OFF";
      const solo = ch.querySelector<HTMLElement>(".mixer-solo")!;
      solo.setAttribute("aria-pressed", String(soloing === p.name));
      solo.setAttribute("aria-label", soloing === p.name
        ? `${p.label}のソロをやめる（元の ON/OFF に戻す）` : `${p.label}だけを鳴らす（ソロ）`);
      solo.title = soloing === p.name ? "もう一度押すと元の ON/OFF に戻します" : "このパートだけを鳴らします（ほかのパートは OFF）";
    }
  }
  syncControls();

  // 再生が始まったらメーターを動かす（止まったあとは下がりきるまで動かす）
  if (Playback.isPlaying() && rafId === 0) {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

// ===== レベルメーター =====

function setMeter(key: string, level: number, peak: number): void {
  const master = MASTER_KEYS.indexOf(key);  // マスターは左右のメーターを別々に動かす
  for (const list of lists) {
    const ch = list.querySelector<HTMLElement>(master >= 0 ? "[data-meter]" : `[data-part="${key}"]`);
    ch?.querySelectorAll<HTMLElement>(".meter").forEach((m, i) => {
      if (master >= 0 && i !== master) return;
      m.style.setProperty("--lv", level.toFixed(3));
      m.style.setProperty("--pk", peak.toFixed(3));
      m.classList.toggle("has-peak", peak > 0.001);
    });
  }
}

// マスターの最大のピークとクリップの印を表示にそろえる
function renderPeakHold(): void {
  const text = Number.isFinite(heldPeak) && heldPeak > METER_FLOOR ? heldPeak.toFixed(1) : "-∞";
  for (const list of lists) {
    const master = list.querySelector<HTMLElement>("[data-meter]");
    if (!master) continue;
    master.classList.toggle("is-clip", clipped);
    master.querySelector(".mixer-master-db")!.textContent = text;
  }
}

function resetPeakHold(): void {
  heldPeak = -Infinity;
  clipped  = false;
  renderPeakHold();
}

function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const playing = Playback.isPlaying();
  if (playing && !wasPlaying) resetPeakHold();  // 再生を始めるたびに、最大のピークとクリップの印を消す
  wasPlaying = playing;

  const levels: Record<string, number> = playing ? { ...getPartLevels() } : {};
  if (playing) {
    const [left, right] = getMasterPeaks();
    levels.masterL = left;
    levels.masterR = right;
    const top = Math.max(left, right);
    if (top > heldPeak) heldPeak = top;
    if (top >= CLIP_DB) clipped = true;
  }

  let moving = playing;
  for (const key of [...MIXER_PARTS.map(p => p.name as string), ...MASTER_KEYS]) {
    const st = meterState[key] ??= { level: 0, peak: 0, peakAt: 0 };
    // パートが OFF のときは 0 として扱う
    const off    = !MASTER_KEYS.includes(key) && !getState().parts[key as LayerName];
    const target = off ? 0 : toRatio(levels[key] ?? -Infinity);

    // 上がるときはすぐ、下がるときはゆっくり
    st.level = Math.max(target, st.level - FALL_PER_SEC * dt);
    if (st.level >= st.peak) {
      st.peak = st.level;
      st.peakAt = now;
    } else if (now - st.peakAt > PEAK_HOLD_MS) {
      st.peak = Math.max(st.level, st.peak - FALL_PER_SEC * 0.5 * dt);
    }
    if (st.level > 0.001 || st.peak > 0.001) moving = true;
    setMeter(key, st.level, st.peak);
  }

  // マスターの数値（最大のピーク。dB）とクリップの印は読みやすいよう 0.1 秒ごとに更新（止めたあとも消さずに残す）
  if (now - lastReadout > 100) {
    lastReadout = now;
    renderPeakHold();
  }

  rafId = moving ? requestAnimationFrame(tick) : 0;
}
