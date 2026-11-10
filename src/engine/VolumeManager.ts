import * as Tone from "tone";
import { getState, setState } from "./AppState";
import { connectToMixer } from "./MixerEngine";

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

// 0〜100の値をdBに変換
function toDb(value: number): number {
  if (value <= 0) return -Infinity;
  return 20 * Math.log10(value / 100);
}

// 現在のコンテキストの Volume ノードを返す（なければ作成する）
export function createVolumeNode(part: string): Tone.Volume {
  const nodes = currentNodes();
  if (nodes[part]) return nodes[part];

  const state   = getState();
  const volumes = state.volumes as Record<string, number>;
  const db      = toDb(volumes[part] ?? 75);
  const node    = new Tone.Volume(db);
  // Volume → サイドチェインのゲイン → マスター（EQ・コンプ・リミッター）とリバーブ送りへ
  // （リバーブにも沈んだ音を送るので、響きも一緒にうねる）
  const duck = new Tone.Gain(1);
  node.connect(duck);
  connectToMixer(duck, part);
  nodes[part] = node;
  currentDucks()[part] = duck;

  // 音量とサイドチェインを通ったあとのレベルを測る（メーターは音を出さない枝分かれ）
  const meters = currentMeters();
  if (meters && !meters[part]) {
    meters[part] = new Tone.Meter({ smoothing: 0.6 });
    duck.connect(meters[part]);
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

// 全パートの音量をStateから再適用
export function applyAllVolumes(): void {
  const state   = getState();
  const volumes = state.volumes as Record<string, number>;
  const nodes   = currentNodes();
  Object.entries(volumes).forEach(([part, value]) => {
    if (nodes[part]) {
      nodes[part].volume.value = toDb(value);
    }
  });
}

// Volumeノードを破棄
export function disposeVolumeNodes(): void {
  const nodes = currentNodes();
  Object.values(nodes).forEach(node => node.dispose());
  Object.keys(nodes).forEach(key => delete nodes[key]);
  const ducks = currentDucks();
  Object.values(ducks).forEach(duck => duck.dispose());
  Object.keys(ducks).forEach(key => delete ducks[key]);
  const meters = currentMeters();
  if (meters) {
    Object.values(meters).forEach(meter => meter.dispose());
    Object.keys(meters).forEach(key => delete meters[key]);
  }
}