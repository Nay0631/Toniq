import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { voiceProgression, VOICING_RANGES } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { GrowInstrument, growValues, isGrowReady } from "./Grow";

// ストラム：音を下から少しずつずらして鳴らす間隔（秒）。立ち上がりの遅いパッドなのでゆったりめ
const STRUM_SEC = 0.025;

let padPart:    Tone.Part | null = null;
let padSynth:   Tone.PolySynth | GrowInstrument | null = null;
let padVol:     Tone.Volume | null = null;
let padEffects: Tone.ToneAudioNode[] = [];

// grow（AppState.growSounds.pad。標準はソフトパッド）で鳴らす。grow は自前のエフェクトを持つのでそのまま Volume へ。
// grow の準備ができていない（wasm がない）ときは Tone.js の Synth → コーラス → Volume。リバーブはミキサーの送りでかける
export function initPadSynth() {
  disposeSynth();
  padVol = createVolumeNode("pad");  // 現在のオーディオコンテキスト用のノード
  if (isGrowReady()) {
    padSynth = new GrowInstrument(growValues("pad")).connect(padVol);
    return;
  }
  const chorus = new Tone.Chorus(3, 2.5, 0.5).connect(padVol).start();
  padEffects = [chorus];
  padSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.4, decay: 0.8, sustain: 0.8, release: 2.0 },
    volume: -18,  // 自前のリバーブを外した分（ドライ音が大きくなる）下げる
  }).connect(chorus);
}

// パッドの1回の発音（位置と長さは16分音符の数。コードごとに開離配置の和音を伸ばす。MIDI書き出しも同じものを使う）
export interface PadHit {
  sixteenth: number;
  length:    number;
  notes:     string[];
}

export function padEvents(progression: ChordProgression, key: string): PadHit[] {
  const voiced = voiceProgression(progression, key, VOICING_RANGES.pad, { spread: true });
  return progression.progression.map((chord, i) => ({
    sixteenth: (chord.bar - 1) * 16,
    length:    chord.duration_bars * 16,
    notes:     voiced[i],
  }));
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

  const events: PadEvent[] = padEvents(progression, key).map(h => ({
    time:  `0:0:${h.sixteenth}`,
    notes: h.notes,
    dur:   `${h.length / 16}m`,
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
