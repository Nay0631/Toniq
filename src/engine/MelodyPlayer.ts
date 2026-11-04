import * as Tone from "tone";
import { MelodyNote } from "./MelodyGenerator";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState, MelodyInstrument } from "./AppState";


let melodyPart:  Tone.Part | null = null;
let melodySynth: Tone.Synth | null = null;
let melodyVol: Tone.Volume | null = null;

// 音色ごとの Synth 設定（音量は波形の聞こえ方の差をならす）
const INSTRUMENTS: Record<MelodyInstrument, {
  type:     "sine" | "sawtooth" | "square" | "triangle";
  envelope: { attack: number; decay: number; sustain: number; release: number };
  volume:   number;
}> = {
  soft:   { type: "sine",     envelope: { attack: 0.02,  decay: 0.1,  sustain: 0.6, release: 0.5 }, volume: -8  },
  lead:   { type: "sawtooth", envelope: { attack: 0.01,  decay: 0.15, sustain: 0.5, release: 0.3 }, volume: -16 },
  square: { type: "square",   envelope: { attack: 0.005, decay: 0.1,  sustain: 0.4, release: 0.1 }, volume: -17 },
  pluck:  { type: "triangle", envelope: { attack: 0.005, decay: 0.3,  sustain: 0,   release: 0.3 }, volume: -6  },
};

// 音色は AppState.melodyInstrument から決める。変更は次に Synth を作り直したとき（再生開始時）に反映される
export function initMelodySynth() {
  melodyVol = createVolumeNode("melody");  // 現在のオーディオコンテキスト用のノード
  const reverb = new Tone.Reverb({ decay: 1.0, wet: 0.15 }).connect(melodyVol);
  const inst = INSTRUMENTS[getState().melodyInstrument] ?? INSTRUMENTS.soft;
  melodySynth = new Tone.Synth({
    oscillator: { type: inst.type },
    envelope:   inst.envelope,
    volume:     inst.volume,
  }).connect(reverb);
}

export function loadMelody(notes: MelodyNote[], loopEnd: string) {
  if (melodyPart) { melodyPart.dispose(); melodyPart = null; }
  if (!melodySynth) initMelodySynth();

  const events = notes
    .filter(n => n.note !== null)
    .map(n => ({ time: n.time, note: n.note!, dur: n.duration }));

  const arranged = arrangementGate("melody");
  melodyPart = new Tone.Part((time, event: any) => {
    if (!arranged(time)) return;
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