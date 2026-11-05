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
  connectToMixer(node, part);  // マスター（EQ・コンプ・リミッター）とリバーブ送りへ
  nodes[part] = node;
  return node;
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
}