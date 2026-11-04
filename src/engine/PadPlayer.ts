import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";

let padPart: Tone.Part | null = null;
let padSynth: Tone.PolySynth | null = null;
let padVol: Tone.Volume | null = null;

export function initPadSynth() {
  padVol = createVolumeNode("pad");  // 現在のオーディオコンテキスト用のノード
  const reverb = new Tone.Reverb({ decay: 4.0, wet: 0.5 }).connect(padVol);
  const chorus = new Tone.Chorus(3, 2.5, 0.5).connect(reverb).start();
  padSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.4, decay: 0.8, sustain: 0.8, release: 2.0 },
    volume: -16,
  }).connect(chorus);
}

export function loadPadPattern(
  progression: ChordProgression,
  key: string = "A",
  octave: number = 4
) {
  if (padPart) { padPart.dispose(); padPart = null; }
  if (!padSynth) initPadSynth();

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
    events.push({
      time: `${chord.bar - 1}:0:0`,
      notes: resolved.notes,
      dur: `${chord.duration_bars}m`,
    });
  });

  const arranged = arrangementGate("pad");
  padPart = new Tone.Part((time, event: any) => {
    if (!arranged(time)) return;
    padSynth?.triggerAttackRelease(event.notes, event.dur, time);
  }, events);

  padPart.loop    = true;
  padPart.loopEnd = `${progression.length_bars}m`;
  padPart.start(0);
}

export function disposePad() {
  padPart?.dispose();
  padSynth?.dispose();
  padPart  = null;
  padSynth = null;
}