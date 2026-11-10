// キー・スケールの試聴（スケールを主音から1オクターブ上まで順に鳴らし、最後に主音の和音を鳴らす）
// 曲の再生（Tone.js の Transport）とは別のオーディオコンテキストで Web Audio API から直接鳴らす。
// 鳴っているかどうか・何音目かは表示上の一時的な状態としてモジュール内に持つ（保存しない）
import { NOTE_INDEX, scaleSemitones } from "../data/degree_resolver";

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const STEP_SEC  = 0.34;  // 1音の間隔
const CHORD_SEC = 1.8;   // 最後の和音の長さ

export interface ScalePreviewNote {
  name: string;   // "A3" のようなオクターブ付きの音名（CDE 表記）
  midi: number;
}

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let timers: number[] = [];
let current = -1;  // 今鳴っている音の番号（-1 = 鳴っていない。notes.length = 最後の和音）

const listeners: (() => void)[] = [];

// 鳴る・止まる・次の音へ進むたびに呼ばれる（ボタン・音名の表示の更新用）
export function onScalePreviewChange(fn: () => void): void {
  listeners.push(fn);
}

function notify(): void {
  listeners.forEach(fn => fn());
}

export function isScalePreviewOn(): boolean {
  return current >= 0;
}

// 今鳴っている音の番号（scalePreviewNotes の添字。和音のときは notes.length、止まっていれば -1）
export function scalePreviewStep(): number {
  return current;
}

// 鳴らす音の並び（主音〜1オクターブ上の主音の8音）。主音は A3〜G#4 に収める
export function scalePreviewNotes(key: string, scale: string): ScalePreviewNote[] {
  const root = NOTE_INDEX[key] ?? 0;
  const base = 57 + ((root - 9 + 12) % 12);  // 57 = A3
  return [...scaleSemitones(scale), 12].map(d => {
    const midi = base + d;
    return { midi, name: `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}` };
  });
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ピアノ風の音（三角波に2倍音のサイン波を薄く重ねる）
function tone(c: AudioContext, dest: AudioNode, midi: number, t: number, len: number, level: number): void {
  const freq = midiToFreq(midi);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  gain.connect(dest);

  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  osc.connect(gain);

  const overtone = c.createOscillator();
  const overtoneGain = c.createGain();
  overtone.type = "sine";
  overtone.frequency.value = freq * 2;
  overtoneGain.gain.value = 0.3;
  overtone.connect(overtoneGain).connect(gain);

  [osc, overtone].forEach(o => { o.start(t); o.stop(t + len + 0.05); });
}

// スケールを鳴らす。鳴らしている途中なら止めてから鳴らし直す
export function playScalePreview(key: string, scale: string): void {
  stopScalePreview(false);
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  const c = ctx;
  bus = c.createGain();
  bus.connect(c.destination);

  const notes = scalePreviewNotes(key, scale);
  const t0 = c.currentTime + 0.05;
  notes.forEach((n, i) => tone(c, bus!, n.midi, t0 + i * STEP_SEC, 0.6, 0.24));

  // 最後に主音の和音（主音・3度・5度。スケールの1・3・5番目の音）を低い主音と一緒に鳴らす
  const chordAt = t0 + notes.length * STEP_SEC + 0.1;
  const chord = [notes[0].midi - 12, notes[0].midi, notes[2].midi, notes[4].midi];
  chord.forEach(m => tone(c, bus!, m, chordAt, CHORD_SEC, 0.15));

  // 表示：何音目を鳴らしているか（音と同じ時刻に切り替える）
  const delay = (t: number) => Math.max(0, (t - c.currentTime) * 1000);
  current = 0;
  notes.forEach((_, i) => {
    if (i > 0) timers.push(window.setTimeout(() => { current = i; notify(); }, delay(t0 + i * STEP_SEC)));
  });
  timers.push(window.setTimeout(() => { current = notes.length; notify(); }, delay(chordAt)));
  timers.push(window.setTimeout(() => stopScalePreview(), delay(chordAt + CHORD_SEC)));
  notify();
}

// 止める（予約済みの音も鳴らさないよう、まとめ先ごと切り離す）
export function stopScalePreview(notifyChange = true): void {
  timers.forEach(id => window.clearTimeout(id));
  timers = [];
  if (ctx && bus) {
    const old = bus;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    setTimeout(() => old.disconnect(), 200);
  }
  bus = null;
  if (current < 0) return;
  current = -1;
  if (notifyChange) notify();
}
