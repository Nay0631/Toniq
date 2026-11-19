import * as Tone from "tone";
import { AppState, getState, setState } from "./AppState";
import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import { applyMixPreset, fadeOutMaster, holdMasterFade, mixerReady, resetMasterFade } from "./MixerEngine";
import { getForcedPart, setArrangementBypass, setForcedPart, startLoopArranger, stopLoopArranger } from "./LoopArranger";
import { disposeAllLayers, reloadLayer, reloadAllLayers, LayerName } from "./LayerManager";
import { stopMetronome } from "./Metronome";
import { stopScalePreview } from "./ScalePreview";
import { stopGrowPreview } from "./GrowPreview";
import { prepareDrumSamples } from "./DrumSamples";
import { fxPreviewStartBar } from "./FxPlayer";
import { withoutHistory } from "./History";
import { applySwing } from "./Groove";
import { endingBar, songMelody, songProgression } from "./SongForm";
import { prepareGrowContext, applyGrowLive } from "./Grow";
import { beatsPerBar, type Meter } from "./Meter";

// 再生前の準備：リバーブの生成と、ドラムを音源で鳴らすときは音源の読み込み、grow（wasm と AudioWorklet）の準備を待つ
// （パッド・アルペジオ・シグネチャーはいつも grow で鳴らすので、grow の準備は毎回待つ。2回目からはすぐ終わる）
async function audioReady(genre: string): Promise<void> {
  await Promise.all([
    mixerReady(),
    getState().drumSource === "sample" ? prepareDrumSamples(genre) : Promise.resolve(),
    prepareGrowContext(),
  ]);
}

let endEventId: number | null = null;

// 再生の開始の番号。play / preview / playSample は音源の準備を待つ（await）あいだに、ほかの再生・停止が入ることがある。
// 開始と停止のたびに番号を進め、待ったあとで番号が変わっていたら（＝あとから別の操作があったら）その開始を取りやめる
let startToken = 0;

// 再生を始められなかったとき（壊れた曲ファイルのコード進行など）に呼ぶ関数。画面側（main.ts）が知らせる
let errorHandler: ((error: unknown) => void) | null = null;

export function onPlaybackError(fn: (error: unknown) => void): void {
  errorHandler = fn;
}

// 読み込みの途中で例外が出たら、中途半端に鳴らさないよう止めてから知らせる
function failStart(error: unknown): false {
  console.error("再生を始められませんでした:", error);
  stop();
  errorHandler?.(error);
  return false;
}

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

// 曲の先頭（または fromBar 小節目）から再生する。AppState.bars 小節で自動停止する（ループ再生なら先頭へ戻る）。
// 鳴らし始めたら true（準備を待つあいだに別の再生・停止が入った、読み込みに失敗したときは false）
export async function play(options: PlayOptions = {}): Promise<boolean> {
  await Tone.start();
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return false;

  stopMetronome();     // BPM のクリック音と重ねない
  stopScalePreview();  // キー・スケールの試聴とも重ねない
  stopGrowPreview();   // lidless の音色の試聴の1音とも重ねない
  stop();
  const token = ++startToken;
  applyMixPreset(s.genre);
  await audioReady(s.genre);
  if (token !== startToken) return false;  // 待っている間に別の再生・停止が入った

  try {
    resetMasterFade();  // サンプルの終わりで絞ったマスターを戻す
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
    return true;
  } catch (e) {
    return failStart(e);
  }
}

// 1つのパートだけを試聴する（コード進行は1周、ドラムは2小節）。曲の再生中なら止めてから鳴らす
// アレンジに関係なく鳴らすので、試聴中はアレンジの判定を外す
// FX はループの終わりの盛り上げ（ライザーなど）から次のループの頭の1小節まで鳴らす
export async function preview(layer: "chord" | "drum" | "fx", onEnded?: () => void): Promise<boolean> {
  await Tone.start();
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return false;

  stopMetronome();     // BPM のクリック音と重ねない
  stopScalePreview();  // キー・スケールの試聴とも重ねない
  stopGrowPreview();   // lidless の音色の試聴の1音とも重ねない
  stop();
  const token = ++startToken;
  applyMixPreset(s.genre);
  await audioReady(s.genre);
  if (token !== startToken) return false;  // 待っている間に別の再生・停止が入った

  try {
    resetMasterFade();  // サンプルの終わりで絞ったマスターを戻す
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
    return true;
  } catch (e) {
    return failStart(e);
  }
}

// ===== ジャンルのサンプル試聴 =====

export interface SampleSong {
  chordPattern: ChordProgression;
  drumPattern:  DrumPattern;
  meter:        Meter;                // ジャンルの標準の拍子（ワルツ = 3/4 など）
  melody:       () => MelodyNote[];   // メロディ。拍子を差し替えたあとに作る（マスの数え方が拍子で変わるため）
}

// サンプルで鳴らすパート（ジャンルの特徴が出るようシグネチャー・パーカッションも鳴らす。FX・カウンターメロディは除く）
const SAMPLE_LAYERS: LayerName[] = ["drum", "perc", "chord", "bass", "pad", "signature", "melody"];

// サンプルを鳴らす長さ（秒）と、終わりのフェードアウトの長さ（秒）。
// テンポ・進行の長さ・拍子によらず同じ長さで止める（短い進行はループし、長い進行は途中でフェードアウトする）
export const SAMPLE_SECONDS = 15;
const SAMPLE_FADE_SECONDS = 2;

// サンプル中だけ差し替えている曲の内容。stop() で AppState に戻す（null = サンプルを鳴らしていない）
let sampleRestore: Pick<AppState, "chordPattern" | "drumPattern" | "melodyNotes" | "meter"> | null = null;

// サンプルを止める合図（オーディオの時計の setTimeout の番号。null = 予定なし）。
// Transport の小節で決めると途中でテンポを変えたときに長さが変わるので、オーディオの時刻（秒）で決める
let sampleEndTimer: number | null = null;

// ジャンルのサンプルを SAMPLE_SECONDS 秒だけ鳴らす（終わりの SAMPLE_FADE_SECONDS 秒でフェードアウト）。
// 全パートをアレンジに関係なく同時に鳴らし、コード進行・メロディはループする。
// 各パートは AppState から読むので、鳴らしている間だけパターンとメロディを差し替え、止めたら元に戻す
export async function playSample(sample: SampleSong, onEnded?: () => void): Promise<boolean> {
  await Tone.start();
  stopMetronome();     // BPM のクリック音と重ねない
  stopScalePreview();  // キー・スケールの試聴とも重ねない
  stopGrowPreview();   // lidless の音色の試聴の1音とも重ねない
  stop();
  const token = ++startToken;
  applyMixPreset(getState().genre);
  await audioReady(getState().genre);
  if (token !== startToken) return false;  // 待っている間に別の再生・停止が入った

  const s = getState();
  sampleRestore = { chordPattern: s.chordPattern, drumPattern: s.drumPattern, melodyNotes: s.melodyNotes, meter: s.meter };
  // 一時的な差し替えなので元に戻す履歴には残さない。メロディは拍子を差し替えてから作る
  withoutHistory(() => {
    setState({ chordPattern: sample.chordPattern, drumPattern: sample.drumPattern, meter: sample.meter });
    setState({ melodyNotes: sample.melody() });
  });

  try {
    resetMasterFade();
    const transport = Tone.getTransport();
    transport.bpm.value = s.bpm;
    applySwing();  // サンプルはジャンルの標準のスウィング（曲の設定が null のとき）
    setArrangementBypass(true);
    SAMPLE_LAYERS.forEach(reloadLayer);

    // Transport は今（Tone.now()）から始まるので、その SAMPLE_SECONDS 秒後に無音になるよう絞り、そこで止める
    const startAt = Tone.now();
    const endAt   = startAt + SAMPLE_SECONDS;
    fadeOutMaster(endAt, SAMPLE_FADE_SECONDS);
    sampleEndTimer = Tone.getContext().setTimeout(() => {
      sampleEndTimer = null;
      stop();
      onEnded?.();
    }, endAt - Tone.now());

    transport.start(startAt);
    return true;
  } catch (e) {
    return failStart(e);
  }
}

export function isSamplePlaying(): boolean {
  return sampleRestore !== null;
}

// サンプルのために差し替える前の曲の内容（サンプルを鳴らしていなければ null）。保存していない変更の確認に使う
export function sampleOriginal(): Pick<AppState, "chordPattern" | "drumPattern" | "melodyNotes" | "meter"> | null {
  return sampleRestore;
}

// サンプルを鳴らしているときだけ止める（画面の切り替えなど）
export function stopSample(): void {
  if (isSamplePlaying()) stop();
}

// 停止して、前回読み込んだ Part をすべて破棄する
export function stop(): void {
  startToken++;  // 準備を待っている開始があれば取りやめる
  const transport = Tone.getTransport();
  transport.stop();
  transport.loop = false;  // ループ再生の設定は曲の再生のたびに applyLoopPlayback で付け直す
  songOnEnded = null;
  if (endEventId !== null) {
    transport.clear(endEventId);
    endEventId = null;
  }
  if (sampleEndTimer !== null) {
    Tone.getContext().clearTimeout(sampleEndTimer);
    sampleEndTimer = null;
  }
  holdMasterFade();  // サンプルのフェードの途中で止めたら、その音量のまま（次の開始で戻す）
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
  applyGrowLive();  // grow のテンポ同期（LFO・ディレイ）も合わせる
}

// 曲全体の長さ（秒）
export function getSongSeconds(): number {
  const s = getState();
  return (s.bars * beatsPerBar() * 60) / s.bpm;
}

// 書き出しで曲のあとに付ける余韻の長さ（秒）。リバーブの残りのために最低 2 秒。
// エンディングを使うときは、再生と同じく最後の主和音が切れないよう1小節ぶんは取る（遅い曲では1小節が 2 秒を超える）
const RENDER_TAIL_MIN = 2;

export function renderTailSeconds(): number {
  const s = getState();
  const barSeconds = getSongSeconds() / Math.max(1, s.bars);
  return endingBar() !== null ? Math.max(RENDER_TAIL_MIN, barSeconds) : RENDER_TAIL_MIN;
}

// 再生位置（秒）
export function getPositionSeconds(): number {
  return isPlaying() ? Tone.getTransport().seconds : 0;
}

// 再生位置（小節。曲の先頭からの小数）
export function getPositionBars(): number {
  if (!isPlaying()) return 0;
  const transport = Tone.getTransport();
  return transport.ticks / (transport.PPQ * beatsPerBar());
}

// 音声の書き出し（WAV / MP3）の進み具合。stage ごとの progress（0〜1）を全体の進み具合にまとめて知らせる
export type AudioFormat = "wav" | "mp3";
export type RenderStage = "prepare" | "schedule" | "render" | "encode";
export type RenderProgress = (stage: RenderStage, progress: number) => void;

// 書き出しを途中でやめた（画面の「中断する」。AbortSignal で知らせる）ときに投げる
export class RenderCancelled extends Error {
  constructor() {
    super("書き出しを中断しました");
    this.name = "RenderCancelled";
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RenderCancelled();
}

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
// 合成の途中で suspend して知らせる（Tone.js の Offline は途中経過を返さない）。
// signal で中断できる：予定の組み立ては打ち切り、合成は次の一時停止で止めたまま再開しない（RenderCancelled を投げる）
async function renderOffline(
  callback: () => Promise<void>, durationSec: number, onProgress?: RenderProgress, signal?: AbortSignal,
): Promise<AudioBuffer> {
  const sampleRate = Tone.getContext().sampleRate;
  const native     = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  const context    = new Tone.OfflineContext(native);
  const original   = Tone.getContext();

  let timer: ReturnType<typeof setInterval> | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    if (!signal) return;
    const onAbort = () => {
      if (timer !== null) clearInterval(timer);
      // Tone.js が演奏の予定を組み立てるループ（OfflineContext の _renderClock）は残りの長さ（_duration）で回るので、
      // 負にして次の周で抜けさせる（公開の API がないため内部の値を書き換える）
      (context as unknown as { _duration: number })._duration = -1;
      reject(new RenderCancelled());
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  cancelled.catch(() => { /* 待っていないときに中断しても未処理の例外にしない */ });

  Tone.setContext(context);
  let bufferPromise: Promise<Tone.ToneAudioBuffer>;
  try {
    await callback();
    throwIfCancelled(signal);

    // 合成の途中で一時停止して進み具合を知らせ、すぐ再開する（合成を始める前に予約しておく）。
    // 中断したあとは再開しない（合成はそこで止まり、残りは描かない）
    for (let i = 1; i < RENDER_STEPS; i++) {
      const at = (durationSec * i) / RENDER_STEPS;
      native.suspend(at)
        .then(() => {
          if (signal?.aborted) return;
          onProgress?.("render", i / RENDER_STEPS);
          return native.resume();
        })
        .catch(() => { /* 一時停止に対応していないときは途中経過なしで最後まで合成する */ });
    }

    // 1段目：Tone.js が演奏の予定（各パートのイベント）を時間順に組み立てる。currentTime で進み具合を測る
    timer = setInterval(() => onProgress?.("schedule", context.currentTime / durationSec), 100);
    bufferPromise = context.render().finally(() => { if (timer !== null) clearInterval(timer); });
  } finally {
    Tone.setContext(original);
  }
  const buffer = await Promise.race([bufferPromise, cancelled]);
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

// 曲全体をオフラインでレンダリングして AudioBuffer を返す（onProgress で進み具合を知らせる。signal で中断できる）。
// アプリでは renderWav / renderMp3 から使う。ミックスの計測（tools/mix-measure.mjs）は 16bit に丸める前の音を測るのに直接呼ぶ
export async function renderSong(onProgress?: RenderProgress, signal?: AbortSignal): Promise<AudioBuffer> {
  // ピアノロールを開いたまま書き出しても、アレンジのとおりに書き出す（編集中のパートを鳴らし続けるのは画面で聴くときだけ）
  const forced = getForcedPart();
  setForcedPart(null);
  try {
    return await renderSongWithArrangement(onProgress, signal);
  } finally {
    setForcedPart(forced);
  }
}

async function renderSongWithArrangement(onProgress?: RenderProgress, signal?: AbortSignal): Promise<AudioBuffer> {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) throw new Error("曲が生成されていません");

  const chordPattern = s.chordPattern;
  const drumPattern  = s.drumPattern;
  const song         = songProgression() ?? chordPattern;  // 曲全体の並び（セクション・エンディング）
  const melody       = songMelody();
  const durationSec  = getSongSeconds() + renderTailSeconds();

  onProgress?.("prepare", 0);
  // 各パートの Synth はモジュールに1つずつなので、再生を止めてから書き出し用に作り直す
  stop();
  // ドラムの音源は通常のコンテキストで読み込んでおく（AudioBuffer は書き出し用のコンテキストでも使える）
  if (s.drumSource === "sample") await prepareDrumSamples(s.genre);
  throwIfCancelled(signal);

  const schedule = async () => {
    applyMixPreset(s.genre);
    await mixerReady();
    // grow の AudioWorklet は書き出し用のコンテキストにも登録する
    await prepareGrowContext();
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
    const { initCounterSynth: initCo, loadCounter: loadCo }      = await import("./CounterPlayer");
    const { loadPerc }                                           = await import("./PercPlayer");

    if (s.parts.drum)   loadDrum(drumPattern);
    if (s.parts.perc)   loadPerc();
    if (s.parts.chord)  { initC();  loadC(song, s.key); }
    if (s.parts.bass)   { initB();  loadB(song, s.key, 2); }
    if (s.parts.arp)    { initAr(); loadAr(song, s.key); }
    if (s.parts.pad)    { initP();  loadP(song, s.key); }
    if (s.parts.signature) { initS(); loadS(song, s.key); }
    if (s.parts.melody) { initM();  loadMel(melody, `${song.length_bars}m`); }
    if (s.parts.counter) { initCo(); loadCo(song, melody, s.key); }
    if (s.parts.fx)     { initF();  loadF(chordPattern); }
    Tone.getTransport().start();
    onProgress?.("prepare", 1);
  };

  let buffer: AudioBuffer;
  try {
    buffer = await renderOffline(schedule, durationSec, onProgress, signal);
    // 鳴らすパートがあるのに無音なら、進み具合なしの Tone.Offline で描き直す（標準のコンテキストで動かない場合の保険）
    const anyPart = Object.values(s.parts).some(Boolean);
    if (anyPart && isSilent(buffer)) throw new Error("書き出した音声が無音でした");
  } catch (e) {
    if (e instanceof RenderCancelled) {
      disposeAllLayers();  // 書き出し用コンテキストの Synth を捨てる（描き直さない）
      throw e;
    }
    console.warn("進み具合付きの書き出しに失敗したので、Tone.Offline で書き出し直します:", e);
    disposeAllLayers();
    onProgress?.("render", 0);
    buffer = (await Tone.Offline(schedule, durationSec)).get()!;  // こちらは途中で止められないので、終わってから確かめる
    onProgress?.("render", 1);
  }

  // 書き出し用コンテキストの Synth を破棄する（次の再生で通常のコンテキストに作り直される）
  disposeAllLayers();
  throwIfCancelled(signal);
  return buffer;
}

// 曲全体を WAV の Blob にする
export async function renderWav(onProgress?: RenderProgress, signal?: AbortSignal): Promise<Blob> {
  const buffer = await renderSong(onProgress, signal);
  onProgress?.("encode", 0);
  await new Promise(resolve => setTimeout(resolve, 0));  // 表示を「変換中」にしてから重い変換をする
  throwIfCancelled(signal);
  const wav = audioBufferToWav(buffer);
  onProgress?.("encode", 1);
  return new Blob([wav], { type: "audio/wav" });
}

// 曲全体を MP3 の Blob にする
export async function renderMp3(onProgress?: RenderProgress, signal?: AbortSignal): Promise<Blob> {
  const buffer = await renderSong(onProgress, signal);
  onProgress?.("encode", 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  const mp3 = await audioBufferToMp3(buffer, p => onProgress?.("encode", p), signal);
  onProgress?.("encode", 1);
  return new Blob(mp3 as BlobPart[], { type: "audio/mpeg" });
}

export function renderAudio(format: AudioFormat, onProgress?: RenderProgress, signal?: AbortSignal): Promise<Blob> {
  return format === "mp3" ? renderMp3(onProgress, signal) : renderWav(onProgress, signal);
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

// AudioBuffer を MP3 に変換する（lamejs。重いので区切りながら変換し、合間に進み具合を知らせる。区切りごとに中断を確かめる）
async function audioBufferToMp3(
  buffer: AudioBuffer, onProgress: (p: number) => void, signal?: AbortSignal,
): Promise<Uint8Array[]> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");  // 使うときだけ読み込む
  const stereo  = buffer.numberOfChannels >= 2;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, buffer.sampleRate, MP3_KBPS);
  const left    = buffer.getChannelData(0);
  const right   = stereo ? buffer.getChannelData(1) : null;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < buffer.length; i += MP3_CHUNK) {
    throwIfCancelled(signal);
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
