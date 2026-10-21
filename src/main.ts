import * as Tone from "tone";
import { loadDrumPattern }                        from "./engine/DrumEngine";
import { initChordSynth, loadChordProgression }   from "./engine/ChordPlayer";
import { initBassSynth,  loadBassLine }           from "./engine/BassPlayer";
import { initArpSynth,   loadArpPattern }         from "./engine/ArpPlayer";
import { initPadSynth,   loadPadPattern }         from "./engine/PadPlayer";
import { initMelodySynth, loadMelody }            from "./engine/MelodyPlayer";
import { generateMelody }                         from "./engine/MelodyGenerator";
import drumDB  from "./data/drum_patterns.json";
import chordDB from "./data/chord_progressions.json";
import { DrumPattern, ChordProgression } from "./data/types";

const drumPattern  = (drumDB  as unknown as DrumPattern[])[0];
const chordPattern = (chordDB as unknown as ChordProgression[])[0];

window.addEventListener("load", () => {
  const playBtn   = document.getElementById("play");
  const stopBtn   = document.getElementById("stop");
  const regenBtn  = document.getElementById("regen");
  const exportBtn = document.getElementById("export-wav");

  initChordSynth();
  initBassSynth();
  initArpSynth();
  initPadSynth();
  initMelodySynth();

  let melodyNotes = generateMelody(chordPattern, "A", "lofi");

  const startAll = () => {
    loadDrumPattern(drumPattern);
    loadChordProgression(chordPattern, "A", 4);
    loadBassLine(chordPattern, "A", 2);
    loadArpPattern(chordPattern, "A", 5, "8n");
    loadPadPattern(chordPattern, "A", 4);
    loadMelody(melodyNotes, `${chordPattern.length_bars}m`);
    Tone.getTransport().bpm.value = 128;
  };

  playBtn?.addEventListener("click", async () => {
    await Tone.start();
    startAll();
    Tone.getTransport().start();
  });

  stopBtn?.addEventListener("click", () => {
    Tone.getTransport().stop();
  });

  regenBtn?.addEventListener("click", () => {
    melodyNotes = generateMelody(chordPattern, "A", "lofi");
    loadMelody(melodyNotes, `${chordPattern.length_bars}m`);
  });

    exportBtn?.addEventListener("click", async () => {
    exportBtn.textContent = "レンダリング中...";
    exportBtn.setAttribute("disabled", "true");

    try {
      const bpm         = 128;
      const bars        = chordPattern.length_bars;
      const durationSec = (bars * 4 * 60) / bpm + 2;

      const buffer = await Tone.Offline(async ({ transport }) => {
        transport.bpm.value = bpm;

        // ドラム
        const { loadDrumPattern: loadDrum } = await import("./engine/DrumEngine");
        loadDrum(drumPattern);

        // コード
        const { initChordSynth: initC, loadChordProgression: loadC } = await import("./engine/ChordPlayer");
        initC();
        loadC(chordPattern, "A", 4);

        // ベース
        const { initBassSynth: initB, loadBassLine: loadB } = await import("./engine/BassPlayer");
        initB();
        loadB(chordPattern, "A", 2);

        // アルペジオ
        const { initArpSynth: initAr, loadArpPattern: loadAr } = await import("./engine/ArpPlayer");
        initAr();
        loadAr(chordPattern, "A", 5, "8n");

        // パッド
        const { initPadSynth: initP, loadPadPattern: loadP } = await import("./engine/PadPlayer");
        initP();
        loadP(chordPattern, "A", 4);

        // メロディ
        const { initMelodySynth: initM, loadMelody: loadMel } = await import("./engine/MelodyPlayer");
        initM();
        loadMel(melodyNotes, `${bars}m`);

        transport.start();
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
      alert("エクスポートに失敗しました。コンソールを確認してください。");
    } finally {
      exportBtn.textContent = "WAV書き出し";
      exportBtn.removeAttribute("disabled");
    }
  });
});

// ===== AudioBuffer → WAVバイナリ =====
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
  view.setUint32(16, 16,     true);
  view.setUint16(20, 1,      true);
  view.setUint16(22, numCh,  true);
  view.setUint32(24, sr,     true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2,      true);
  view.setUint16(34, 16,             true);
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