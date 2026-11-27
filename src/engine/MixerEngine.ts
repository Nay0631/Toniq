import * as Tone from "tone";
import mixPresets from "../data/mix_presets.json";
import { reverbImpulse, type Impulse } from "./ReverbImpulse";

interface MixPreset {
  // wet = リバーブ送りの全体量、preDelay = 響き始めるまでの間（秒。なければ REVERB_PRE_DELAY）、
  // sends = このジャンルだけ変えるパートごとの送りの量（なければ REVERB_SENDS）
  reverb:     { decay: number; wet: number; preDelay?: number; sends?: Record<string, number> };
  eq:         { low: number; mid: number; high: number };
  compressor: { threshold: number; ratio: number; attack: number; release: number };
  limiter:    { threshold: number };
  gain:       number;  // コンプ後の持ち上げ（dB）。全ジャンルの聞こえる大きさをそろえる（npm run mix:measure で決める）
}

const presets = mixPresets as Record<string, MixPreset>;

// パートごとのリバーブ送りの量（0〜1）の標準。低音は響かせるとぼやけるので送らない。
// ジャンルで変えるときは mix_presets.json の reverb.sends に書く
const REVERB_SENDS: Record<string, number> = {
  drum:   0.15,
  chord:  0.5,
  bass:   0,
  arp:    0.6,
  pad:    0.8,
  signature: 0.4,
  melody: 0.5,
  counter: 0.55,
  perc:   0.25,
  fx:     0.7,
};
const REVERB_PRE_DELAY = 0.02;

// ロングリバーブ：FX / SE だけを送る長い響き（ライザーやインパクトの余韻を後ろに大きく残す）
// ジャンルのリバーブ（短め・薄め）とは別に持ち、ジャンルによらず同じ響きにする。
// 長い響きは計算が重いので、FX が鳴る間（と余韻）だけつなぐ（createLongReverbGate）
const LONG_REVERB = { decay: 5.5, preDelay: 0.04, wet: 0.55 };  // wet = 戻りの量
const LONG_REVERB_SENDS: Record<string, number> = {
  fx: 0.8,
};
// 音が鳴り終わってから切り離すまで（秒）。音色のリリース・ディレイの残りも響かせる（響きそのものの余韻は、切り離しても最後まで鳴る）
const LONG_REVERB_RELEASE = 4;
// 書き出しで、音の始まりより少し前につなぐ（秒）
const LONG_REVERB_LEAD = 0.05;

// パートの低域カット（Hz。12dB/oct）。キック・ベースの帯域に和音やメロディの低い成分を重ねない
// （それぞれのパートの最低音より下に置く：コード G3・パッド E3・アルペジオ C4・メロディとカウンターメロディ G3 あたり）。
// ドラム・ベース・FX / SE（インパクトの低いブーム）は削らない。パーカッションは自分のキットの中で 150Hz から削っている
const PART_LOW_CUT: Record<string, number> = {
  chord:     140,
  pad:       140,
  arp:       200,
  melody:    150,
  counter:   160,
  signature: 90,   // テクノのアシッドは低い音も鳴らすので浅く
};

// 伴奏の中域のへこみ（dB）。メロディがいちばん聞こえる 2kHz あたりを和音のパートから少し引いて、メロディを前に出す
const PART_MID_DIP: Record<string, number> = {
  chord: -2,
  pad:   -2,
};
const MID_DIP = { frequency: 2000, Q: 0.8 };

// リバーブの戻りをキックに合わせて沈める割合（サイドチェインの量に掛ける。Groove.ts）
export const REVERB_DUCK_WEIGHT = 0.5;

// マスター：入口 → EQ → コンプ → 持ち上げ → リミッター → フェード → スピーカー
// リバーブ：送り → 低域カット → リバーブ → 戻り →（キックで沈める）→ 戻りの EQ → 持ち上げ
// （戻りはコンプを通さない。通すと、ドラムでコンプが動くたびに響きまで一緒に沈んで揺れる。
//   EQ はマスターと同じ設定の別の EQ を通し、持ち上げ・リミッターは一緒に通る）
interface Mixer {
  input:      Tone.Gain;
  eq:         Tone.EQ3;
  compressor: Tone.Compressor;
  makeup:     Tone.Gain<"decibels">;
  limiter:    Tone.Limiter;
  fade:       Tone.Gain;    // フェードアウト（ジャンルのサンプルの終わり）。ふだんは 1 で素通し
  returnEq:   Tone.EQ3;     // リバーブの戻りの EQ（マスターの EQ と同じ設定）
  reverbIn:   Tone.Filter;
  reverb:     Tone.Convolver;
  impulse:    Impulse | null;  // 今のリバーブの響き（ジャンルで変わる。変わったときだけ入れ替える）
  reverbOut:  Tone.Gain;
  reverbDuck: Tone.Gain;    // リバーブの戻りをキックに合わせて沈めるゲイン
  longIn:     Tone.Filter;  // ロングリバーブの送り先（低域カット）
  longSends:  Tone.Gain[];  // ロングリバーブへ送るパートの送り（longUsers が 1 以上の間だけ longIn につなぐ）
  longUsers:  number;       // 今ロングリバーブを使っている FX の数
  sends:      Record<string, Tone.Gain>;  // パートごとのリバーブ送り（ジャンルで量を変える）
  genre:      string;                     // 今当てているジャンル（あとからつないだパートの送りの量を決める）
  peak:       Tone.Analyser | null;       // マスターのピークを測る波形（左右。再生用のコンテキストだけ）
}

// オーディオコンテキストごとに1つ持つ（WAV書き出しの Tone.Offline は別コンテキスト）
// 各パートの Volume ノードはコンテキストごとに使い回すので、ミキサーも作り直さない
const mixers = new WeakMap<Tone.BaseContext, Mixer>();

function getMixer(): Mixer {
  const ctx = Tone.getContext();
  const existing = mixers.get(ctx);
  if (existing) return existing;

  const fade       = new Tone.Gain(1).toDestination();
  const limiter    = new Tone.Limiter(-1).connect(fade);
  const makeup     = new Tone.Gain(0, "decibels").connect(limiter);
  const compressor = new Tone.Compressor().connect(makeup);
  const eq         = new Tone.EQ3().connect(compressor);
  const input      = new Tone.Gain(1).connect(eq);

  const returnEq   = new Tone.EQ3().connect(makeup);
  const reverbDuck = new Tone.Gain(1).connect(returnEq);
  const reverbOut  = new Tone.Gain(0).connect(reverbDuck);
  const reverb     = new Tone.Convolver().connect(reverbOut);  // 響きのデータは applyMixPreset が入れる
  const reverbIn   = new Tone.Filter({ type: "highpass", frequency: 250 }).connect(reverb);

  // ロングリバーブ：送り → 低域カット → リバーブ → 戻り → 戻りの EQ
  const long       = reverbImpulse(LONG_REVERB.decay, LONG_REVERB.preDelay, ctx.sampleRate);
  const longOut    = new Tone.Gain(LONG_REVERB.wet * long.gain).connect(returnEq);
  const longReverb = new Tone.Convolver().connect(longOut);
  longReverb.buffer = new Tone.ToneAudioBuffer(long.buffer);
  const longIn     = new Tone.Filter({ type: "highpass", frequency: 350 }).connect(longReverb);

  // リミッターのあと（スピーカーに出る音）の波形を左右別々に取り、ピークを測る。音を出さない枝分かれ
  const peak = ctx instanceof Tone.OfflineContext ? null : new Tone.Analyser({ type: "waveform", size: PEAK_WINDOW, channels: 2 });
  if (peak) limiter.connect(peak);

  const mixer: Mixer = {
    input, eq, compressor, makeup, limiter, fade, returnEq, reverbIn, reverb, impulse: null, reverbOut, reverbDuck,
    longIn, longSends: [], longUsers: 0, sends: {}, genre: "", peak,
  };
  mixers.set(ctx, mixer);
  console.log("Mixer初期化完了");
  return mixer;
}

// ピークを測る波形の長さ（サンプル）。画面の更新（1/60 秒 ≒ 800 サンプル）より長く取って、取りこぼさない
const PEAK_WINDOW = 2048;

// マスターの今のピーク（dB。左・右）。直前の PEAK_WINDOW サンプルの最大。ミキサーをまだ作っていなければ -Infinity
export function getMasterPeaks(): [number, number] {
  const analyser = mixers.get(Tone.getContext())?.peak;
  if (!analyser) return [-Infinity, -Infinity];
  const waves = analyser.getValue();
  const peakDb = (wave: Float32Array): number => {
    let max = 0;
    for (let i = 0; i < wave.length; i++) max = Math.max(max, Math.abs(wave[i]));
    return max > 0 ? 20 * Math.log10(max) : -Infinity;
  };
  if (!Array.isArray(waves)) {
    const db = peakDb(waves as Float32Array);
    return [db, db];
  }
  return [peakDb(waves[0] as Float32Array), peakDb((waves[1] ?? waves[0]) as Float32Array)];
}

// ===== マスターのフェードアウト（ジャンルのサンプルの終わり） =====
// リミッターのあと（スピーカーの直前）で絞るので、リバーブの響きも一緒に消える。
// 止めたあとも絞ったままにし（resetMasterFade まで）、残っている響きが戻ってこないようにする

// endTime（オーディオの時刻。秒）にちょうど無音になるよう、seconds 秒かけて絞る（dB で一定の速さ。−60dB まで下げてから 0）
export function fadeOutMaster(endTime: number, seconds: number): void {
  const gain = getMixer().fade.gain;
  gain.cancelScheduledValues(0);
  gain.setValueAtTime(1, Math.max(0, endTime - seconds));
  gain.exponentialRampToValueAtTime(0.001, endTime);
  gain.setValueAtTime(0, endTime);
}

// 予定しているフェードを取りやめ、今の音量のまま止めておく（再生・サンプルを止めたとき。途中で止めても音量が跳ね上がらない）
export function holdMasterFade(): void {
  const mixer = mixers.get(Tone.getContext());
  mixer?.fade.gain.cancelAndHoldAtTime(Tone.now());
}

// フェードを戻して素通しにする（再生・試聴・サンプルの開始）
export function resetMasterFade(): void {
  const mixer = mixers.get(Tone.getContext());
  if (!mixer) return;
  mixer.fade.gain.cancelScheduledValues(0);
  mixer.fade.gain.setValueAtTime(1, Tone.getContext().currentTime);
}

// リバーブの戻りをキックに合わせて沈めるゲイン（Groove.ts のサイドチェイン）。ミキサーをまだ作っていなければ null
export function reverbDuckGain(): Tone.Gain | null {
  return mixers.get(Tone.getContext())?.reverbDuck ?? null;
}

// ジャンルでのパートのリバーブ送りの量
function sendAmount(genre: string, part: string): number {
  return presets[genre]?.reverb.sends?.[part] ?? REVERB_SENDS[part] ?? 0;
}

// パートの出口（サイドチェインのゲイン）を、パートの EQ（低域カット・中域のへこみ）→ 定位（パン）と通してマスターにつなぎ、
// リバーブ送りも作る（VolumeManager から呼ぶ）。定位のノードを返す（VolumeManager が値を変える・メーターをつなぐ）
export function connectToMixer(node: Tone.ToneAudioNode, part: string, pan = 0): Tone.Panner {
  const mixer = getMixer();
  let tail = node;

  const lowCut = PART_LOW_CUT[part];
  if (lowCut) {
    const filter = new Tone.Filter({ type: "highpass", frequency: lowCut, rolloff: -12, Q: 0.7 });
    tail.connect(filter);
    tail = filter;
  }
  const dip = PART_MID_DIP[part];
  if (dip) {
    const filter = new Tone.Filter({ type: "peaking", frequency: MID_DIP.frequency, Q: MID_DIP.Q, gain: dip });
    tail.connect(filter);
    tail = filter;
  }

  // 左右の広がりのある音（grow のコーラスなど）をそのまま通すため、2チャンネルで受ける（Tone.Panner の標準はモノラル）
  const panner = new Tone.Panner({ pan, channelCount: 2 });
  tail.connect(panner);
  panner.connect(mixer.input);

  // リバーブ送りは量が 0 でも作っておく（ジャンルを変えたときに量だけ変える）
  const send = new Tone.Gain(sendAmount(mixer.genre, part)).connect(mixer.reverbIn);
  panner.connect(send);
  mixer.sends[part] = send;

  const long = LONG_REVERB_SENDS[part] ?? 0;
  if (long > 0) {
    const longSend = new Tone.Gain(long);
    panner.connect(longSend);
    mixer.longSends.push(longSend);
    if (mixer.longUsers > 0) longSend.connect(mixer.longIn);
  }
  return panner;
}

// ===== ロングリバーブのつなぎ方 =====
// grow（AudioWorklet）は鳴っていない間も 0 を出し続け、ブラウザには無音とわからない。つないだままだと、FX を1音も鳴らさない曲でも
// 長い響きを計算し続ける（書き出し時間の約2割）。鳴る間だけつなげば、つないでいない間は計算しない

// FX が鳴る間だけロングリバーブにつなぐ関数（音の始まりの時刻と長さ。秒）を作る。
// FX を読み込むときに呼ぶ（書き出しの合成中は Tone.getContext() が再生用に戻っているので、読み込んだ時点のミキサーを控える）
export function createLongReverbGate(): (time: number, seconds: number) => void {
  const context = Tone.getContext();
  const mixer   = getMixer();
  const open  = () => {
    if (mixer.longUsers++ === 0) mixer.longSends.forEach(send => send.connect(mixer.longIn));
  };
  const close = () => {
    if (--mixer.longUsers === 0) mixer.longSends.forEach(send => send.disconnect(mixer.longIn));
  };

  return (time, seconds) => {
    const end = time + seconds + LONG_REVERB_RELEASE;
    if (context.isOffline) {
      // 書き出し：予定の組み立ては合成より前に全部終わるので、合成をその時刻で一時停止してつなぎ替える。
      // 一時停止できないとき（Tone.Offline での描き直しなど）は、つないだままにする
      const raw = context.rawContext as unknown as OfflineAudioContext;
      atRenderTime(raw, time - LONG_REVERB_LEAD, open, open);
      atRenderTime(raw, end, close, () => {});
      return;
    }
    open();  // 呼ばれるのは鳴る少し前（先読みの分）なので、すぐつなぐ
    context.setTimeout(close, Math.max(0, end - context.currentTime));
  };
}

// 書き出しの合成を seconds（秒）の所で一時停止して fn を呼ぶ。一時停止できなければ fallback を呼ぶ。
// 同じ所では1回しか一時停止できないので、重なったものは1つにまとめる
const renderStops = new WeakMap<OfflineAudioContext, Map<number, (() => void)[]>>();
const RENDER_QUANTUM = 128;  // 合成の1回分（サンプル）。一時停止はこの区切りで行われる

function atRenderTime(raw: OfflineAudioContext, seconds: number, fn: () => void, fallback: () => void): void {
  const frame = Math.max(0, Math.floor((seconds * raw.sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM);
  if (frame === 0 || typeof raw.suspend !== "function") {
    fallback();
    return;
  }
  const stops = renderStops.get(raw) ?? new Map<number, (() => void)[]>();
  renderStops.set(raw, stops);
  const waiting = stops.get(frame);
  if (waiting) {
    waiting.push(fn);
    return;
  }
  const list = [fn];
  stops.set(frame, list);
  raw.suspend(frame / raw.sampleRate).then(() => {
    list.forEach(run => run());
    return raw.resume();
  }, () => {
    stops.delete(frame);
    fallback();
  });
}

// 現在のコンテキストのミキサーにジャンルの設定を当てる
export function applyMixPreset(genre: string) {
  const preset  = presets[genre] ?? presets["ローファイ"];
  const mixer   = getMixer();

  // 響きを入れ替えると鳴っている余韻が切れるので、変わったときだけ入れ替える
  const impulse = reverbImpulse(preset.reverb.decay, preset.reverb.preDelay ?? REVERB_PRE_DELAY, Tone.getContext().sampleRate);
  if (mixer.impulse !== impulse) {
    mixer.impulse = impulse;
    mixer.reverb.buffer = new Tone.ToneAudioBuffer(impulse.buffer);
  }
  mixer.reverbOut.gain.value = preset.reverb.wet * impulse.gain;

  mixer.genre = presets[genre] ? genre : "ローファイ";
  for (const [part, send] of Object.entries(mixer.sends)) send.gain.value = sendAmount(mixer.genre, part);

  for (const eq of [mixer.eq, mixer.returnEq]) {
    eq.low.value  = preset.eq.low;
    eq.mid.value  = preset.eq.mid;
    eq.high.value = preset.eq.high;
  }

  mixer.compressor.threshold.value = preset.compressor.threshold;
  mixer.compressor.ratio.value     = preset.compressor.ratio;
  mixer.compressor.attack.value    = preset.compressor.attack;
  mixer.compressor.release.value   = preset.compressor.release;

  mixer.makeup.gain.value       = preset.gain;
  mixer.limiter.threshold.value = preset.limiter.threshold;

  console.log(`ミックスプリセット適用: ${genre}`, preset);
}
