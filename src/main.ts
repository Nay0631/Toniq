import * as Tone from "tone";
import { loadDrumPattern } from "./engine/DrumEngine";
import drumDB from "./data/drum_patterns.json";
import { DrumPattern } from "./data/types";

const pattern = (drumDB as unknown as DrumPattern[])[0];

window.addEventListener("load", () => {
  const playBtn = document.getElementById("play");
  const stopBtn = document.getElementById("stop");

  playBtn?.addEventListener("click", async () => {
    await Tone.start();
    loadDrumPattern(pattern);
    Tone.getTransport().bpm.value = 128;
    Tone.getTransport().start();
  });

  stopBtn?.addEventListener("click", () => {
    Tone.getTransport().stop();
  });
});