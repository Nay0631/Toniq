// ミキサー（パート別音量）。カスタムモードのアレンジャータブに置く（設定タブには置かない）。
// 1パート＝1チャンネルストリップ（パートの色・名前、ON/OFF の電源ボタン、フェーダー、レベルメーター、値）と、
// 右端にマスターのレベルメーター。メーターは再生中だけ実際の音量（Tone.Meter）を表示する。
import { getState } from "../engine/AppState";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import { setVolume, getPartLevels } from "../engine/VolumeManager";
import { getMasterLevel } from "../engine/MixerEngine";
import * as Playback from "../engine/Playback";
import { attachFader, syncControls } from "./Controls";

// パートの並び（UI 表示名）
const MIXER_PARTS: { name: LayerName; label: string }[] = [
  { name: "melody",    label: "メロディ" },
  { name: "chord",     label: "コード" },
  { name: "drum",      label: "ドラム" },
  { name: "bass",      label: "ベース" },
  { name: "pad",       label: "パッド" },
  { name: "arp",       label: "アルペジオ" },
  { name: "signature", label: "シグネチャー" },
  { name: "fx",        label: "FX/SE" },
];

// フェーダー横の目盛り（音量 0〜100 の位置と dB。VolumeManager の toDb と同じ換算）
const SCALE = [
  { value: 100,  label: "0" },
  { value: 50,   label: "-6" },
  { value: 25,   label: "-12" },
  { value: 0,    label: "-∞" },
];

// メーターの表示範囲（dB）
const METER_FLOOR = -48;
const METER_TOP   = 0;
// メーターが下がる速さ（1秒あたりの割合）と、ピーク表示を止めておく時間（ms）
const FALL_PER_SEC = 1.6;
const PEAK_HOLD_MS = 900;

const MASTER = "master";

let lists: HTMLElement[] = [];
let onChangeCb: () => void = () => {};

// 表示中のメーターの値（パート名 / master → 0〜1）
const meterState: Record<string, { level: number; peak: number; peakAt: number }> = {};
let rafId = 0;
let lastFrame = 0;
let lastReadout = 0;

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
      <span class="mixer-body">
        <input type="range" class="range" min="0" max="100" step="1">
        ${meterHtml()}
      </span>
      <span class="lcd mixer-value"></span>`;
    const chName = ch.querySelector<HTMLElement>(".mixer-ch-name")!;
    chName.textContent  = p.label;
    chName.dataset.term = p.name;  // 用語のツールチップ（パート名は Glossary.ts の TERMS のキーと同じ）
    // （名前に用語の説明を出すので、チャンネル全体の title は付けない）
    list.appendChild(ch);
    attachFader(ch.querySelector<HTMLInputElement>("input")!, `${p.label}の音量`);
  }

  const master = document.createElement("div");
  master.className = "mixer-ch mixer-master";
  master.dataset.meter = MASTER;
  master.innerHTML = `
    <span class="mixer-ch-head"><span class="mixer-ch-name">マスター</span></span>
    <span class="mixer-power-space"></span>
    <span class="mixer-body">${meterHtml()}${meterHtml()}</span>
    <span class="lcd mixer-value mixer-master-db">-∞</span>`;
  list.appendChild(master);

  // フェーダー（隠した range の input イベント）
  list.addEventListener("input", e => {
    const input = e.target as HTMLInputElement;
    const ch    = input.closest<HTMLElement>("[data-part]");
    if (!ch) return;
    setVolume(ch.dataset.part!, parseInt(input.value));
    ch.querySelector(".mixer-value")!.textContent = input.value;
  });

  // 電源ボタン：パートの ON/OFF
  list.addEventListener("click", e => {
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
  for (const list of lists) {
    for (const p of MIXER_PARTS) {
      const ch    = list.querySelector<HTMLElement>(`[data-part="${p.name}"]`)!;
      const range = ch.querySelector<HTMLInputElement>("input")!;
      const on    = s.parts[p.name];
      ch.classList.toggle("is-off", !on);
      if (document.activeElement !== range) range.value = String(s.volumes[p.name]);
      ch.querySelector(".mixer-value")!.textContent = String(s.volumes[p.name]);
      const power = ch.querySelector<HTMLElement>(".mixer-power")!;
      power.setAttribute("aria-pressed", String(on));
      power.setAttribute("aria-label", `${p.label}を${on ? "OFF" : "ON"}にする`);
      power.querySelector(".mixer-power-text")!.textContent = on ? "ON" : "OFF";
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
  for (const list of lists) {
    const ch = list.querySelector<HTMLElement>(key === MASTER ? `[data-meter="${MASTER}"]` : `[data-part="${key}"]`);
    ch?.querySelectorAll<HTMLElement>(".meter").forEach(m => {
      m.style.setProperty("--lv", level.toFixed(3));
      m.style.setProperty("--pk", peak.toFixed(3));
      m.classList.toggle("has-peak", peak > 0.001);
    });
  }
}

function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const playing = Playback.isPlaying();
  const levels: Record<string, number> = playing
    ? { ...getPartLevels(), [MASTER]: getMasterLevel() }
    : {};

  let moving = playing;
  for (const key of [...MIXER_PARTS.map(p => p.name as string), MASTER]) {
    const st = meterState[key] ??= { level: 0, peak: 0, peakAt: 0 };
    // パートが OFF のときは 0 として扱う
    const off    = key !== MASTER && !getState().parts[key as LayerName];
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

  // マスターの数値（dB）は読みやすいよう 0.1 秒ごとに更新
  if (now - lastReadout > 100) {
    lastReadout = now;
    const db = levels[MASTER];
    const text = playing && Number.isFinite(db) && db > METER_FLOOR ? db.toFixed(1) : "-∞";
    for (const list of lists) {
      const el = list.querySelector(".mixer-master-db");
      if (el) el.textContent = text;
    }
  }

  rafId = moving ? requestAnimationFrame(tick) : 0;
}
