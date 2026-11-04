import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";

let arpPart: Tone.Part | null = null;
let arpSynth: Tone.Synth | null = null;
let arpVol: Tone.Volume | null = null;

export function initArpSynth() {
  arpVol = createVolumeNode("arp");  // 現在のオーディオコンテキスト用のノード
  const reverb = new Tone.Reverb({ decay: 1.0, wet: 0.2 }).connect(arpVol);
  const delay  = new Tone.FeedbackDelay("8n", 0.2).connect(reverb);
  arpSynth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.3 },
    volume: -14,
  }).connect(delay);
}

export function loadArpPattern(
  progression: ChordProgression,
  key: string = "A",
  octave: number = 4,
  stepUnit: Tone.Unit.Time = "8n"
) {
  if (arpPart) { arpPart.dispose(); arpPart = null; }
  if (!arpSynth) initArpSynth();

  const events: { time: string; note: string }[] = [];

  progression.progression.forEach((chord) => {
    const resolved = resolveChord(
      chord.degree,
      chord.type,
      chord.inversion,
      key,
      progression.base_scale,
      octave
    );

    const notes = resolved.notes;
    const barStart = chord.bar - 1;
    const stepsPerBar = stepUnit === "8n" ? 8 : 4;
    const totalSteps  = chord.duration_bars * stepsPerBar;

    for (let i = 0; i < totalSteps; i++) {
      const noteIndex = i % notes.length;
      events.push({
        time: `${barStart}:${Math.floor(i / (stepsPerBar / 4))}:${(i % (stepsPerBar / 4)) * (stepsPerBar / 4)}`,
        note: notes[noteIndex],
      });
    }
  });

  arpPart = new Tone.Part((time, event: any) => {
    arpSynth?.triggerAttackRelease(event.note, stepUnit, time);
  }, events);

  arpPart.loop    = true;
  arpPart.loopEnd = `${progression.length_bars}m`;
  arpPart.start(0);
}

export function disposeArp() {
  arpPart?.dispose();
  arpSynth?.dispose();
  arpPart  = null;
  arpSynth = null;
}