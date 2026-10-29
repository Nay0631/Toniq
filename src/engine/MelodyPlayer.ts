import * as Tone from "tone";
import { MelodyNote } from "./MelodyGenerator";
import { createVolumeNode } from "./VolumeManager";


let melodyPart:  Tone.Part | null = null;
let melodySynth: Tone.Synth | null = null;
let melodyVol: Tone.Volume | null = null;


export function initMelodySynth() {
  if (!melodyVol) melodyVol = createVolumeNode("melody");
  const reverb = new Tone.Reverb({ decay: 1.0, wet: 0.15 }).connect(melodyVol);
  melodySynth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope:   { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.5 },
    volume: -8,
  }).connect(reverb);
}

export function loadMelody(notes: MelodyNote[], loopEnd: string) {
  if (melodyPart) { melodyPart.dispose(); melodyPart = null; }
  if (!melodySynth) initMelodySynth();

  const events = notes
    .filter(n => n.note !== null)
    .map(n => ({ time: n.time, note: n.note!, dur: n.duration }));

  melodyPart = new Tone.Part((time, event: any) => {
    melodySynth?.triggerAttackRelease(event.note, event.dur, time);
  }, events);

  melodyPart.loop    = true;
  melodyPart.loopEnd = loopEnd;
  melodyPart.start(0);
}

export function disposeMelody() {
  melodyPart?.dispose();
  melodySynth?.dispose();
  melodyPart  = null;
  melodySynth = null;
}