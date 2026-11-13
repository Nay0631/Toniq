import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { createVolumeNode } from "./VolumeManager";
import { arrangementBlockAt, getArrangement, positionAt } from "./LoopArranger";
import { endingBar } from "./SongForm";
import { getState, FxType, ArrangeBlock } from "./AppState";
import { GrowInstrument, isGrowReady, findGrowPreset, growPresetValuesWith } from "./Grow";

// FX / SE：ループの継ぎ目を演出する効果音
// 種類は AppState.fxType（"auto" ならジャンルの標準 GENRE_FX）。音色は Synth を作り直したとき（再生開始時）に反映される
// - rise：ループの終わりに向けて盛り上げる音（ライザー・リバースシンバルなど）。ループの頭ちょうどで終わる
// - hit ：ループの頭で鳴らす音（インパクト・ダウンリフターなど）
// 音は grow（GROW_FX。コアの「FX …」のプリセット）で出す。grow の準備ができていない・プリセットがない（wasm が古い）ときは
// FX_DEFS（Tone.js）で鳴らす

interface FxVoice {
  rise?:    (time: number, dur: number) => void;
  riseLen?: "bars" | "2n";  // bars = 1小節（8小節以上の進行は2小節）、2n = 最後の2拍
  hit?:     (time: number) => void;
  nodes:    { dispose(): unknown }[];  // 破棄するノード（Tone.js のノード・grow）
}

interface FxDef {
  label:  string;  // アレンジャーなどの表示名
  create: (out: Tone.ToneAudioNode) => FxVoice;
}

// ===== 部品 =====

// 音量の山（0〜1）をなめらかな曲線でかける。直前の予定は消してから書き込む
function curve(param: Tone.Param<any>, time: number, dur: number, shape: (x: number) => number) {
  const values = Array.from({ length: 32 }, (_, i) => shape(i / 31));
  param.cancelScheduledValues(time);
  param.setValueCurveAtTime(values, time, dur);  // Tone.js は直線の積み重ねで書くので、後から予定を足しても例外にならない
}

// 終わりのクリックを防ぐ短いフェードアウト
function fadeOut(param: Tone.Param<any>, time: number, len = 0.03) {
  param.setValueAtTime(param.getValueAtTime(time), time);
  param.linearRampToValueAtTime(0, time + len);
}

// 左右で別々のノイズ（モノラルのノイズより横に大きく広がる）
function stereoNoise(level: number, type: "white" | "pink" = "white") {
  const merge = new Tone.Merge();
  const left  = new Tone.Noise({ type, volume: level });
  const right = new Tone.Noise({ type, volume: level });
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  return {
    output: merge,
    start: (time: number) => { left.start(time); right.start(time); return { stop: (t: number) => { left.stop(t); right.stop(t); } }; },
    nodes: [left, right, merge] as Tone.ToneAudioNode[],
  };
}

// 広がり：左右で揺れのずれたコーラス → 左右に跳ねるディレイ → out
// 音の後ろの響きはミキサーのリバーブ送り（ジャンルのリバーブと FX 用のロングリバーブ）で付ける
interface SpaceOptions {
  chorus:    number;          // コーラスの量（0 = かけない）
  delay:     number;          // ディレイの量
  delayTime: Tone.Unit.Time;
  feedback?: number;
}

function space(out: Tone.ToneAudioNode, o: SpaceOptions) {
  const delay = new Tone.PingPongDelay({ delayTime: o.delayTime, feedback: o.feedback ?? 0.35, wet: o.delay }).connect(out);
  if (o.chorus <= 0) return { input: delay as Tone.ToneAudioNode, nodes: [delay] as Tone.ToneAudioNode[] };
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 5, depth: 0.7, spread: 180, wet: o.chorus }).connect(delay).start();
  return { input: chorus as Tone.ToneAudioNode, nodes: [chorus, delay] as Tone.ToneAudioNode[] };
}

// ノイズのライザー：左右別々のノイズをバンドパスで掃き上げ、左右に揺らしながら音量を上げる
function noiseRiser(out: Tone.ToneAudioNode, level: number) {
  const panner = new Tone.AutoPanner({ frequency: 0.5, depth: 0.4 }).connect(out).start();
  const amp    = new Tone.Gain(0).connect(panner);
  const band   = new Tone.Filter({ type: "bandpass", frequency: 400, Q: 1.4 }).connect(amp);
  const low    = new Tone.Filter({ type: "highpass", frequency: 150, Q: 0.7 }).connect(band);
  const noise  = stereoNoise(level);
  noise.output.connect(low);

  const rise = (time: number, dur: number) => {
    const end = time + dur;
    band.frequency.cancelScheduledValues(time);
    band.frequency.setValueAtTime(400, time);
    band.frequency.exponentialRampToValueAtTime(11000, end);
    panner.frequency.cancelScheduledValues(time);
    panner.frequency.setValueAtTime(0.5, time);
    panner.frequency.exponentialRampToValueAtTime(6, end);  // 終盤ほど速く揺らす
    curve(amp.gain, time, dur - 0.03, x => x * x);
    fadeOut(amp.gain, end - 0.03);
    noise.start(time).stop(end + 0.01);
  };
  return { rise, nodes: [...noise.nodes, low, band, amp, panner] as Tone.ToneAudioNode[] };
}

// 音程のライザー：重ねたノコギリ波の音程を2オクターブ上げ、トレモロを速めていく
function pitchRiser(out: Tone.ToneAudioNode, level: number) {
  const trem   = new Tone.Tremolo({ frequency: 4, depth: 0.5, spread: 90 }).connect(out).start();
  const amp    = new Tone.Gain(0).connect(trem);
  const filter = new Tone.Filter({ type: "lowpass", frequency: 600, Q: 2 }).connect(amp);
  const osc    = new Tone.FatOscillator({ type: "sawtooth", count: 3, spread: 35, frequency: 110, volume: level }).connect(filter);

  const rise = (time: number, dur: number) => {
    const end = time + dur;
    osc.frequency.cancelScheduledValues(time);
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.exponentialRampToValueAtTime(440, end);
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(600, time);
    filter.frequency.exponentialRampToValueAtTime(7000, end);
    trem.frequency.cancelScheduledValues(time);
    trem.frequency.setValueAtTime(4, time);
    trem.frequency.exponentialRampToValueAtTime(16, end);
    curve(amp.gain, time, dur - 0.03, x => x * x * x);
    fadeOut(amp.gain, end - 0.03);
    osc.start(time).stop(end + 0.01);
  };
  return { rise, nodes: [osc, filter, amp, trem] as Tone.ToneAudioNode[] };
}

// インパクト：低く沈むブーム＋明るさが閉じていくノイズの一撃
// ブームは中央に置いたまま（低音は広げるとぼやける）dry に出し、ノイズだけ wide（広がりの入口）に通す
function impactHit(dry: Tone.ToneAudioNode, wide: Tone.ToneAudioNode, level: number) {
  const dist  = new Tone.Distortion({ distortion: 0.25, wet: 0.4 }).connect(dry);
  const boom  = new Tone.MembraneSynth({
    pitchDecay: 0.25,
    octaves:    5,
    envelope:   { attack: 0.002, decay: 1.4, sustain: 0, release: 0.6 },
    volume:     level,
  }).connect(dist);
  const amp   = new Tone.Gain(0).connect(wide);
  const close = new Tone.Filter({ type: "lowpass", frequency: 7000, Q: 0.8 }).connect(amp);
  const burst = stereoNoise(level - 8);
  burst.output.connect(close);

  const hit = (time: number) => {
    const len = 1.2;
    boom.triggerAttackRelease(42, 1.2, time);
    close.frequency.cancelScheduledValues(time);
    close.frequency.setValueAtTime(7000, time);
    close.frequency.exponentialRampToValueAtTime(350, time + len);
    curve(amp.gain, time, len, x => (1 - x) ** 3);
    burst.start(time).stop(time + len + 0.01);
  };
  return { hit, nodes: [boom, dist, ...burst.nodes, close, amp] as Tone.ToneAudioNode[] };
}

// ===== 種類ごとの定義 =====

const FX_DEFS: Record<Exclude<FxType, "auto">, FxDef> = {
  // ライザー：ノイズの掃き上げ＋音程の上がるノコギリ波
  riser: {
    label: "ライザー",
    create: out => {
      const sp = space(out, { chorus: 0.5, delay: 0.25, delayTime: "8n." });
      const n = noiseRiser(sp.input, -16);
      const p = pitchRiser(sp.input, -22);
      return {
        rise:    (time, dur) => { n.rise(time, dur); p.rise(time, dur); },
        riseLen: "bars",
        nodes:   [...n.nodes, ...p.nodes, ...sp.nodes],
      };
    },
  },

  // ビルドアップ：ライザーで盛り上げて、次のループの頭にインパクト
  build: {
    label: "ライザー＋インパクト",
    create: out => {
      const sp = space(out, { chorus: 0.5, delay: 0.25, delayTime: "8n." });
      const n = noiseRiser(sp.input, -16);
      const p = pitchRiser(sp.input, -22);
      const i = impactHit(out, sp.input, -10);
      return {
        rise:    (time, dur) => { n.rise(time, dur); p.rise(time, dur); },
        riseLen: "bars",
        hit:     i.hit,
        nodes:   [...n.nodes, ...p.nodes, ...i.nodes, ...sp.nodes],
      };
    },
  },

  // インパクト：ループの頭の一撃だけ
  impact: {
    label: "インパクト",
    create: out => {
      const sp = space(out, { chorus: 0.4, delay: 0.2, delayTime: "4n", feedback: 0.3 });
      const i = impactHit(out, sp.input, -9);
      return { hit: i.hit, nodes: [...i.nodes, ...sp.nodes] };
    },
  },

  // ダウンリフター：ループの頭からノイズと音程が1小節かけて下がっていく
  downlifter: {
    label: "ダウンリフター",
    create: out => {
      const sp     = space(out, { chorus: 0.5, delay: 0.3, delayTime: "4n." });
      const panner = new Tone.AutoPanner({ frequency: 0.3, depth: 0.4 }).connect(sp.input).start();
      const amp    = new Tone.Gain(0).connect(panner);
      const band   = new Tone.Filter({ type: "bandpass", frequency: 9000, Q: 1.2 }).connect(amp);
      const noise  = stereoNoise(-15);
      noise.output.connect(band);
      const toneAmp = new Tone.Gain(0).connect(sp.input);
      const osc     = new Tone.Oscillator({ type: "triangle", frequency: 700, volume: -16 }).connect(toneAmp);

      const hit = (time: number) => {
        const dur = Tone.Time("1m").toSeconds();
        const end = time + dur;
        band.frequency.cancelScheduledValues(time);
        band.frequency.setValueAtTime(9000, time);
        band.frequency.exponentialRampToValueAtTime(250, end);
        curve(amp.gain, time, dur, x => (1 - x) ** 2.2);
        osc.frequency.cancelScheduledValues(time);
        osc.frequency.setValueAtTime(700, time);
        osc.frequency.exponentialRampToValueAtTime(60, time + dur * 0.6);
        curve(toneAmp.gain, time, dur * 0.6, x => (1 - x) ** 2);
        noise.start(time).stop(end + 0.01);
        osc.start(time).stop(time + dur * 0.6 + 0.01);
      };
      return { hit, nodes: [...noise.nodes, band, amp, panner, osc, toneAmp, ...sp.nodes] };
    },
  },

  // リバースシンバル：最後の2拍で金属的な響きがふくらみ、ループの頭でぷつっと切れる
  reverse: {
    label: "リバースシンバル",
    create: out => {
      // 切れたあとにディレイの返しが左右に残る
      const sp    = space(out, { chorus: 0.4, delay: 0.2, delayTime: "8n", feedback: 0.4 });
      const amp   = new Tone.Gain(0).connect(sp.input);
      const high  = new Tone.Filter({ type: "highpass", frequency: 3500, Q: 0.7 }).connect(amp);
      const noise = stereoNoise(-18);
      noise.output.connect(high);
      const metalAmp = new Tone.Gain(0).connect(sp.input);
      const metal = new Tone.MetalSynth({
        envelope:        { attack: 0.001, decay: 4, release: 0.05 },
        harmonicity:     5.1,
        modulationIndex: 24,
        resonance:       5000,
        octaves:         1.5,
        volume:          -24,
      }).connect(metalAmp);
      metal.frequency.value = 220;

      const rise = (time: number, dur: number) => {
        const end = time + dur;
        curve(amp.gain, time, dur - 0.02, x => x ** 3);
        fadeOut(amp.gain, end - 0.02, 0.02);
        curve(metalAmp.gain, time, dur - 0.02, x => x ** 3);
        fadeOut(metalAmp.gain, end - 0.02, 0.02);
        metal.triggerAttackRelease(dur + 0.1, time);
        noise.start(time).stop(end + 0.01);
      };
      return { rise, riseLen: "2n", nodes: [...noise.nodes, high, amp, metal, metalAmp, ...sp.nodes] };
    },
  },

  // チップ（8bit）：最後の2拍で矩形波が32分音符で駆け上がり、ループの頭で「ピュン」と落ちる
  chip: {
    label: "チップSE",
    create: out => {
      // 8bit らしく、コーラスはかけずに左右に跳ねるディレイだけで広げる
      const sp  = space(out, { chorus: 0, delay: 0.3, delayTime: "8n.", feedback: 0.4 });
      const amp = new Tone.Gain(0).connect(sp.input);
      const osc = new Tone.Oscillator({ type: "square", frequency: 220, volume: -20 }).connect(amp);
      const zapAmp = new Tone.Gain(0).connect(sp.input);
      const zap    = new Tone.Oscillator({ type: "square", frequency: 1600, volume: -20 }).connect(zapAmp);

      const rise = (time: number, dur: number) => {
        const steps = 16;
        const step  = dur / steps;
        osc.frequency.cancelScheduledValues(time);
        for (let i = 0; i < steps; i++) {
          // 3半音ずつ上がる（4オクターブ）
          osc.frequency.setValueAtTime(220 * 2 ** ((i * 3) / 12), time + i * step);
        }
        amp.gain.cancelScheduledValues(time);
        amp.gain.setValueAtTime(0, time);
        amp.gain.linearRampToValueAtTime(1, time + 0.01);
        fadeOut(amp.gain, time + dur - 0.01, 0.01);
        osc.start(time).stop(time + dur + 0.01);
      };
      const hit = (time: number) => {
        const len = 0.35;
        zap.frequency.cancelScheduledValues(time);
        zap.frequency.setValueAtTime(1600, time);
        zap.frequency.exponentialRampToValueAtTime(70, time + len);
        curve(zapAmp.gain, time, len, x => 1 - x);
        zap.start(time).stop(time + len + 0.01);
      };
      return { rise, riseLen: "2n", hit, nodes: [osc, amp, zap, zapAmp, ...sp.nodes] };
    },
  },
};

// ===== grow で鳴らす定義 =====
// 各音はコアの「FX …」のプリセット（ID は fx_…）。長さで変わる値（EG の時間）は、鳴らすたびに
// GrowInstrument.setParamAtTime で当てる（AudioParam の合図なので、書き出しでもサンプル単位で合う）

// 長さで変わる値を当てる時刻を、発音より少し前にする（同じ時刻に複数当てると2サンプルずつずれるため）
const PARAM_LEAD = 0.002;

// プリセット（ID）の grow を1台作る。fixed はいつも上書きする値。プリセットがなければ null
function growFx(out: Tone.ToneAudioNode, id: string, fixed: Record<string, number> = {}) {
  const preset = findGrowPreset(id);
  if (preset < 0) return null;
  return new GrowInstrument(() => growPresetValuesWith(preset, fixed)).connect(out);
}

// 長さで変わる値（パラメーターの ID → 値）を当ててから鳴らす
function play(inst: GrowInstrument, note: string, dur: number, time: number, values: Record<string, number> = {}, velocity = 0.8) {
  Object.entries(values).forEach(([id, value]) => inst.setParamAtTime(id, value, Math.max(0, time - PARAM_LEAD)));
  inst.triggerAttackRelease(note, dur, time, velocity);
}

// 1小節の長さ（秒）
const barSeconds = () => 240 / getState().bpm;

// 作った grow をまとめて破棄する（どれかのプリセットがなくて grow で鳴らせないとき）
function disposeAll(list: ({ dispose(): unknown } | null | undefined)[]): null {
  list.forEach(n => n?.dispose());
  return null;
}

// ライザー（ノイズ＋音程）。音量・フィルター・音程が rise の長さをかけて上がる
function growRiser(out: Tone.ToneAudioNode) {
  const noise = growFx(out, "fx_riser_noise");
  const pitch = growFx(out, "fx_riser_pitch");
  if (!noise || !pitch) return disposeAll([noise, pitch]);
  return {
    rise: (time: number, dur: number) => {
      play(noise, "C4", dur - 0.03, time, { fenv_attack: dur, aenv_attack: dur });
      // ピッチ EG（直線）で2オクターブ下（A2）から長さいっぱいかけて上がる
      play(pitch, "A4", dur - 0.03, time, { fenv_attack: dur, aenv_attack: dur, penv_time: dur });
    },
    nodes: [noise, pitch],
  };
}

// インパクト（沈むブーム＋閉じていくノイズ）
function growImpact(out: Tone.ToneAudioNode) {
  const boom  = growFx(out, "fx_boom");
  const burst = growFx(out, "fx_burst");
  if (!boom || !burst) return disposeAll([boom, burst]);
  return {
    hit: (time: number) => {
      play(boom, "E1", 1.2, time, {}, 1);   // ピッチ EG で3オクターブ上から沈む
      play(burst, "C4", 1.2, time, {}, 1);
    },
    nodes: [boom, burst],
  };
}

const GROW_FX: Record<FxKind, (out: Tone.ToneAudioNode) => FxVoice | null> = {
  riser: out => {
    const r = growRiser(out);
    return r && { rise: r.rise, riseLen: "bars", nodes: r.nodes };
  },
  build: out => {
    const r = growRiser(out);
    const i = growImpact(out);
    if (!r || !i) return disposeAll([...(r?.nodes ?? []), ...(i?.nodes ?? [])]);
    return { rise: r.rise, riseLen: "bars", hit: i.hit, nodes: [...r.nodes, ...i.nodes] };
  },
  impact: out => {
    const i = growImpact(out);
    return i && { hit: i.hit, nodes: i.nodes };
  },
  // ダウンリフター：ループの頭から1小節かけてノイズと音程が下がる
  downlifter: out => {
    const noise = growFx(out, "fx_down_noise");
    const tone  = growFx(out, "fx_down_tone");
    if (!noise || !tone) return disposeAll([noise, tone]);
    return {
      hit: time => {
        const bar = barSeconds();
        play(noise, "C4", bar, time, { fenv_decay: bar, aenv_decay: bar });
        // ピッチ EG（直線）で3オクターブ上（B4）から下がる
        play(tone, "B1", bar * 0.6, time, { aenv_decay: bar * 0.6, penv_time: bar * 0.6 });
      },
      nodes: [noise, tone],
    };
  },
  // リバースシンバル：最後の2拍でふくらみ、ループの頭で切れる
  reverse: out => {
    const cymbal = growFx(out, "fx_reverse");
    if (!cymbal) return null;
    return {
      rise:    (time, dur) => play(cymbal, "C4", dur - 0.02, time, { aenv_attack: dur }),
      riseLen: "2n",
      nodes:   [cymbal],
    };
  },
  // チップSE：最後の2拍で32分音符の駆け上がり（3半音ずつ4オクターブ）、ループの頭で「ピュン」
  chip: out => {
    const run = growFx(out, "fx_chip");
    const zap = growFx(out, "fx_chip", { penv_amount: 36, penv_time: 0.35, aenv_decay: 0.35, aenv_sustain: 0 });
    if (!run || !zap) return disposeAll([run, zap]);
    return {
      rise: (time, dur) => {
        const steps = 16;
        const step  = dur / steps;
        for (let i = 0; i < steps; i++) {
          const midi = 57 + i * 3;  // A3 から
          run.triggerAttackRelease(Tone.Frequency(midi, "midi").toNote(), step * 0.95, time + i * step);
        }
      },
      riseLen: "2n",
      hit:   time => zap.triggerAttackRelease("G3", 0.35, time),  // ピッチ EG で3オクターブ上から落ちる
      nodes: [run, zap],
    };
  },
};

// ジャンルの標準（"auto" のとき）。ないジャンルはライザー
const GENRE_FX: Record<string, Exclude<FxType, "auto">> = {
  "EDM":        "build",
  "トランス":   "build",
  "ハウス":     "riser",
  "テクノ":     "impact",
  "8bit":       "chip",
  "ゲームBGM":  "chip",
  "ローファイ": "reverse",
  "アンビエント": "downlifter",
};

type FxKind = Exclude<FxType, "auto">;

// 選択肢（アレンジャーのブロックの種類選び用）
export const FX_OPTIONS: { value: FxKind; label: string }[] =
  (Object.keys(FX_DEFS) as FxKind[]).map(value => ({ value, label: FX_DEFS[value].label }));

// 曲の設定で鳴らす FX の種類（"auto" はジャンルから決める）
export function resolveFxType(): FxKind {
  const s = getState();
  if (s.fxType !== "auto" && FX_DEFS[s.fxType]) return s.fxType;
  return GENRE_FX[s.genre] ?? "riser";
}

// ブロックで鳴らす種類（ブロックに指定がなければ曲の設定）
export function blockFxType(block?: ArrangeBlock | null): FxKind {
  const fx = block?.fx;
  return fx && fx !== "auto" && FX_DEFS[fx] ? fx : resolveFxType();
}

// アレンジャーなどの表示名（ブロックを渡すとそのブロックの種類）
export function fxLabel(block?: ArrangeBlock | null): string {
  return FX_DEFS[blockFxType(block)].label;
}

// 試聴で鳴らし始める小節（ライザーの頭）。ループの頭のヒットまで聴けるよう、呼び出し側で1小節先まで鳴らす
export function fxPreviewStartBar(progression: ChordProgression): number {
  return Math.max(0, progression.length_bars - riseBars(progression));
}

function riseBars(progression: ChordProgression): number {
  return progression.length_bars >= 8 ? 2 : 1;
}

// ===== 読み込み =====

// 種類ごとの音源。曲の中で使う種類だけ作る（ブロックごとに種類が違ってもよい）
let fxPart: Tone.Part   | null = null;
let fxOut:  Tone.Volume | null = null;  // 現在のオーディオコンテキスト用の Volume ノード
const fxVoices = new Map<FxKind, FxVoice>();

function voiceFor(kind: FxKind): FxVoice | null {
  if (!fxOut) return null;
  let voice = fxVoices.get(kind);
  if (!voice) {
    voice = (isGrowReady() ? GROW_FX[kind](fxOut) : null) ?? FX_DEFS[kind].create(fxOut);
    fxVoices.set(kind, voice);
  }
  return voice;
}

// 曲の設定とアレンジの各ブロックで使う種類の音源を先に作っておく
// （WAV書き出しでは鳴らしている途中に作れないため。再生中にアレンジで新しい種類を選んだときは鳴らす直前に作る）
function prepareVoices() {
  voiceFor(resolveFxType());
  getArrangement().fx.forEach(b => voiceFor(blockFxType(b)));
}

export function initFxSynth() {
  disposeVoices();
  fxOut = createVolumeNode("fx");
  prepareVoices();
}

// hit = ループの頭、bars / 2n = rise の始まり（種類の riseLen に合うものだけ鳴らす）
interface FxEvent {
  time: string;
  kind: "hit" | "bars" | "2n";
}

export function loadFx(progression: ChordProgression) {
  if (fxPart) { fxPart.dispose(); fxPart = null; }
  if (!fxOut) initFxSynth();
  else prepareVoices();

  const len  = progression.length_bars;
  const rise = riseBars(progression);
  const events: FxEvent[] = [
    { time: "0:0:0",                kind: "hit"  },
    { time: `${len - rise}:0:0`,    kind: "bars" },
    { time: `${len - 1}:2:0`,       kind: "2n"   },
  ];

  // 鳴らすかどうかと種類は、発音時刻にあるブロックで決める（再生中のアレンジの編集もすぐ反映される）
  const blockAt  = arrangementBlockAt("fx");
  const position = positionAt();
  fxPart = new Tone.Part((time, event: FxEvent) => {
    const block = blockAt(time);
    if (block === undefined) return;
    if (position(time).bar === endingBar()) return;  // エンディングの小節では鳴らさない（主和音で静かに終える）
    const voice = voiceFor(blockFxType(block));
    if (!voice) return;
    if (event.kind === "hit") {
      voice.hit?.(time);
    } else if (voice.rise && event.kind === (voice.riseLen ?? "bars")) {
      const dur = event.kind === "2n" ? Tone.Time("2n").toSeconds() : Tone.Time(`${rise}m`).toSeconds();
      voice.rise(time, dur);
    }
  }, events);

  fxPart.loop    = true;
  fxPart.loopEnd = `${len}m`;
  fxPart.start(0);
}

function disposeVoices() {
  fxVoices.forEach(v => v.nodes.forEach(n => n.dispose()));
  fxVoices.clear();
}

export function disposeFx() {
  fxPart?.dispose();
  fxPart = null;
  disposeVoices();
  fxOut = null;
}
