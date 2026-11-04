import * as Tone from "tone";
import { getState } from "./AppState";
import { initMixer, applyMixPreset, disposeMixer } from "./MixerEngine";
import { startLoopArranger, stopLoopArranger, setArrangementBypass } from "./LoopArranger";
import { disposeAllLayers, reloadLayer, reloadAllLayers } from "./LayerManager";

let endEventId: number | null = null;

interface PlayOptions {
  fromBar?:      number;  // 再生を始める小節（0始まり）。省略すると先頭から
  onLoopChange?: (loop: number, parts: string[]) => void;
  onEnded?:      () => void;
}

// 曲の先頭（または fromBar 小節目）から再生する。AppState.bars 小節で自動停止する
export async function play(options: PlayOptions = {}): Promise<void> {
  await Tone.start();
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;

  stop();
  disposeMixer();
  initMixer();
  applyMixPreset(s.genre);

  const transport = Tone.getTransport();
  transport.bpm.value = s.bpm;

  // ON のパートはすべて先頭で読み込み、どの小節で鳴らすかは各パートがアレンジを見て決める
  reloadAllLayers();
  const fromBar = Math.max(0, Math.min(options.fromBar ?? 0, s.bars - 1));
  startLoopArranger({
    loopBars:     s.chordPattern.length_bars,
    fromBar,
    onLoopChange: options.onLoopChange,
  });

  endEventId = transport.scheduleOnce(time => {
    Tone.getDraw().schedule(() => {
      stop();
      options.onEnded?.();
    }, time);
  }, `${s.bars}m`);

  // ループする Part は Transport の位置に合わせて途中から鳴る
  transport.start(undefined, `${fromBar}m`);
}

// 1つのパートだけを試聴する（コード進行は1周、ドラムは2小節）。曲の再生中なら止めてから鳴らす
// アレンジに関係なく鳴らすので、試聴中はアレンジの判定を外す
export async function preview(layer: "chord" | "drum", onEnded?: () => void): Promise<void> {
  await Tone.start();
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;

  stop();
  disposeMixer();
  initMixer();
  applyMixPreset(s.genre);

  const transport = Tone.getTransport();
  transport.bpm.value = s.bpm;
  setArrangementBypass(true);
  reloadLayer(layer);

  const bars = layer === "chord" ? s.chordPattern.length_bars : 2;
  endEventId = transport.scheduleOnce(time => {
    Tone.getDraw().schedule(() => {
      stop();
      onEnded?.();
    }, time);
  }, `${bars}m`);

  transport.start();
}

// 停止して、前回読み込んだ Part をすべて破棄する
export function stop(): void {
  const transport = Tone.getTransport();
  transport.stop();
  if (endEventId !== null) {
    transport.clear(endEventId);
    endEventId = null;
  }
  stopLoopArranger();
  setArrangementBypass(false);
  disposeAllLayers();
  transport.position = 0;
}

export function isPlaying(): boolean {
  return Tone.getTransport().state === "started";
}

// 再生中の BPM 変更（タップテンポなど）を Transport に反映する
export function applyBpm(): void {
  Tone.getTransport().bpm.value = getState().bpm;
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

// 曲全体をオフラインでレンダリングして WAV の Blob を返す
export async function renderWav(): Promise<Blob> {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) throw new Error("曲が生成されていません");

  const chordPattern = s.chordPattern;
  const drumPattern  = s.drumPattern;
  const durationSec  = getSongSeconds() + 2;

  // 各パートの Synth はモジュールに1つずつなので、再生を止めてから書き出し用に作り直す
  stop();

  const buffer = await Tone.Offline(async () => {
    initMixer();
    applyMixPreset(s.genre);
    Tone.getTransport().bpm.value = s.bpm;

    const { loadDrumPattern: loadDrum }                          = await import("./DrumEngine");
    const { initChordSynth: initC, loadChordProgression: loadC } = await import("./ChordPlayer");
    const { initBassSynth: initB,  loadBassLine: loadB }         = await import("./BassPlayer");
    const { initArpSynth: initAr,  loadArpPattern: loadAr }      = await import("./ArpPlayer");
    const { initPadSynth: initP,   loadPadPattern: loadP }       = await import("./PadPlayer");
    const { initMelodySynth: initM, loadMelody: loadMel }        = await import("./MelodyPlayer");
    const { initFxSynth: initF,    loadFx: loadF }               = await import("./FxPlayer");

    if (s.parts.drum)   loadDrum(drumPattern);
    if (s.parts.chord)  { initC();  loadC(chordPattern, s.key, 4); }
    if (s.parts.bass)   { initB();  loadB(chordPattern, s.key, 2); }
    if (s.parts.arp)    { initAr(); loadAr(chordPattern, s.key, 5, "8n"); }
    if (s.parts.pad)    { initP();  loadP(chordPattern, s.key, 4); }
    if (s.parts.melody) { initM();  loadMel(s.melodyNotes, `${chordPattern.length_bars}m`); }
    if (s.parts.fx)     { initF();  loadF(chordPattern); }
    Tone.getTransport().start();
  }, durationSec);

  // 書き出し用コンテキストの Synth を破棄する（次の再生で通常のコンテキストに作り直される）
  disposeAllLayers();

  return new Blob([audioBufferToWav(buffer.get()!)], { type: "audio/wav" });
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
