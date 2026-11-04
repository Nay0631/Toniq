import * as Tone from "tone";
import { DrumPattern } from "../data/types";
import { createKick, createSnare, createHihat, createClap } from "./SynthFactory";
import { createVolumeNode } from "./VolumeManager";

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
let drumVol: Tone.Volume | null = null;

export function loadDrumPattern(pattern: DrumPattern) {
  if (currentSeq) { currentSeq.dispose(); currentSeq = null; }
  synths.forEach(s => s?.env?.disconnect?.() ?? s?.disconnect?.());
  synths = [];

  drumVol = createVolumeNode("drum");  // 現在のオーディオコンテキスト用のノード

  const parts = Object.entries(pattern.tracks).map(([name, track]) => {
    const factory = SYNTH_MAP[name] ?? createClap;
    const synth   = factory();
    synths.push(synth);

    // Volumeノード経由で出力
    if (synth.env) {
      synth.env.connect(drumVol!);
    } else {
      synth.connect(drumVol!);
    }
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
  currentSeq = null;
  synths     = [];
}