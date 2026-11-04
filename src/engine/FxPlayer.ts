import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { createVolumeNode } from "./VolumeManager";

let fxPart:   Tone.Part       | null = null;
let fxNoise:  Tone.NoiseSynth | null = null;
let fxFilter: Tone.Filter     | null = null;
let fxVol:    Tone.Volume     | null = null;

export function initFxSynth() {
  fxVol = createVolumeNode("fx");  // 現在のオーディオコンテキスト用のノード
  fxFilter = new Tone.Filter({ type: "highpass", frequency: 200, Q: 4 }).connect(fxVol);
  fxNoise = new Tone.NoiseSynth({
    noise:    { type: "white" },
    envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.05 },
    volume:   -14,
  }).connect(fxFilter);
}

// ライザーSE：ループ最後の1小節でノイズのフィルターを上げていく
export function loadFx(progression: ChordProgression) {
  if (fxPart) { fxPart.dispose(); fxPart = null; }
  if (!fxNoise) initFxSynth();

  const lastBar = progression.length_bars - 1;

  fxPart = new Tone.Part((time) => {
    if (!fxNoise || !fxFilter) return;
    const dur = Tone.Time("1m").toSeconds();
    fxFilter.frequency.setValueAtTime(200, time);
    fxFilter.frequency.exponentialRampToValueAtTime(8000, time + dur);
    // 終盤に向けて音量も上げる
    fxNoise.volume.setValueAtTime(-30, time);
    fxNoise.volume.linearRampToValueAtTime(-14, time + dur);
    fxNoise.triggerAttackRelease(dur, time);
  }, [{ time: `${lastBar}:0:0` }]);

  fxPart.loop    = true;
  fxPart.loopEnd = `${progression.length_bars}m`;
  fxPart.start(0);
}

export function disposeFx() {
  fxPart?.dispose();
  fxNoise?.dispose();
  fxFilter?.dispose();
  fxPart   = null;
  fxNoise  = null;
  fxFilter = null;
}
