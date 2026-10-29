import * as Tone from "tone";
import { getState, setState } from "./AppState";

// 各パートのVolumeノードを管理
const volumeNodes: Record<string, Tone.Volume> = {};

// 0〜100の値をdBに変換
function toDb(value: number): number {
  if (value <= 0) return -Infinity;
  return 20 * Math.log10(value / 100);
}

// Volumeノードを作成して返す
export function createVolumeNode(part: string): Tone.Volume {
  const state   = getState();
  const volumes = state.volumes as Record<string, number>;
  const db      = toDb(volumes[part] ?? 75);
  const node    = new Tone.Volume(db).toDestination();
  volumeNodes[part] = node;
  return node;
}

// 音量を変更する
export function setVolume(part: string, value: number): void {
  const state   = getState();
  const volumes = { ...state.volumes as Record<string, number>, [part]: value };
  setState({ volumes: volumes as any });

  if (volumeNodes[part]) {
    volumeNodes[part].volume.value = toDb(value);
    console.log(`音量変更: ${part} = ${value} (${toDb(value).toFixed(1)}dB)`);
  }
}

// 全パートの音量をStateから再適用
export function applyAllVolumes(): void {
  const state   = getState();
  const volumes = state.volumes as Record<string, number>;
  Object.entries(volumes).forEach(([part, value]) => {
    if (volumeNodes[part]) {
      volumeNodes[part].volume.value = toDb(value);
    }
  });
}

// Volumeノードを破棄
export function disposeVolumeNodes(): void {
  Object.values(volumeNodes).forEach(node => node.dispose());
  Object.keys(volumeNodes).forEach(key => delete volumeNodes[key]);
}