import * as Tone from "tone";
import { loadDrumPattern }                          from "./engine/DrumEngine";
import { initChordSynth, loadChordProgression }     from "./engine/ChordPlayer";
import { initBassSynth,  loadBassLine }             from "./engine/BassPlayer";
import { initArpSynth,   loadArpPattern }           from "./engine/ArpPlayer";
import { initPadSynth,   loadPadPattern }           from "./engine/PadPlayer";
import { initMelodySynth, loadMelody }              from "./engine/MelodyPlayer";
import { generateMelody }                           from "./engine/MelodyGenerator";
import { exportMidi }                               from "./engine/MidiExporter";
import { initMixer, applyMixPreset }                from "./engine/MixerEngine";
import { startLoopArranger, stopLoopArranger }      from "./engine/LoopArranger";
import { resolveSimpleMode }                        from "./engine/SimpleModeResolver";
import { getState, setState, applySimpleToCustom }  from "./engine/AppState";
import drumDB  from "./data/drum_patterns.json";
import chordDB from "./data/chord_progressions.json";
import { DrumPattern, ChordProgression } from "./data/types";

// シンプルモードで初期状態を解決
const initialResult = resolveSimpleMode("EDM", "明るい");
setState({
  genre:        "EDM",
  mood:         "明るい",
  bpm:          initialResult.bpm,
  chordPattern: initialResult.chordPattern,
  drumPattern:  initialResult.drumPattern,
});

window.addEventListener("load", () => {
  const playBtn       = document.getElementById("play");
  const stopBtn       = document.getElementById("stop");
  const regenBtn      = document.getElementById("regen");
  const exportBtn     = document.getElementById("export-wav");
  const exportMidiBtn = document.getElementById("export-midi");
  const toCustomBtn   = document.getElementById("to-custom");
  const presetLabel   = document.getElementById("preset-label");

  initChordSynth();
  initBassSynth();
  initArpSynth();
  initPadSynth();
  initMelodySynth();

  // メロディ生成
  let melodyNotes = generateMelody(
    getState().chordPattern!,
    getState().key,
    getState().genre.toLowerCase().replace(" ", "_")
  );
  setState({ melodyNotes });

  const startAll = () => {
    const s = getState();
    if (!s.chordPattern || !s.drumPattern) return;
    loadDrumPattern(s.drumPattern);
    loadChordProgression(s.chordPattern, s.key, 4);
    loadBassLine(s.chordPattern, s.key, 2);
    loadArpPattern(s.chordPattern, s.key, 5, "8n");
    loadPadPattern(s.chordPattern, s.key, 4);
    loadMelody(s.melodyNotes, `${s.chordPattern.length_bars}m`);
    Tone.getTransport().bpm.value = s.bpm;
  };

  playBtn?.addEventListener("click", async () => {
    await Tone.start();
    const s = getState();
    initMixer();
    applyMixPreset(s.genre);
    if (presetLabel) presetLabel.textContent = `${s.genre} / ${s.mood} — シンプルモード`;

    startLoopArranger({
      genre:        s.genre,
      chordPattern: s.chordPattern!,
      drumPattern:  s.drumPattern!,
      melodyNotes:  s.melodyNotes,
      key:          s.key,
      bpm:          s.bpm,
      onLoopChange: (loop, parts) => {
        if (presetLabel)
          presetLabel.textContent = `${s.genre} / ${s.mood} — 周回 ${loop} (${parts.join(", ")})`;
      },
    });

    Tone.getTransport().start();
  });

  stopBtn?.addEventListener("click", () => {
    Tone.getTransport().stop();
    stopLoopArranger();
  });

  regenBtn?.addEventListener("click", () => {
    const s = getState();
    const newMelody = generateMelody(s.chordPattern!, s.key, s.genre.toLowerCase());
    setState({ melodyNotes: newMelody });
    loadMelody(newMelody, `${s.chordPattern!.length_bars}m`);
  });

  // シンプル→カスタム引き継ぎボタン
  toCustomBtn?.addEventListener("click", () => {
    applySimpleToCustom();
    const s = getState();
    console.log("カスタムモードに引き継ぎ:", s);
    if (presetLabel)
      presetLabel.textContent =
        `${s.genre} / ${s.mood} — カスタムモード（引き継ぎ済み）`;
    alert(`カスタムモードに引き継ぎました。\nBPM: ${s.bpm}\nコード: ${s.chordPattern?.name}\nドラム: ${s.drumPattern?.name}`);
  });

  exportBtn?.addEventListener("click", async () => {
    exportBtn.textContent = "レンダリング中...";
    exportBtn.setAttribute("disabled", "true");
    try {
      const s           = getState();
      const bpm         = s.bpm;
      const bars        = s.chordPattern!.length_bars;
      const durationSec = (bars * 4 * 60) / bpm + 2;

      const buffer = await Tone.Offline(async () => {
        initMixer();
        applyMixPreset(s.genre);
        Tone.getTransport().bpm.value = bpm;

        const { loadDrumPattern: loadDrum }               = await import("./engine/DrumEngine");
        const { initChordSynth: initC, loadChordProgression: loadC } = await import("./engine/ChordPlayer");
        const { initBassSynth: initB,  loadBassLine: loadB }         = await import("./engine/BassPlayer");
        const { initArpSynth: initAr,  loadArpPattern: loadAr }      = await import("./engine/ArpPlayer");
        const { initPadSynth: initP,   loadPadPattern: loadP }       = await import("./engine/PadPlayer");
        const { initMelodySynth: initM, loadMelody: loadMel }        = await import("./engine/MelodyPlayer");

        loadDrum(s.drumPattern!);
        initC(); loadC(s.chordPattern!, s.key, 4);
        initB(); loadB(s.chordPattern!, s.key, 2);
        initAr(); loadAr(s.chordPattern!, s.key, 5, "8n");
        initP(); loadP(s.chordPattern!, s.key, 4);
        initM(); loadMel(s.melodyNotes, `${bars}m`);
        Tone.getTransport().start();
      }, durationSec);

      const wav  = audioBufferToWav(buffer.get()!);
      const blob = new Blob([wav], { type: "audio/wav" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "toniq_export.wav";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("WAVエクスポートエラー:", e);
    } finally {
      exportBtn.textContent = "WAV書き出し";
      exportBtn.removeAttribute("disabled");
    }
  });

  exportMidiBtn?.addEventListener("click", () => {
    const s = getState();
    exportMidi(s.chordPattern!, s.melodyNotes, s.key, s.bpm);
  });
});

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