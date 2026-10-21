import * as Tone from "tone";
import { loadDrumPattern } from "./engine/DrumEngine";
import { initChordSynth, loadChordProgression } from "./engine/ChordPlayer";
import { initBassSynth, loadBassLine } from "./engine/BassPlayer";
import { initArpSynth, loadArpPattern } from "./engine/ArpPlayer";
import { initPadSynth, loadPadPattern } from "./engine/PadPlayer";
import drumDB  from "./data/drum_patterns.json";
import chordDB from "./data/chord_progressions.json";
import { DrumPattern, ChordProgression } from "./data/types";

const drumPattern  = (drumDB  as unknown as DrumPattern[])[0];
const chordPattern = (chordDB as unknown as ChordProgression[])[0];

window.addEventListener("load", () => {
  const playBtn = document.getElementById("play");
  const stopBtn = document.getElementById("stop");

  initChordSynth();
  initBassSynth();
  initArpSynth();
  initPadSynth();

  playBtn?.addEventListener("click", async () => {
    await Tone.start();
    loadDrumPattern(drumPattern);
    loadChordProgression(chordPattern, "A", 4);
    loadBassLine(chordPattern, "A", 2);
    loadArpPattern(chordPattern, "A", 5, "8n");
    loadPadPattern(chordPattern, "A", 4);
    Tone.getTransport().bpm.value = 128;
    Tone.getTransport().start();
  });

  stopBtn?.addEventListener("click", () => {
    Tone.getTransport().stop();
  });
});