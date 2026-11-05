// BPM 試聴用のクリック音（メトロノーム）
// 曲の再生（Tone.js の Transport）とは別のオーディオコンテキストで Web Audio API から直接鳴らす。
// テンポは鳴らすたびに AppState.bpm を読むので、鳴らしたまま BPM を変えるとすぐ反映される。
import { getState } from "./AppState";

const BEATS_PER_BAR = 4;     // 4/4 前提。1拍目だけ高い音で鳴らす
const LOOKAHEAD_MS  = 25;    // スケジューラを呼ぶ間隔
const SCHEDULE_SEC  = 0.1;   // どれだけ先まで予約するか

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let timer: number | null = null;
let nextBeatTime = 0;
let beat = 0;

const listeners: (() => void)[] = [];

// 鳴る・止まるが切り替わったときに呼ばれる（ボタン表示の更新用）
export function onMetronomeChange(fn: () => void): void {
  listeners.push(fn);
}

function notify(): void {
  listeners.forEach(fn => fn());
}

export function isMetronomeOn(): boolean {
  return timer !== null;
}

// 短いクリック音（サイン波を素早く減衰させる）
function click(c: AudioContext, dest: AudioNode, t: number, accent: boolean): void {
  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = accent ? 1600 : 1000;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + 0.07);
}

function schedule(): void {
  if (!ctx || !bus) return;
  while (nextBeatTime < ctx.currentTime + SCHEDULE_SEC) {
    click(ctx, bus, nextBeatTime, beat === 0);
    beat = (beat + 1) % BEATS_PER_BAR;
    nextBeatTime += 60 / getState().bpm;
  }
}

export function startMetronome(): void {
  if (timer !== null) return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  bus = ctx.createGain();
  bus.connect(ctx.destination);
  beat = 0;
  nextBeatTime = ctx.currentTime + 0.05;
  schedule();
  timer = window.setInterval(schedule, LOOKAHEAD_MS);
  notify();
}

export function stopMetronome(): void {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
  // 予約済みのクリックも鳴らさないよう、まとめ先ごと切り離す
  if (ctx && bus) {
    const old = bus;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    setTimeout(() => old.disconnect(), 100);
  }
  bus = null;
  notify();
}

export function toggleMetronome(): void {
  if (isMetronomeOn()) stopMetronome();
  else startMetronome();
}
