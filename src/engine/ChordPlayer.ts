import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";

let chordPart: Tone.Part | null = null;
let padSynth: Tone.PolySynth | null = null;

export function initChordSynth() {
  const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 }).toDestination();
  padSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.15, decay: 0.5, sustain: 0.7, release: 1.5 },
    volume: -10,
  }).connect(reverb);
}

export function loadChordProgression(
  progression: ChordProgression,
  key: string = "A",
  octave: number = 4
) {
  if (chordPart) { chordPart.dispose(); chordPart = null; }
  if (!padSynth) initChordSynth();

  const barsPerBeat = Tone.getTransport().bpm.value / 60;
  const events: { time: string; notes: string[]; dur: string }[] = [];

  progression.progression.forEach((chord) => {
    const resolved = resolveChord(
      chord.degree,
      chord.type,
      chord.inversion,
      key,
      progression.base_scale,
      octave
    );
    const timeInBars = chord.bar - 1;
    const durationBars = chord.duration_bars;
    events.push({
      time: `${timeInBars}:0:0`,
      notes: resolved.notes,
      dur: `${durationBars}m`,
    });
  });

  chordPart = new Tone.Part((time, event: any) => {
    padSynth?.triggerAttackRelease(event.notes, event.dur, time);
  }, events);

  chordPart.loop = true;
  chordPart.loopEnd = `${progression.length_bars}m`;
  chordPart.start(0);
}

export function disposeChord() {
  chordPart?.dispose();
  padSynth?.dispose();
  chordPart = null;
  padSynth = null;
}