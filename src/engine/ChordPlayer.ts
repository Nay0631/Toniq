import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { getState, ChordRhythm } from "./AppState";

// リズムごとの刻みの長さ（16分音符の数）。whole はコードの長さいっぱいに伸ばす
const RHYTHM_STEPS: Record<ChordRhythm, number | null> = {
  whole:   null,
  half:    8,
  quarter: 4,
  eighth:  2,
};

let chordPart: Tone.Part | null = null;
let padSynth:  Tone.PolySynth | null = null;
let chordVol:  Tone.Volume | null = null;

export function initChordSynth() {
  chordVol = createVolumeNode("chord");  // 現在のオーディオコンテキスト用のノード
  const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 }).connect(chordVol);
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

  const events: { time: string; notes: string[]; dur: string }[] = [];
  const step = RHYTHM_STEPS[getState().chordRhythm];

  progression.progression.forEach((chord) => {
    const resolved = resolveChord(
      chord.degree, chord.type, chord.inversion,
      key, progression.base_scale, octave
    );
    if (step === null) {
      events.push({
        time:  `${chord.bar - 1}:0:0`,
        notes: resolved.notes,
        dur:   `${chord.duration_bars}m`,
      });
      return;
    }
    // コードの長さの中で一定の間隔で刻む
    const start = (chord.bar - 1) * 16;
    for (let six = 0; six < chord.duration_bars * 16; six += step) {
      events.push({
        time:  `0:0:${start + six}`,
        notes: resolved.notes,
        dur:   `${16 / step}n`,
      });
    }
  });

  chordPart = new Tone.Part((time, event: any) => {
    padSynth?.triggerAttackRelease(event.notes, event.dur, time);
  }, events);

  chordPart.loop    = true;
  chordPart.loopEnd = `${progression.length_bars}m`;
  chordPart.start(0);
}

export function disposeChord() {
  chordPart?.dispose();
  padSynth?.dispose();
  chordPart = null;
  padSynth  = null;
}