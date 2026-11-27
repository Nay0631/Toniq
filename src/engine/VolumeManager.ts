import * as Tone from "tone";
import { getState, setState, type AppState } from "./AppState";
import { connectToMixer } from "./MixerEngine";
import { volumeToDb } from "./VolumeCurve";

// 各パートのVolumeノードをオーディオコンテキストごとに管理
// （WAV書き出しの Tone.Offline は別コンテキストなので、再生用のノードとは分ける）
const nodesByContext = new WeakMap<Tone.BaseContext, Record<string, Tone.Volume>>();

// 現在のコンテキストのノード表
function currentNodes(): Record<string, Tone.Volume> {
  const ctx = Tone.getContext();
  let nodes = nodesByContext.get(ctx);
  if (!nodes) {
    nodes = {};
    nodesByContext.set(ctx, nodes);
  }
  return nodes;
}

// ミキサーのレベルメーター用。再生用のコンテキストだけに作る（WAV書き出しでは使わない）
const metersByContext = new WeakMap<Tone.BaseContext, Record<string, Tone.Meter>>();

function currentMeters(): Record<string, Tone.Meter> | null {
  const ctx = Tone.getContext();
  if (ctx instanceof Tone.OfflineContext) return null;
  let meters = metersByContext.get(ctx);
  if (!meters) {
    meters = {};
    metersByContext.set(ctx, meters);
  }
  return meters;
}

// サイドチェイン用のゲイン（Volume の後ろ。Groove.ts がキックに合わせて一瞬下げる）。Volume と同じくコンテキストごと
const ducksByContext = new WeakMap<Tone.BaseContext, Record<string, Tone.Gain>>();

function currentDucks(): Record<string, Tone.Gain> {
  const ctx = Tone.getContext();
  let ducks = ducksByContext.get(ctx);
  if (!ducks) {
    ducks = {};
    ducksByContext.set(ctx, ducks);
  }
  return ducks;
}

// 現在のコンテキストのサイドチェイン用のゲイン（まだ鳴らしていないパートは含まない）
export function duckGains(): Record<string, Tone.Gain> {
  return currentDucks();
}

// 定位（パン）のノード。サイドチェインのゲインの後ろ（MixerEngine の connectToMixer が作る）。Volume と同じくコンテキストごと
const pannersByContext = new WeakMap<Tone.BaseContext, Record<string, Tone.Panner>>();

function currentPanners(): Record<string, Tone.Panner> {
  const ctx = Tone.getContext();
  let panners = pannersByContext.get(ctx);
  if (!panners) {
    panners = {};
    pannersByContext.set(ctx, panners);
  }
  return panners;
}

// フェーダーの値（0〜100）を dB に（75 で 0dB。VolumeCurve.ts）
const toDb = volumeToDb;

// 定位（−100〜100）を Tone.Panner の値（−1〜1）に
function toPan(value: number): number {
  return Math.max(-1, Math.min(1, value / 100));
}

// 現在のコンテキストの Volume ノードを返す（なければ作成する）
export function createVolumeNode(part: string): Tone.Volume {
  const nodes = currentNodes();
  if (nodes[part]) return nodes[part];

  const state   = getState();
  const volumes = state.volumes as Record<string, number>;
  const pans    = state.pans as Record<string, number>;
  const db      = toDb(volumes[part] ?? 75);
  const node    = new Tone.Volume(db);
  // Volume → サイドチェインのゲイン → パートの EQ（低域カット・中域のへこみ）→ 定位 → マスターとリバーブ送りへ
  // （リバーブにも沈んだ音を送るので、響きも一緒にうねる）
  const duck = new Tone.Gain(1);
  node.connect(duck);
  const panner = connectToMixer(duck, part, toPan(pans[part] ?? 0));
  nodes[part] = node;
  currentDucks()[part] = duck;
  currentPanners()[part] = panner;

  // 音量・サイドチェイン・EQ・定位を通ったあとのレベルを測る（メーターは音を出さない枝分かれ）
  const meters = currentMeters();
  if (meters && !meters[part]) {
    meters[part] = new Tone.Meter({ smoothing: 0.6 });
    panner.connect(meters[part]);
  }
  return node;
}

// 各パートの今のレベル（dB）。まだ鳴らしていないパートは含まない
export function getPartLevels(): Record<string, number> {
  const meters = currentMeters() ?? {};
  const levels: Record<string, number> = {};
  for (const [part, meter] of Object.entries(meters)) {
    const v = meter.getValue();
    levels[part] = Array.isArray(v) ? Math.max(...v) : v;
  }
  return levels;
}

// 音量を変更する
export function setVolume(part: string, value: number): void {
  const state   = getState();
  const volumes = { ...state.volumes as Record<string, number>, [part]: value };
  setState({ volumes: volumes as any });

  const nodes = currentNodes();
  if (nodes[part]) {
    nodes[part].volume.value = toDb(value);
    console.log(`音量変更: ${part} = ${value} (${toDb(value).toFixed(1)}dB)`);
  }
}

// 定位（パン。−100〜100）を変更する
export function setPan(part: string, value: number): void {
  const pans = { ...getState().pans as Record<string, number>, [part]: value };
  setState({ pans: pans as AppState["pans"] });

  const panner = currentPanners()[part];
  if (panner) panner.pan.value = toPan(value);
}

// 全パートの音量と定位を State から再適用（曲を開いた・新規作成・元に戻す／やり直す）
export function applyAllVolumes(): void {
  const state   = getState();
  const volumes = state.volumes as Record<string, number>;
  const nodes   = currentNodes();
  Object.entries(volumes).forEach(([part, value]) => {
    if (nodes[part]) {
      nodes[part].volume.value = toDb(value);
    }
  });
  const panners = currentPanners();
  Object.entries(state.pans as Record<string, number>).forEach(([part, value]) => {
    if (panners[part]) panners[part].pan.value = toPan(value);
  });
}
