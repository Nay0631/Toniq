import * as Tone from "tone";

export function createKick() {
  const env = new Tone.AmplitudeEnvelope({
    attack: 0.001, decay: 0.3, sustain: 0, release: 0.1,
  });
  const osc = new Tone.Oscillator({ type: "sine", frequency: 60 }).connect(env);
  const freq = new Tone.FrequencyEnvelope({
    attack: 0.001, decay: 0.12, baseFrequency: 150, octaves: -1.5,
  });
  freq.connect(osc.frequency);
  osc.start();
  return { env, freq };
}

export function createSnare() {
  return new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
  });
}

export function createHihat() {
  return new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    volume: -10,
  });
}

export function createClap() {
  return new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 },
    volume: -8,
  });
}