// リバーブの響き（コンボリューションの元になるデータ）を作る。
// 形は Tone.Reverb と同じ：響き始めるまでの間（preDelay）のあと、左右で別々のノイズを指数の曲線で減らす。違うのは次の3つ
// - 聞こえなくなった所（CUT_DB）で切る。Tone.Reverb は decay の長さを丸ごと持つので後半はほぼ無音で
//   （decay 5.5 秒なら 2.5 秒で −60dB）、その分も計算し続けて書き出し・再生が重くなる
// - ノイズの乱数の種を決めておく（いつ作っても同じ響きになり、書き出すたびに変わらない）
// - 同じ設定なら作り直さない（書き出しのたびに作る時間がかからない）

// 響きの頭からここまで小さくなったら切る（dB）
export const CUT_DB = -80;
// 切る所の段差をなくすフェード（秒）
const CUT_FADE = 0.02;

// 減り方の時定数（秒）。Tone.js の exponentialApproachValueAtTime と同じ
function timeConstant(decay: number): number {
  return Math.log(decay + 1) / Math.log(200);
}

// 響きのデータの長さ（秒。preDelay を含む）
export function impulseSeconds(decay: number, preDelay: number): number {
  const untilCut = timeConstant(decay) * Math.log(10) * (-CUT_DB / 20);
  return preDelay + Math.min(decay, untilCut);
}

// 乱数（mulberry32。−1〜1）
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

export interface ImpulseData {
  channels: Float32Array<ArrayBuffer>[];  // 左・右
  // 戻りに掛ける補正。ブラウザの ConvolverNode は「データ全体の平均の大きさ」で音量をそろえるので、後ろの無音を切ると平均が上がり、
  // そのぶん響きが小さくなる。切らないときと同じ大きさになるように戻す
  gain: number;
}

export function impulseData(decay: number, preDelay: number, sampleRate: number): ImpulseData {
  const tc     = timeConstant(decay);
  const start  = Math.round(preDelay * sampleRate);
  const full   = Math.floor((decay + preDelay) * sampleRate);
  const length = Math.max(start + 1, Math.min(full, Math.ceil(impulseSeconds(decay, preDelay) * sampleRate)));
  const fade   = Math.min(length - start, Math.round(CUT_FADE * sampleRate));
  const step   = Math.exp(-1 / (tc * sampleRate));  // 1サンプルごとに掛ける割合

  const channels = [0x2f6e2b1, 0x91e10da].map(seed => {
    const data = new Float32Array(length);
    const next = noise(seed);
    let level = 1;
    for (let i = start; i < length; i++) {
      const left = length - i;  // 終わりまでのサンプル数
      data[i] = next() * level * (left < fade ? left / fade : 1);
      level *= step;
    }
    return data;
  });
  return { channels, gain: Math.sqrt(full / length) };
}

export interface Impulse {
  buffer: AudioBuffer;
  gain:   number;
}

const cache = new Map<string, Impulse>();

// 響きのデータ（AudioBuffer はコンテキストに依存しないので、再生と書き出しで同じものを使う）
export function reverbImpulse(decay: number, preDelay: number, sampleRate: number): Impulse {
  const key   = `${decay}/${preDelay}/${sampleRate}`;
  const found = cache.get(key);
  if (found) return found;
  const { channels, gain } = impulseData(decay, preDelay, sampleRate);
  const buffer = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0].length, sampleRate });
  channels.forEach((data, ch) => buffer.copyToChannel(data, ch));
  const impulse = { buffer, gain };
  cache.set(key, impulse);
  return impulse;
}
