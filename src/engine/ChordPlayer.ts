import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState, ChordRhythm, ChordInstrument } from "./AppState";

// リズムごとの刻みの長さ（16分音符の数）。whole はコードの長さいっぱいに伸ばす
const RHYTHM_STEPS: Record<ChordRhythm, number | null> = {
  whole:   null,
  half:    8,
  quarter: 4,
  eighth:  2,
};

// 音色ごとの PolySynth（音量は波形の聞こえ方の差をならす）
const INSTRUMENTS: Record<ChordInstrument, () => Tone.PolySynth<any>> = {
  // やわらかい三角波のパッド
  soft: () => new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope:   { attack: 0.15, decay: 0.5, sustain: 0.7, release: 1.5 },
    volume:     -10,
  }),
  // エレピ：FM で金属的な倍音を足し、鍵盤のように減衰させる
  epiano: () => new Tone.PolySynth(Tone.FMSynth, {
    harmonicity:        3,
    modulationIndex:    4,
    oscillator:         { type: "sine" },
    envelope:           { attack: 0.005, decay: 1.2, sustain: 0.3, release: 1.0 },
    modulation:         { type: "sine" },
    modulationEnvelope: { attack: 0.005, decay: 0.4, sustain: 0.1, release: 0.5 },
    volume:             -12,
  }),
  // ストリングス：ノコギリ波をローパスで丸め、ゆっくり立ち上げる
  strings: () => new Tone.PolySynth(Tone.MonoSynth, {
    oscillator:     { type: "sawtooth" },
    filter:         { type: "lowpass", Q: 0.5, rolloff: -24 },
    envelope:       { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.8 },
    filterEnvelope: { attack: 0.6, decay: 0.5, sustain: 0.6, release: 1.5, baseFrequency: 500, octaves: 2.5 },
    volume:         -16,
  }),
  // オルガン：整数倍音を重ね、押している間は減衰させない
  organ: () => new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "custom", partials: [1, 0.6, 0.4, 0.25, 0, 0.15] },
    envelope:   { attack: 0.01, decay: 0.1, sustain: 1, release: 0.15 },
    volume:     -15,
  }),
  // 8bit：短めに切れる矩形波
  square: () => new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "square" },
    envelope:   { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.1 },
    volume:     -20,
  }),
};

let chordPart: Tone.Part | null = null;
let padSynth:  Tone.PolySynth<any> | null = null;
let chordVol:  Tone.Volume | null = null;

// 音色は AppState.chordInstrument から決める。変更は次に Synth を作り直したとき（再生開始時）に反映される
export function initChordSynth() {
  chordVol = createVolumeNode("chord");  // 現在のオーディオコンテキスト用のノード
  const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 }).connect(chordVol);
  const create = INSTRUMENTS[getState().chordInstrument] ?? INSTRUMENTS.soft;
  padSynth = create().connect(reverb);
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

  const arranged = arrangementGate("chord");
  chordPart = new Tone.Part((time, event: any) => {
    if (!arranged(time)) return;
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