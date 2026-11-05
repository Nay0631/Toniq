import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState, FxType } from "./AppState";

// FX / SE：ループの継ぎ目を演出する効果音
// 種類は AppState.fxType（"auto" ならジャンルの標準 GENRE_FX）。音色は Synth を作り直したとき（再生開始時）に反映される
// - rise：ループの終わりに向けて盛り上げる音（ライザー・リバースシンバルなど）。ループの頭ちょうどで終わる
// - hit ：ループの頭で鳴らす音（インパクト・ダウンリフターなど）

interface FxVoice {
  rise?:    (time: number, dur: number) => void;
  riseLen?: "bars" | "2n";  // bars = 1小節（8小節以上の進行は2小節）、2n = 最後の2拍
  hit?:     (time: number) => void;
  nodes:    Tone.ToneAudioNode[];  // 破棄するノード
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

// ノイズのライザー：白色ノイズをバンドパスで掃き上げ、左右に揺らしながら音量を上げる
function noiseRiser(out: Tone.ToneAudioNode, level: number) {
  const panner = new Tone.AutoPanner({ frequency: 0.5, depth: 0.6 }).connect(out).start();
  const amp    = new Tone.Gain(0).connect(panner);
  const band   = new Tone.Filter({ type: "bandpass", frequency: 400, Q: 1.4 }).connect(amp);
  const low    = new Tone.Filter({ type: "highpass", frequency: 150, Q: 0.7 }).connect(band);
  const noise  = new Tone.Noise({ type: "white", volume: level }).connect(low);

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
  return { rise, nodes: [noise, low, band, amp, panner] as Tone.ToneAudioNode[] };
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
function impactHit(out: Tone.ToneAudioNode, level: number) {
  const dist  = new Tone.Distortion({ distortion: 0.25, wet: 0.4 }).connect(out);
  const boom  = new Tone.MembraneSynth({
    pitchDecay: 0.25,
    octaves:    5,
    envelope:   { attack: 0.002, decay: 1.4, sustain: 0, release: 0.6 },
    volume:     level,
  }).connect(dist);
  const close = new Tone.Filter({ type: "lowpass", frequency: 6000, Q: 0.8 }).connect(out);
  const burst = new Tone.NoiseSynth({
    noise:    { type: "white" },
    envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.3 },
    volume:   level - 8,
  }).connect(close);

  const hit = (time: number) => {
    boom.triggerAttackRelease(42, 1.2, time);
    close.frequency.cancelScheduledValues(time);
    close.frequency.setValueAtTime(6000, time);
    close.frequency.exponentialRampToValueAtTime(400, time + 0.9);
    burst.triggerAttackRelease(0.9, time);
  };
  return { hit, nodes: [boom, dist, burst, close] as Tone.ToneAudioNode[] };
}

// ===== 種類ごとの定義 =====

const FX_DEFS: Record<Exclude<FxType, "auto">, FxDef> = {
  // ライザー：ノイズの掃き上げ＋音程の上がるノコギリ波
  riser: {
    label: "ライザー",
    create: out => {
      const n = noiseRiser(out, -16);
      const p = pitchRiser(out, -22);
      return {
        rise:    (time, dur) => { n.rise(time, dur); p.rise(time, dur); },
        riseLen: "bars",
        nodes:   [...n.nodes, ...p.nodes],
      };
    },
  },

  // ビルドアップ：ライザーで盛り上げて、次のループの頭にインパクト
  build: {
    label: "ライザー＋インパクト",
    create: out => {
      const n = noiseRiser(out, -16);
      const p = pitchRiser(out, -22);
      const i = impactHit(out, -10);
      return {
        rise:    (time, dur) => { n.rise(time, dur); p.rise(time, dur); },
        riseLen: "bars",
        hit:     i.hit,
        nodes:   [...n.nodes, ...p.nodes, ...i.nodes],
      };
    },
  },

  // インパクト：ループの頭の一撃だけ
  impact: {
    label: "インパクト",
    create: out => {
      const i = impactHit(out, -9);
      return { hit: i.hit, nodes: i.nodes };
    },
  },

  // ダウンリフター：ループの頭からノイズと音程が1小節かけて下がっていく
  downlifter: {
    label: "ダウンリフター",
    create: out => {
      const panner = new Tone.AutoPanner({ frequency: 0.3, depth: 0.5 }).connect(out).start();
      const amp    = new Tone.Gain(0).connect(panner);
      const band   = new Tone.Filter({ type: "bandpass", frequency: 9000, Q: 1.2 }).connect(amp);
      const noise  = new Tone.Noise({ type: "white", volume: -15 }).connect(band);
      const toneAmp = new Tone.Gain(0).connect(out);
      const osc     = new Tone.Oscillator({ type: "triangle", frequency: 700, volume: -16 }).connect(toneAmp);

      const hit = (time: number) => {
        const dur = Tone.Time("1m").toSeconds();
        const end = time + dur;
        band.frequency.cancelScheduledValues(time);
        band.frequency.setValueAtTime(9000, time);
        band.frequency.exponentialRampToValueAtTime(250, end);
        curve(amp.gain, time, dur, x => Math.pow(1 - x, 2.2));
        osc.frequency.cancelScheduledValues(time);
        osc.frequency.setValueAtTime(700, time);
        osc.frequency.exponentialRampToValueAtTime(60, time + dur * 0.6);
        curve(toneAmp.gain, time, dur * 0.6, x => Math.pow(1 - x, 2));
        noise.start(time).stop(end + 0.01);
        osc.start(time).stop(time + dur * 0.6 + 0.01);
      };
      return { hit, nodes: [noise, band, amp, panner, osc, toneAmp] };
    },
  },

  // リバースシンバル：最後の2拍で金属的な響きがふくらみ、ループの頭でぷつっと切れる
  reverse: {
    label: "リバースシンバル",
    create: out => {
      const amp   = new Tone.Gain(0).connect(out);
      const high  = new Tone.Filter({ type: "highpass", frequency: 3500, Q: 0.7 }).connect(amp);
      const noise = new Tone.Noise({ type: "white", volume: -18 }).connect(high);
      const metalAmp = new Tone.Gain(0).connect(out);
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
        curve(amp.gain, time, dur - 0.02, x => Math.pow(x, 3));
        fadeOut(amp.gain, end - 0.02, 0.02);
        curve(metalAmp.gain, time, dur - 0.02, x => Math.pow(x, 3));
        fadeOut(metalAmp.gain, end - 0.02, 0.02);
        metal.triggerAttackRelease(dur + 0.1, time);
        noise.start(time).stop(end + 0.01);
      };
      return { rise, riseLen: "2n", nodes: [noise, high, amp, metal, metalAmp] };
    },
  },

  // チップ（8bit）：最後の2拍で矩形波が32分音符で駆け上がり、ループの頭で「ピュン」と落ちる
  chip: {
    label: "チップSE",
    create: out => {
      const amp = new Tone.Gain(0).connect(out);
      const osc = new Tone.Oscillator({ type: "square", frequency: 220, volume: -20 }).connect(amp);
      const zapAmp = new Tone.Gain(0).connect(out);
      const zap    = new Tone.Oscillator({ type: "square", frequency: 1600, volume: -20 }).connect(zapAmp);

      const rise = (time: number, dur: number) => {
        const steps = 16;
        const step  = dur / steps;
        osc.frequency.cancelScheduledValues(time);
        for (let i = 0; i < steps; i++) {
          // 3半音ずつ上がる（4オクターブ）
          osc.frequency.setValueAtTime(220 * Math.pow(2, (i * 3) / 12), time + i * step);
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
      return { rise, riseLen: "2n", hit, nodes: [osc, amp, zap, zapAmp] };
    },
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

// 今の設定で鳴らす FX の種類（"auto" はジャンルから決める）
export function resolveFxType(): Exclude<FxType, "auto"> {
  const s = getState();
  if (s.fxType !== "auto" && FX_DEFS[s.fxType]) return s.fxType;
  return GENRE_FX[s.genre] ?? "riser";
}

// アレンジャーなどの表示名
export function fxLabel(): string {
  return FX_DEFS[resolveFxType()].label;
}

// 試聴で鳴らし始める小節（ライザーの頭）。ループの頭のヒットまで聴けるよう、呼び出し側で1小節先まで鳴らす
export function fxPreviewStartBar(progression: ChordProgression): number {
  return Math.max(0, progression.length_bars - riseBars(progression));
}

function riseBars(progression: ChordProgression): number {
  return progression.length_bars >= 8 ? 2 : 1;
}

// ===== 読み込み =====

let fxPart:  Tone.Part | null = null;
let fxVoice: FxVoice   | null = null;

export function initFxSynth() {
  const vol = createVolumeNode("fx");  // 現在のオーディオコンテキスト用のノード
  fxVoice = FX_DEFS[resolveFxType()].create(vol);
}

interface FxEvent {
  time: string;
  kind: "rise" | "hit";
}

export function loadFx(progression: ChordProgression) {
  if (fxPart) { fxPart.dispose(); fxPart = null; }
  if (!fxVoice) initFxSynth();
  const voice = fxVoice!;

  const len    = progression.length_bars;
  const events: FxEvent[] = [];
  if (voice.hit) events.push({ time: "0:0:0", kind: "hit" });
  if (voice.rise) {
    const start = voice.riseLen === "2n" ? `${len - 1}:2:0` : `${len - riseBars(progression)}:0:0`;
    events.push({ time: start, kind: "rise" });
  }

  const arranged = arrangementGate("fx");
  fxPart = new Tone.Part((time, event: FxEvent) => {
    if (!arranged(time) || !fxVoice) return;
    if (event.kind === "hit") {
      fxVoice.hit?.(time);
    } else {
      const dur = voice.riseLen === "2n"
        ? Tone.Time("2n").toSeconds()
        : Tone.Time(`${riseBars(progression)}m`).toSeconds();
      fxVoice.rise?.(time, dur);
    }
  }, events);

  fxPart.loop    = true;
  fxPart.loopEnd = `${len}m`;
  fxPart.start(0);
}

export function disposeFx() {
  fxPart?.dispose();
  fxVoice?.nodes.forEach(n => n.dispose());
  fxPart  = null;
  fxVoice = null;
}
