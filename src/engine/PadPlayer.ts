import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { voiceProgression, VOICING_RANGES } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";

// ストラム：音を下から少しずつずらして鳴らす間隔（秒）。立ち上がりの遅いパッドなのでゆったりめ
const STRUM_SEC = 0.025;

let padPart:    Tone.Part | null = null;
let padSynth:   Tone.PolySynth | null = null;
let padVol:     Tone.Volume | null = null;
let padEffects: Tone.ToneAudioNode[] = [];

// 音の流れ：Synth → コーラス → Volume。リバーブはミキサーの送りでかける
export function initPadSynth() {
  disposeSynth();
  padVol = createVolumeNode("pad");  // 現在のオーディオコンテキスト用のノード
  const chorus = new Tone.Chorus(3, 2.5, 0.5).connect(padVol).start();
  padEffects = [chorus];
  padSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.4, decay: 0.8, sustain: 0.8, release: 2.0 },
    volume: -18,  // 自前のリバーブを外した分（ドライ音が大きくなる）下げる
  }).connect(chorus);
}

interface PadEvent {
  time:  string;
  notes: string[];
  dur:   string;
}

// コードとぶつからないよう開離配置にする（voiceProgression の spread）
export function loadPadPattern(progression: ChordProgression, key: string = "A") {
  if (padPart) { padPart.dispose(); padPart = null; }
  if (!padSynth) initPadSynth();

  const voiced = voiceProgression(progression, key, VOICING_RANGES.pad, { spread: true });
  const events: PadEvent[] = progression.progression.map((chord, i) => ({
    time:  `${chord.bar - 1}:0:0`,
    notes: voiced[i],
    dur:   `${chord.duration_bars}m`,
  }));

  const arranged = arrangementGate("pad");
  padPart = new Tone.Part((time, event: PadEvent) => {
    if (!arranged(time)) return;
    const velocity = 0.7 + (Math.random() - 0.5) * 0.1;
    event.notes.forEach((note, i) => {
      padSynth?.triggerAttackRelease(note, event.dur, time + i * STRUM_SEC, velocity);
    });
  }, events);

  padPart.loop    = true;
  padPart.loopEnd = `${progression.length_bars}m`;
  padPart.start(0);
}

function disposeSynth() {
  padSynth?.dispose();
  padEffects.forEach((n) => n.dispose());
  padSynth   = null;
  padEffects = [];
}

export function disposePad() {
  padPart?.dispose();
  padPart = null;
  disposeSynth();
}
