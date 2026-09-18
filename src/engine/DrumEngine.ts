import * as Tone from "tone";
import { DrumPattern } from "../data/types";
import { createKick, createSnare, createHihat, createClap } from "./SynthFactory";

const SYNTH_MAP: Record<string, () => any> = {
  kick:         createKick,
  snare:        createSnare,
  hihat_closed: createHihat,
  hihat_open:   createHihat,
  clap:         createClap,
  rim:          createClap,
};

let currentSeq: Tone.Sequence | null = null;
let synths: any[] = [];

export function loadDrumPattern(pattern: DrumPattern) {
  if (currentSeq) { currentSeq.dispose(); currentSeq = null; }
  synths.forEach(s => s?.dispose?.());
  synths = [];

  const parts = Object.entries(pattern.tracks).map(([name, track]) => {
    const factory = SYNTH_MAP[name] ?? createClap;
    const synth = factory();
    synths.push(synth);
    return { name, track, synth };
  });

  currentSeq = new Tone.Sequence(
    (time, step) => {
      parts.forEach(({ track, synth }) => {
        if (!track.pattern[step]) return;
        const vel = track.velocity[step];
        if (synth.env && synth.freq) {
          synth.freq.triggerAttack(time);
          synth.env.triggerAttackRelease("16n", time);
        } else {
          synth.triggerAttackRelease("16n", time, vel);
        }
      });
    },
    [...Array(16).keys()],
    pattern.step_unit as Tone.Unit.Time
  );

  currentSeq.start(0);
}

export function disposeDrum() {
  currentSeq?.dispose();
  synths.forEach(s => s?.dispose?.());
}