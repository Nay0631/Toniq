import * as Tone from "tone";
import { AppState, getState, setState } from "./AppState";
import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import { applyMixPreset, mixerReady } from "./MixerEngine";
import { startLoopArranger, stopLoopArranger, setArrangementBypass } from "./LoopArranger";
import { disposeAllLayers, reloadLayer, reloadAllLayers, LayerName } from "./LayerManager";
import { stopMetronome } from "./Metronome";
import { stopScalePreview } from "./ScalePreview";
import { prepareDrumSamples } from "./DrumSamples";
import { fxPreviewStartBar } from "./FxPlayer";
import { withoutHistory } from "./History";
import { applySwing } from "./Groove";
import { endingBar, songMelody, songProgression } from "./SongForm";
import { applyToniqSynthLive } from "./MelodyPlayer";

// 再生前の準備：リバーブの生成と、ドラムを音源で鳴らすときは音源の読み込みを待つ
async function audioReady(genre: string): Promise<void> {
  await Promise.all([
    mixerReady(),
    getState().drumSource === "sample" ? prepareDrumSamples(genre) : Promise.resolve(),
  ]);
}

let endEventId: number | null = null;

interface PlayOptions {
  fromBar?:      number;  // 再生を始める小節（0始まり）。省略すると先頭から
  onLoopChange?: (loop: number, parts: string[]) => void;
  onEnded?:      () => void;
}

// 曲の再生（play）中の終わったときの処理。null = 曲を再生していない（試聴・サンプル・停止中）
let songOnEnded: (() => void) | null = null;

// 曲の終わりの扱いを AppState.loopPlayback に合わせる。
// ループ再生なら Transport を曲全体（先頭〜AppState.bars 小節）でループさせ、そうでなければ曲の終わりで止める
export function applyLoopPlayback(): void {
  if (songOnEnded === null) return;
  const transport = Tone.getTransport();
  const s = getState();
  if (endEventId !== null) {
    transport.clear(endEventId);
    endEventId = null;
  }
  if (s.loopPlayback) {
    transport.loopStart = 0;
    transport.loopEnd   = `${s.bars}m`;
    transport.loop      = true;
  } else {
    transport.loop = false;
    const onEnded = songOnEnded;
    // エンディングを使うときは、最後の主和音の余韻が切れないよう1小節待ってから止める
    const endAt = endingBar() !== null ? s.bars + 1 : s.bars;
    endEventId = transport.scheduleOnce(time => {
      Tone.getDraw().schedule(() => {
        stop();
        onEnded();
      }, time);
    }, `${endAt}m`);
  }
}

// 曲の先頭（または fromBar 小節目）から再生する。AppState.bars 小節で自動停止する（ループ再生なら先頭へ戻る）
export async function play(options: PlayOptions = {}): Promise<void> {
  await Tone.start();
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;

  stopMetronome();     // BPM のクリック音と重ねない
  stopScalePreview();  // キー・スケールの試聴とも重ねない
  stop();
  applyMixPreset(s.genre);
  await audioReady(s.genre);

  const transport = Tone.getTransport();
  transport.bpm.value = s.bpm;
  applySwing();

  // ON のパートはすべて先頭で読み込み、どの小節で鳴らすかは各パートがアレンジを見て決める
  reloadAllLayers();
  const fromBar = Math.max(0, Math.min(options.fromBar ?? 0, s.bars - 1));
  startLoopArranger({
    loopBars:     s.chordPattern.length_bars,
    fromBar,
    onLoopChange: options.onLoopChange,
  });

  songOnEnded = () => options.onEnded?.();
  applyLoopPlayback();

  // ループする Part は Transport の位置に合わせて途中から鳴る
  transport.start(undefined, `${fromBar}m`);
}

// 1つのパートだけを試聴する（コード進行は1周、ドラムは2小節）。曲の再生中なら止めてから鳴らす
// アレンジに関係なく鳴らすので、試聴中はアレンジの判定を外す
// FX はループの終わりの盛り上げ（ライザーなど）から次のループの頭の1小節まで鳴らす
export async function preview(layer: "chord" | "drum" | "fx", onEnded?: () => void): Promise<void> {
  await Tone.start();
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;

  stopMetronome();     // BPM のクリック音と重ねない
  stopScalePreview();  // キー・スケールの試聴とも重ねない
  stop();
  applyMixPreset(s.genre);
  await audioReady(s.genre);

  const transport = Tone.getTransport();
  transport.bpm.value = s.bpm;
  applySwing();
  setArrangementBypass(true);
  reloadLayer(layer);

  const fromBar = layer === "fx" ? fxPreviewStartBar(s.chordPattern) : 0;
  const endBar  = layer === "chord" ? s.chordPattern.length_bars
                : layer === "fx"    ? s.chordPattern.length_bars + 1
                : 2;
  endEventId = transport.scheduleOnce(time => {
    Tone.getDraw().schedule(() => {
      stop();
      onEnded?.();
    }, time);
  }, `${endBar}m`);

  transport.start(undefined, `${fromBar}m`);
}

// ===== ジャンルのサンプル試聴 =====

export interface SampleSong {
  chordPattern: ChordProgression;
  drumPattern:  DrumPattern;
  melodyNotes:  MelodyNote[];
}

// サンプルで鳴らすパート（ジャンルの特徴が出るようシグネチャーも鳴らす。FX は除く）
const SAMPLE_LAYERS: LayerName[] = ["drum", "chord", "bass", "pad", "signature", "melody"];

// サンプル中だけ差し替えている曲の内容。stop() で AppState に戻す（null = サンプルを鳴らしていない）
let sampleRestore: Pick<AppState, "chordPattern" | "drumPattern" | "melodyNotes"> | null = null;

// ジャンルのサンプルを1周（4小節未満の進行は4小節）だけ鳴らす。全パートをアレンジに関係なく同時に鳴らす。
// 各パートは AppState から読むので、鳴らしている間だけパターンとメロディを差し替え、止めたら元に戻す
export async function playSample(sample: SampleSong, onEnded?: () => void): Promise<void> {
  await Tone.start();
  stopMetronome();     // BPM のクリック音と重ねない
  stopScalePreview();  // キー・スケールの試聴とも重ねない
  stop();
  applyMixPreset(getState().genre);
  await audioReady(getState().genre);
  stop();  // 待っている間にほかの再生が始まっていたら止める

  const s = getState();
  sampleRestore = { chordPattern: s.chordPattern, drumPattern: s.drumPattern, melodyNotes: s.melodyNotes };
  withoutHistory(() => setState({ ...sample }));  // 一時的な差し替えなので元に戻す履歴には残さない

  const transport = Tone.getTransport();
  transport.bpm.value = s.bpm;
  applySwing();  // サンプルはジャンルの標準のスウィング（曲の設定が null のとき）
  setArrangementBypass(true);
  SAMPLE_LAYERS.forEach(reloadLayer);

  const bars = Math.max(4, sample.chordPattern.length_bars);
  endEventId = transport.scheduleOnce(time => {
    Tone.getDraw().schedule(() => {
      stop();
      onEnded?.();
    }, time);
  }, `${bars}m`);

  transport.start();
}

export function isSamplePlaying(): boolean {
  return sampleRestore !== null;
}

// サンプルを鳴らしているときだけ止める（画面の切り替えなど）
export function stopSample(): void {
  if (isSamplePlaying()) stop();
}

// 停止して、前回読み込んだ Part をすべて破棄する
export function stop(): void {
  const transport = Tone.getTransport();
  transport.stop();
  transport.loop = false;  // ループ再生の設定は曲の再生のたびに applyLoopPlayback で付け直す
  songOnEnded = null;
  if (endEventId !== null) {
    transport.clear(endEventId);
    endEventId = null;
  }
  stopLoopArranger();
  setArrangementBypass(false);
  disposeAllLayers();
  transport.position = 0;
  if (sampleRestore) {
    const restore = sampleRestore;
    withoutHistory(() => setState(restore));
    sampleRestore = null;
  }
}

export function isPlaying(): boolean {
  return Tone.getTransport().state === "started";
}

// 再生中の BPM 変更（タップテンポなど）を Transport に反映する
export function applyBpm(): void {
  Tone.getTransport().bpm.value = getState().bpm;
  applyToniqSynthLive();  // Toniq シンセのテンポ同期の LFO も合わせる
}

// 曲全体の長さ（秒）
export function getSongSeconds(): number {
  const s = getState();
  return (s.bars * 4 * 60) / s.bpm;
}

// 再生位置（秒）
export function getPositionSeconds(): number {
  return isPlaying() ? Tone.getTransport().seconds : 0;
}

// 再生位置（小節。曲の先頭からの小数）
export function getPositionBars(): number {
  if (!isPlaying()) return 0;
  const transport = Tone.getTransport();
  return transport.ticks / (transport.PPQ * 4);
}

// 音声の書き出し（WAV / MP3）の進み具合。stage ごとの progress（0〜1）を全体の進み具合にまとめて知らせる
export type AudioFormat = "wav" | "mp3";
export type RenderStage = "prepare" | "schedule" | "render" | "encode";
export type RenderProgress = (stage: RenderStage, progress: number) => void;

// 全体のうち各段階が占める割合（始まり・幅）。音声の合成がいちばん重い。
// MP3 は圧縮に時間がかかるので、変換の割合を大きく取る
const STAGE_SPAN: Record<AudioFormat, Record<RenderStage, [number, number]>> = {
  wav: {
    prepare:  [0,    0.05],
    schedule: [0.05, 0.2],
    render:   [0.25, 0.7],
    encode:   [0.95, 0.05],
  },
  mp3: {
    prepare:  [0,    0.04],
    schedule: [0.04, 0.16],
    render:   [0.2,  0.5],
    encode:   [0.7,  0.3],
  },
};

export function overallProgress(stage: RenderStage, progress: number, format: AudioFormat = "wav"): number {
  const [start, width] = STAGE_SPAN[format][stage];
  return start + width * Math.max(0, Math.min(1, progress));
}

const RENDER_STEPS = 40;  // 音声の合成の途中経過を知らせる回数

// Tone.Offline と同じ手順でオフライン描画する。進み具合を取るため、ブラウザ標準の OfflineAudioContext を使い、
// 合成の途中で suspend して知らせる（Tone.js の Offline は途中経過を返さない）
async function renderOffline(
  callback: () => Promise<void>, durationSec: number, onProgress?: RenderProgress,
): Promise<AudioBuffer> {
  const sampleRate = Tone.getContext().sampleRate;
  const native     = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  const context    = new Tone.OfflineContext(native);
  const original   = Tone.getContext();

  Tone.setContext(context);
  let bufferPromise: Promise<Tone.ToneAudioBuffer>;
  try {
    await callback();

    // 合成の途中で一時停止して進み具合を知らせ、すぐ再開する（合成を始める前に予約しておく）
    for (let i = 1; i < RENDER_STEPS; i++) {
      const at = (durationSec * i) / RENDER_STEPS;
      native.suspend(at)
        .then(() => {
          onProgress?.("render", i / RENDER_STEPS);
          return native.resume();
        })
        .catch(() => { /* 一時停止に対応していないときは途中経過なしで最後まで合成する */ });
    }

    // 1段目：Tone.js が演奏の予定（各パートのイベント）を時間順に組み立てる。currentTime で進み具合を測る
    const timer = setInterval(() => onProgress?.("schedule", context.currentTime / durationSec), 100);
    bufferPromise = context.render().finally(() => clearInterval(timer));
  } finally {
    Tone.setContext(original);
  }
  const buffer = await bufferPromise;
  onProgress?.("render", 1);
  return buffer.get()!;
}

// 書き出した音声がすべて無音か（念のための確認。無音なら Tone.Offline で描き直す）
function isSilent(buffer: AudioBuffer): boolean {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 64) if (data[i] !== 0) return false;
  }
  return true;
}

// 曲全体をオフラインでレンダリングして AudioBuffer を返す（onProgress で進み具合を知らせる）
async function renderSong(onProgress?: RenderProgress): Promise<AudioBuffer> {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) throw new Error("曲が生成されていません");

  const chordPattern = s.chordPattern;
  const drumPattern  = s.drumPattern;
  const song         = songProgression() ?? chordPattern;  // 曲全体の並び（セクション・エンディング）
  const melody       = songMelody();
  const durationSec  = getSongSeconds() + 2;

  onProgress?.("prepare", 0);
  // 各パートの Synth はモジュールに1つずつなので、再生を止めてから書き出し用に作り直す
  stop();
  // ドラムの音源は通常のコンテキストで読み込んでおく（AudioBuffer は書き出し用のコンテキストでも使える）
  if (s.drumSource === "sample") await prepareDrumSamples(s.genre);

  const schedule = async () => {
    applyMixPreset(s.genre);
    await mixerReady();
    Tone.getTransport().bpm.value = s.bpm;
    applySwing();  // 書き出し用の Transport にも同じスウィングをかける

    const { loadDrumPattern: loadDrum }                          = await import("./DrumEngine");
    const { initChordSynth: initC, loadChordProgression: loadC } = await import("./ChordPlayer");
    const { initBassSynth: initB,  loadBassLine: loadB }         = await import("./BassPlayer");
    const { initArpSynth: initAr,  loadArpPattern: loadAr }      = await import("./ArpPlayer");
    const { initPadSynth: initP,   loadPadPattern: loadP }       = await import("./PadPlayer");
    const { initSignatureSynth: initS, loadSignature: loadS }   = await import("./SignaturePlayer");
    const { initMelodySynth: initM, loadMelody: loadMel }        = await import("./MelodyPlayer");
    const { initFxSynth: initF,    loadFx: loadF }               = await import("./FxPlayer");

    if (s.parts.drum)   loadDrum(drumPattern);
    if (s.parts.chord)  { initC();  loadC(song, s.key); }
    if (s.parts.bass)   { initB();  loadB(song, s.key, 2); }
    if (s.parts.arp)    { initAr(); loadAr(song, s.key); }
    if (s.parts.pad)    { initP();  loadP(song, s.key); }
    if (s.parts.signature) { initS(); loadS(song, s.key); }
    if (s.parts.melody) { initM();  loadMel(melody, `${song.length_bars}m`); }
    if (s.parts.fx)     { initF();  loadF(chordPattern); }
    Tone.getTransport().start();
    onProgress?.("prepare", 1);
  };

  let buffer: AudioBuffer;
  try {
    buffer = await renderOffline(schedule, durationSec, onProgress);
    // 鳴らすパートがあるのに無音なら、進み具合なしの Tone.Offline で描き直す（標準のコンテキストで動かない場合の保険）
    const anyPart = Object.values(s.parts).some(Boolean);
    if (anyPart && isSilent(buffer)) throw new Error("書き出した音声が無音でした");
  } catch (e) {
    console.warn("進み具合付きの書き出しに失敗したので、Tone.Offline で書き出し直します:", e);
    disposeAllLayers();
    onProgress?.("render", 0);
    buffer = (await Tone.Offline(schedule, durationSec)).get()!;
    onProgress?.("render", 1);
  }

  // 書き出し用コンテキストの Synth を破棄する（次の再生で通常のコンテキストに作り直される）
  disposeAllLayers();
  return buffer;
}

// 曲全体を WAV の Blob にする
export async function renderWav(onProgress?: RenderProgress): Promise<Blob> {
  const buffer = await renderSong(onProgress);
  onProgress?.("encode", 0);
  await new Promise(resolve => setTimeout(resolve, 0));  // 表示を「変換中」にしてから重い変換をする
  const wav = audioBufferToWav(buffer);
  onProgress?.("encode", 1);
  return new Blob([wav], { type: "audio/wav" });
}

// 曲全体を MP3 の Blob にする
export async function renderMp3(onProgress?: RenderProgress): Promise<Blob> {
  const buffer = await renderSong(onProgress);
  onProgress?.("encode", 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  const mp3 = await audioBufferToMp3(buffer, p => onProgress?.("encode", p));
  onProgress?.("encode", 1);
  return new Blob(mp3 as BlobPart[], { type: "audio/mpeg" });
}

export function renderAudio(format: AudioFormat, onProgress?: RenderProgress): Promise<Blob> {
  return format === "mp3" ? renderMp3(onProgress) : renderWav(onProgress);
}

const MP3_KBPS  = 192;              // ビットレート（音楽として十分な音質とファイルの小ささの釣り合い）
const MP3_CHUNK = 1152 * 64;        // 一度に変換する長さ（MP3 の1フレーム = 1152 サンプルの倍数。この区切りで画面を更新する）

// -1〜1 の音声を 16bit 整数にする
function toInt16(data: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    out[i - from] = v < 0 ? v * 0x8000 : v * 0x7FFF;
  }
  return out;
}

// AudioBuffer を MP3 に変換する（lamejs。重いので区切りながら変換し、合間に進み具合を知らせる）
async function audioBufferToMp3(buffer: AudioBuffer, onProgress: (p: number) => void): Promise<Uint8Array[]> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");  // 使うときだけ読み込む
  const stereo  = buffer.numberOfChannels >= 2;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, buffer.sampleRate, MP3_KBPS);
  const left    = buffer.getChannelData(0);
  const right   = stereo ? buffer.getChannelData(1) : null;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < buffer.length; i += MP3_CHUNK) {
    const end = Math.min(i + MP3_CHUNK, buffer.length);
    const l   = toInt16(left, i, end);
    const out = right ? encoder.encodeBuffer(l, toInt16(right, i, end)) : encoder.encodeBuffer(l);
    if (out.length > 0) chunks.push(new Uint8Array(out));  // エンコーダの内部バッファを使い回されないよう写す
    onProgress(end / buffer.length);
    await new Promise(resolve => setTimeout(resolve, 0));  // 画面を固まらせない
  }
  const last = encoder.flush();
  if (last.length > 0) chunks.push(new Uint8Array(last));
  return chunks;
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh      = buffer.numberOfChannels;
  const sr         = buffer.sampleRate;
  const numSamples = buffer.length;
  const dataSize   = numSamples * numCh * 2;
  const ab         = new ArrayBuffer(44 + dataSize);
  const view       = new DataView(ab);
  const ws         = (o: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));

  ws(0, "RIFF"); view.setUint32(4,  36 + dataSize, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  view.setUint32(16, 16,           true);
  view.setUint16(20, 1,            true);
  view.setUint16(22, numCh,        true);
  view.setUint32(24, sr,           true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2,    true);
  view.setUint16(34, 16,           true);
  ws(36, "data"); view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return ab;
}

// Blob をファイルとして保存する
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
