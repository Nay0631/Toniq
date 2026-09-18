import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";

let bassPart: Tone.Part | null = null;
let bassSynth: Tone.Synth | null = null;

export function initBassSynth() {
  const filter = new Tone.Filter(300, "lowpass").toDestination();
  bassSynth = new Tone.Synth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
    volume: -6,
  }).connect(filter);
}

export function loadBassLine(
  progression: ChordProgression,
  key: string = "A",
  octave: number = 2
) {
  if (bassPart) { bassPart.dispose(); bassPart = null; }
  if (!bassSynth) initBassSynth();

  const events: { time: string; note: string; dur: string }[] = [];

  progression.progression.forEach((chord) => {
    const resolved = resolveChord(
      chord.degree,
      chord.type,
      0,
      key,
      progression.base_scale,
      octave
    );
    const timeInBars = chord.bar - 1;
    events.push({
      time: `${timeInBars}:0:0`,
      note: resolved.bass_note,
      dur: `${chord.duration_bars}m`,
    });
  });

  bassPart = new Tone.Part((time, event: any) => {
    bassSynth?.triggerAttackRelease(event.note, event.dur, time);
  }, events);

  bassPart.loop = true;
  bassPart.loopEnd = `${progression.length_bars}m`;
  bassPart.start(0);
}

export function disposeBass() {
  bassPart?.dispose();
  bassSynth?.dispose();
  bassPart = null;
  bassSynth = null;
}