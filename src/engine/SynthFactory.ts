import * as Tone from "tone";
import { getDrumSample } from "./DrumSamples";
import { GrowInstrument, findGrowPreset, growPresetValuesWith, isGrowReady } from "./Grow";

// ドラムの1音色。output をドラムのバスにつなぎ、trigger で鳴らす
export interface DrumVoice {
  output:  Tone.ToneAudioNode;
  trigger: (time: number, velocity: number) => void;
  choke?:  (time: number) => void;  // 鳴っている音を止める（オープンハイハット用）
  dispose: () => void;
}

// ジャンルごとのキットの音作り
interface DrumKitParams {
  kick: {
    note:      string;   // 最後に落ち着く音程
    octaves:   number;   // アタックの音程の高さ（何オクターブ上から下がるか）
    pitchDecay: number;
    decay:     number;
    wave:      "sine" | "square" | "triangle";
    click:     number;   // アタックのクリック音の量（0〜1）
  };
  snare: { tone: number; decay: number; noiseFreq: number };
  hat:   { decay: number; openDecay: number; freq: number };
  bus: {
    lowpass:    number;  // 全体の高域カット（Hz）
    drive:      number;  // 歪みの量（0〜1）
    compress:   number;  // コンプのしきい値（dB）
    makeup:     number;  // コンプ後の持ち上げ（dB）。ほかのパートとの音量差をそろえる
  };
}

const DEFAULT_KIT: DrumKitParams = {
  kick:  { note: "C1", octaves: 5, pitchDecay: 0.04, decay: 0.38, wave: "sine", click: 0.35 },
  snare: { tone: 190, decay: 0.16, noiseFreq: 1800 },
  hat:   { decay: 0.045, openDecay: 0.32, freq: 8000 },
  bus:   { lowpass: 18000, drive: 0.12, compress: -14, makeup: 5 },
};

// ジャンル別のキット。ないジャンルは DEFAULT_KIT で鳴る
const DRUM_KITS: Record<string, DrumKitParams> = {
  EDM: DEFAULT_KIT,
  テクノ: {
    kick:  { note: "A0", octaves: 5.5, pitchDecay: 0.05, decay: 0.55, wave: "sine", click: 0.5 },
    snare: { tone: 170, decay: 0.14, noiseFreq: 2200 },
    hat:   { decay: 0.035, openDecay: 0.25, freq: 9000 },
    bus:   { lowpass: 16000, drive: 0.3, compress: -16, makeup: 2 },
  },
  ローファイ: {
    kick:  { note: "D1", octaves: 3.5, pitchDecay: 0.03, decay: 0.3, wave: "sine", click: 0.1 },
    snare: { tone: 210, decay: 0.2, noiseFreq: 1400 },
    hat:   { decay: 0.04, openDecay: 0.22, freq: 7000 },
    bus:   { lowpass: 5500, drive: 0.2, compress: -18, makeup: 5 },
  },
  "8bit": {
    kick:  { note: "C2", octaves: 3, pitchDecay: 0.05, decay: 0.15, wave: "square", click: 0 },
    snare: { tone: 240, decay: 0.1, noiseFreq: 3000 },
    hat:   { decay: 0.03, openDecay: 0.15, freq: 10000 },
    bus:   { lowpass: 12000, drive: 0.05, compress: -10, makeup: 8 },
  },
  ゲームBGM: {
    kick:  { note: "C1", octaves: 4, pitchDecay: 0.035, decay: 0.32, wave: "sine", click: 0.2 },
    snare: { tone: 200, decay: 0.15, noiseFreq: 1800 },
    hat:   { decay: 0.04, openDecay: 0.28, freq: 8000 },
    bus:   { lowpass: 15000, drive: 0.05, compress: -12, makeup: 8 },
  },
  ハウス: {
    kick:  { note: "C1", octaves: 4.5, pitchDecay: 0.04, decay: 0.45, wave: "sine", click: 0.3 },
    snare: { tone: 200, decay: 0.18, noiseFreq: 2000 },
    hat:   { decay: 0.04, openDecay: 0.4, freq: 8500 },
    bus:   { lowpass: 17000, drive: 0.15, compress: -14, makeup: 4 },
  },
  // トランス：低く伸びるキックに、明るく短いハイハット
  トランス: {
    kick:  { note: "B0", octaves: 5, pitchDecay: 0.045, decay: 0.5, wave: "sine", click: 0.45 },
    snare: { tone: 190, decay: 0.15, noiseFreq: 2000 },
    hat:   { decay: 0.035, openDecay: 0.22, freq: 9500 },
    bus:   { lowpass: 17000, drive: 0.18, compress: -15, makeup: 3 },
  },
  // アンビエント：アタックを丸め、高域を落として奥で鳴らす
  アンビエント: {
    kick:  { note: "D1", octaves: 2.5, pitchDecay: 0.03, decay: 0.4, wave: "sine", click: 0.05 },
    snare: { tone: 180, decay: 0.22, noiseFreq: 1200 },
    hat:   { decay: 0.03, openDecay: 0.3, freq: 6500 },
    bus:   { lowpass: 7000, drive: 0.05, compress: -18, makeup: 6 },
  },
};

// 強弱を音量に変換する（弱い音が小さくなりすぎないよう曲線をつける）
function velGain(velocity: number): number {
  return Math.pow(Math.max(0, Math.min(1, velocity)), 1.5);
}

// 短いノイズのアタック（キックのクリック・スネアの胴鳴り以外の部分などに使う）
function createNoiseBurst(
  noiseType: "white" | "pink",
  filter: Partial<Tone.FilterOptions>,
  decay: number
) {
  const out   = new Tone.Gain(1);
  const filt  = new Tone.Filter(filter).connect(out);
  const synth = new Tone.NoiseSynth({
    noise:    { type: noiseType },
    envelope: { attack: 0.001, decay, sustain: 0, release: 0.01 },
  }).connect(filt);
  return { out, synth, nodes: [out, filt, synth] as Tone.ToneAudioNode[] };
}

function createKick(p: DrumKitParams["kick"]): DrumVoice {
  const output = new Tone.Gain(1);
  const body = new Tone.MembraneSynth({
    pitchDecay: p.pitchDecay,
    octaves:    p.octaves,
    oscillator: { type: p.wave },
    envelope:   { attack: 0.001, decay: p.decay, sustain: 0, release: 0.05 },
  }).connect(output);

  const click = createNoiseBurst("white", { type: "highpass", frequency: 3000 }, 0.006);
  click.out.gain.value = p.click;
  click.out.connect(output);

  return {
    output,
    trigger: (time, velocity) => {
      const v = velGain(velocity);
      body.triggerAttackRelease(p.note, p.decay, time, v);
      if (p.click > 0) click.synth.triggerAttackRelease(0.006, time, v);
    },
    dispose: () => [body, ...click.nodes, output].forEach(n => n.dispose()),
  };
}

function createSnare(p: DrumKitParams["snare"]): DrumVoice {
  const output = new Tone.Gain(1);

  // 胴鳴り：短く音程が下がるトーン
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves:    1.5,
    oscillator: { type: "triangle" },
    envelope:   { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
    volume:     -6,
  }).connect(output);

  // 響き線：高めの帯域のノイズ
  const wires = createNoiseBurst("white", { type: "bandpass", frequency: p.noiseFreq, Q: 0.6 }, p.decay);
  wires.out.connect(output);

  return {
    output,
    trigger: (time, velocity) => {
      const v = velGain(velocity);
      body.triggerAttackRelease(p.tone, 0.09, time, v);
      wires.synth.triggerAttackRelease(p.decay, time, v);
    },
    dispose: () => [body, ...wires.nodes, output].forEach(n => n.dispose()),
  };
}

function createHihat(p: DrumKitParams["hat"], open: boolean): DrumVoice {
  const decay  = open ? p.openDecay : p.decay;
  const output = new Tone.Gain(open ? 0.55 : 0.6);
  const hp     = new Tone.Filter({ type: "highpass", frequency: p.freq * 0.8 }).connect(output);

  // 金属的な倍音
  const metal = new Tone.MetalSynth({
    harmonicity:     5.1,
    modulationIndex: 32,
    resonance:       p.freq,
    octaves:         1.5,
    envelope:        { attack: 0.001, decay, release: 0.02 },
    volume:          -14,
  }).connect(hp);

  // 空気感のノイズ
  const air = createNoiseBurst("white", { type: "highpass", frequency: p.freq }, decay * 0.8);
  air.out.gain.value = 0.35;
  air.out.connect(output);

  return {
    output,
    trigger: (time, velocity) => {
      const v = velGain(velocity);
      metal.triggerAttackRelease(300, decay, time, v);
      air.synth.triggerAttackRelease(decay * 0.8, time, v);
    },
    choke: time => {
      metal.triggerRelease(time);
      air.synth.triggerRelease(time);
    },
    dispose: () => [metal, hp, ...air.nodes, output].forEach(n => n.dispose()),
  };
}

function createClap(): DrumVoice {
  const output = new Tone.Gain(0);
  const noise  = new Tone.Noise("white");
  const filt   = new Tone.Filter({ type: "bandpass", frequency: 1200, Q: 1.2 }).connect(output);
  noise.connect(filt).start();

  return {
    output,
    // 手を叩く音：短いノイズを3回重ねてから余韻を残す
    trigger: (time, velocity) => {
      const v = Math.max(0.01, velGain(velocity));  // 指数カーブは0に向かえないので下限をつける
      const g = output.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(0, time);
      [0, 0.011, 0.022].forEach(offset => {
        g.setValueAtTime(v, time + offset);
        g.exponentialRampToValueAtTime(v * 0.1, time + offset + 0.009);
      });
      g.setValueAtTime(v * 0.9, time + 0.033);
      g.exponentialRampToValueAtTime(0.001, time + 0.2);
      g.setValueAtTime(0, time + 0.21);
    },
    dispose: () => [noise, filt, output].forEach(n => n.dispose()),
  };
}

function createRim(): DrumVoice {
  const output = new Tone.Gain(0.5);
  const bp     = new Tone.Filter({ type: "bandpass", frequency: 1700, Q: 2 }).connect(output);
  const tone   = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope:   { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 },
  }).connect(bp);
  const click = createNoiseBurst("white", { type: "bandpass", frequency: 3500, Q: 1 }, 0.008);
  click.out.connect(output);

  return {
    output,
    trigger: (time, velocity) => {
      const v = velGain(velocity);
      tone.triggerAttackRelease(1700, 0.035, time, v);
      click.synth.triggerAttackRelease(0.008, time, v);
    },
    dispose: () => [tone, bp, ...click.nodes, output].forEach(n => n.dispose()),
  };
}

// ===== ワンショット音源で鳴らす音色（DrumSamples.ts で読み込んだもの） =====

// 音源ファイルはシンセより大きく作られていることが多いので、バスに入る前に下げておく（dB）。
// 音源を差し替えたら mix_presets.json の gain と合わせて測り直す
const SAMPLE_TRIM_DB = -6;

// 止める（チョーク）ときのフェードアウト（秒）。急に切るとプツッと鳴るので少しだけ伸ばす
const CHOKE_FADE = 0.03;

function createSampleVoice(buffer: AudioBuffer): DrumVoice {
  const output = new Tone.Gain(SAMPLE_TRIM_DB, "decibels");
  const active = new Set<Tone.ToneBufferSource>();

  return {
    output,
    // 発音のたびに再生用のノードを作る（同じ音が重なっても前の音を切らない）。
    // ノードは output と同じコンテキストに作る（WAV / MP3 書き出しの合成中は Tone.getContext() が再生用のコンテキストに
    // 戻っているので、指定しないと別のコンテキストのノードになり、つなぐときに例外になる）
    trigger: (time, velocity) => {
      const src = new Tone.ToneBufferSource({ context: output.context, url: buffer, fadeOut: CHOKE_FADE }).connect(output);
      // 鳴り終わったノードは Tone.js が自動で破棄する（通常のコンテキストのみ）
      src.onended = () => active.delete(src);
      active.add(src);
      src.start(time, 0, undefined, velGain(velocity));
    },
    choke: time => active.forEach(src => src.stop(time)),
    dispose: () => {
      active.forEach(src => { if (!src.disposed) src.dispose(); });
      active.clear();
      output.dispose();
    },
  };
}

// ===== grow で鳴らす音色（コアの「ドラム …」のプリセット。ID は drum_…） =====
// トラックごとに grow を1台ずつ作る（同じタスクで作るので、ほかのパートの grow と1つのノードにまとまる）。
// ジャンルのキット（DRUM_KITS）の値は、プリセットの値を上書きして当てる（高さは音符で渡す）。
// どの音もサスティン 0 で鳴り終わるので、発音の合図だけ送る（オープンハイハットを止めるときだけ消音の合図）

const GROW_DRUMS: Record<string, string> = {
  kick:         "drum_kick",
  snare:        "drum_snare",
  hihat_closed: "drum_hat_closed",
  hihat_open:   "drum_hat_open",
  clap:         "drum_clap",
  rim:          "drum_rim",
};

// grow のドラムの出力の大きさ（dB）。grow は強さ 1 のピークを -6dB 前後（出力段のソフトクリップの手前）で出すので、
// 1打の聞こえる大きさ（400ms の窓のラウドネスの最大）がシンセ（Tone.js）のドラムと同じになるようここで合わせる。
// 差は全ジャンルでほぼ同じ（±1dB）だったので、その平均（2026-11-12 に測定）。プリセットや DRUM_KITS を変えたら測り直す
const GROW_TRIM_DB: Record<string, number> = {
  kick: 5, snare: 4.3, hihat_closed: -1.5, hihat_open: -3.6, clap: -1.1, rim: -3.1,
};

const GROW_WAVES: Record<DrumKitParams["kick"]["wave"], number> = { sine: 0, triangle: 1, square: 3 };

// ジャンルのキットの値 → grow で鳴らす高さと、プリセットに上書きする値（パラメーターの ID → 値）
function growDrumSound(name: string, p: DrumKitParams): { note: Tone.Unit.Frequency; values: Record<string, number> } {
  switch (name) {
    case "kick":
      return {
        note: p.kick.note,
        values: {
          osc1_wave:   GROW_WAVES[p.kick.wave],
          noise_level: 0.34 * p.kick.click,  // クリック（フィルター EG で頭だけ通るノイズ）
          aenv_decay:  p.kick.decay,
          // MembraneSynth は「高さ × octaves」から下がるので、半音にすると 12 × log2(octaves)
          penv_amount: 12 * Math.log2(Math.max(1, p.kick.octaves)),
          penv_time:   p.kick.pitchDecay * 2,  // 指数カーブ（はじめ速く戻る）なので少し長めに
          // サイン以外（8bit の矩形波など）は倍音を残す
          ...(p.kick.wave === "sine" ? {} : { filter_cutoff: 1500 }),
        },
      };
    case "snare":
      return { note: p.snare.tone, values: { aenv_decay: p.snare.decay, filter_cutoff: p.snare.noiseFreq } };
    case "hihat_closed":
      return { note: "G#5", values: { aenv_decay: p.hat.decay, filter_cutoff: p.hat.freq * 0.8 } };
    case "hihat_open":
      return { note: "G#5", values: { aenv_decay: p.hat.openDecay, filter_cutoff: p.hat.freq * 0.8 } };
    case "rim":
      return { note: 1700, values: {} };
    default:  // clap
      return { note: "C4", values: {} };
  }
}

// クラップ：短い音を3回重ねてから余韻を鳴らす（シンセのクラップと同じ間隔）
const CLAP_BURSTS = [0, 0.011, 0.022];
const CLAP_BURST_LEN = 0.006;
const CLAP_TAIL = 0.033;

// grow のドラムの1音色。grow を鳴らせない（準備ができていない・プリセットがない古い wasm）なら null
function createGrowVoice(name: string, p: DrumKitParams): DrumVoice | null {
  const preset = findGrowPreset(GROW_DRUMS[name] ?? GROW_DRUMS.clap);
  if (!isGrowReady() || preset < 0) return null;
  const { note, values } = growDrumSound(name, p);
  const output = new Tone.Gain(GROW_TRIM_DB[name] ?? 0, "decibels");
  const inst   = new GrowInstrument(() => growPresetValuesWith(preset, values)).connect(output);

  const trigger = name === "clap"
    ? (time: number, velocity: number) => {
        const v = velGain(velocity);
        CLAP_BURSTS.forEach(offset => {
          inst.triggerAttack(note, time + offset, v);
          inst.triggerRelease(note, time + offset + CLAP_BURST_LEN);
        });
        inst.triggerAttack(note, time + CLAP_TAIL, v * 0.9);
      }
    : (time: number, velocity: number) => { inst.triggerAttack(note, time, velGain(velocity)); };

  return {
    output,
    trigger,
    choke:   time => { inst.triggerRelease(note, time); },
    dispose: () => {
      inst.dispose();
      output.dispose();
    },
  };
}

// ドラムの音源：grow = grow（内部シンセ）、synth = Tone.js のシンセで合成、sample = ワンショット音源（ないトラックはシンセ）。
// grow を鳴らせないとき（wasm がない・準備ができていない）はシンセで鳴る
export type DrumSource = "grow" | "synth" | "sample";

// ドラムキット：トラック名ごとの音色と、全体をまとめるバス（高域カット→歪み→コンプ→持ち上げ）
export interface DrumKit {
  voices:  Record<string, DrumVoice>;
  output:  Tone.ToneAudioNode;
  dispose: () => void;
}

export function createDrumKit(genre: string, trackNames: string[], source: DrumSource = "synth"): DrumKit {
  const p = DRUM_KITS[genre] ?? DEFAULT_KIT;

  const makeup = new Tone.Gain(p.bus.makeup, "decibels");
  const comp = new Tone.Compressor({ threshold: p.bus.compress, ratio: 4, attack: 0.01, release: 0.12 })
    .connect(makeup);
  const drive = new Tone.Distortion({ distortion: p.bus.drive, wet: p.bus.drive > 0 ? 1 : 0, oversample: "2x" })
    .connect(comp);
  const lowpass = new Tone.Filter({ type: "lowpass", frequency: p.bus.lowpass, rolloff: -12 }).connect(drive);

  const factories: Record<string, () => DrumVoice> = {
    kick:         () => createKick(p.kick),
    snare:        () => createSnare(p.snare),
    hihat_closed: () => createHihat(p.hat, false),
    hihat_open:   () => createHihat(p.hat, true),
    clap:         createClap,
    rim:          createRim,
  };

  const voices: Record<string, DrumVoice> = {};
  for (const name of trackNames) {
    const sample = source === "sample" ? getDrumSample(genre, name) : undefined;
    const voice  = (sample ? createSampleVoice(sample) : null)
      ?? (source === "grow" ? createGrowVoice(name, p) : null)
      ?? (factories[name] ?? createClap)();
    voice.output.connect(lowpass);
    voices[name] = voice;
  }

  return {
    voices,
    output: makeup,
    dispose: () => {
      Object.values(voices).forEach(v => v.dispose());
      [lowpass, drive, comp, makeup].forEach(n => n.dispose());
    },
  };
}
