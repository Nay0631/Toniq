import * as Tone from "tone";

export function initTransport(bpm: number = 128) {
  Tone.getTransport().bpm.value = bpm;
}

export function setBpm(bpm: number) {
  Tone.getTransport().bpm.value = bpm;
}

export async function startTransport() {
  await Tone.start();
  console.log("AudioContext state:", Tone.getContext().state);
  Tone.getTransport().start();
  console.log("Transport state:", Tone.getTransport().state);
}

export function stopTransport() {
  Tone.getTransport().stop();
}