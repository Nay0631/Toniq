import { getState, setState } from "./AppState";

const TAP_TIMEOUT_MS = 2000; // 2秒以上間隔が空いたらリセット
const MAX_TAPS       = 8;    // 最大タップ数（平均を取る）

let tapTimes: number[] = [];
let lastTapTime: number | null = null;

export function tap(): number | null {
  const now = Date.now();

  // 前回のタップから2秒以上経過していたらリセット
  if (lastTapTime !== null && now - lastTapTime > TAP_TIMEOUT_MS) {
    tapTimes = [];
  }

  lastTapTime = now;
  tapTimes.push(now);

  // 最大タップ数を超えたら古いものを削除
  if (tapTimes.length > MAX_TAPS) {
    tapTimes.shift();
  }

  // タップが2回以上ないとBPMを計算できない
  if (tapTimes.length < 2) return null;

  // タップ間隔の平均からBPMを計算
  const intervals: number[] = [];
  for (let i = 1; i < tapTimes.length; i++) {
    intervals.push(tapTimes[i] - tapTimes[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60000 / avgInterval);

  // BPMを20〜240の範囲に制限
  const clampedBpm = Math.max(20, Math.min(240, bpm));

  // AppStateに反映
  setState({ bpm: clampedBpm, tempoPreset: "custom" });

  return clampedBpm;
}

export function resetTap(): void {
  tapTimes    = [];
  lastTapTime = null;
}

export function getTapCount(): number {
  return tapTimes.length;
}