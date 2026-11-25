import * as Tone from "tone";
import mixPresets from "../data/mix_presets.json";

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
// ジャンルのリバーブ（短め・薄め）とは別に持ち、ジャンルによらず同じ響きにする
const LONG_REVERB = { decay: 5.5, preDelay: 0.04, wet: 0.55 };  // wet = 戻りの量
const LONG_REVERB_SENDS: Record<string, number> = {
  fx: 0.8,
};

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
  reverb:     Tone.Reverb;
  reverbOut:  Tone.Gain;
  reverbDuck: Tone.Gain;    // リバーブの戻りをキックに合わせて沈めるゲイン
  longIn:     Tone.Filter;  // ロングリバーブの送り先（低域カット）
  longReverb: Tone.Reverb;
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
  const reverb     = new Tone.Reverb({ decay: 1.5, preDelay: REVERB_PRE_DELAY, wet: 1 }).connect(reverbOut);
  const reverbIn   = new Tone.Filter({ type: "highpass", frequency: 250 }).connect(reverb);

  // ロングリバーブ：送り → 低域カット → リバーブ → 戻り → 戻りの EQ
  const longOut    = new Tone.Gain(LONG_REVERB.wet).connect(returnEq);
  const longReverb = new Tone.Reverb({ decay: LONG_REVERB.decay, preDelay: LONG_REVERB.preDelay, wet: 1 }).connect(longOut);
  const longIn     = new Tone.Filter({ type: "highpass", frequency: 350 }).connect(longReverb);

  // リミッターのあと（スピーカーに出る音）の波形を左右別々に取り、ピークを測る。音を出さない枝分かれ
  const peak = ctx instanceof Tone.OfflineContext ? null : new Tone.Analyser({ type: "waveform", size: PEAK_WINDOW, channels: 2 });
  if (peak) limiter.connect(peak);

  const mixer: Mixer = {
    input, eq, compressor, makeup, limiter, fade, returnEq, reverbIn, reverb, reverbOut, reverbDuck, longIn, longReverb,
    sends: {}, genre: "", peak,
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
  if (long > 0) panner.connect(new Tone.Gain(long).connect(mixer.longIn));
  return panner;
}

// 現在のコンテキストのミキサーにジャンルの設定を当てる
export function applyMixPreset(genre: string) {
  const preset  = presets[genre] ?? presets["ローファイ"];
  const mixer   = getMixer();

  // decay・preDelay を変えると響きのデータを作り直すので、変わったときだけ設定する
  const preDelay = preset.reverb.preDelay ?? REVERB_PRE_DELAY;
  if (mixer.reverb.decay !== preset.reverb.decay) mixer.reverb.decay = preset.reverb.decay;
  if (mixer.reverb.preDelay !== preDelay) mixer.reverb.preDelay = preDelay;
  mixer.reverbOut.gain.value = preset.reverb.wet;

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

// リバーブの響きのデータができるまで待つ（WAV書き出しで曲の頭から響かせるため）
export async function mixerReady(): Promise<void> {
  const mixer = getMixer();
  await Promise.all([mixer.reverb.ready, mixer.longReverb.ready]);
}
