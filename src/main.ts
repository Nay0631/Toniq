import { initChordSynth }                           from "./engine/ChordPlayer";
import { initBassSynth }                            from "./engine/BassPlayer";
import { initArpSynth }                             from "./engine/ArpPlayer";
import { initPadSynth }                             from "./engine/PadPlayer";
import { initMelodySynth }                          from "./engine/MelodyPlayer";
import { initFxSynth }                              from "./engine/FxPlayer";
import { generateMelody }                           from "./engine/MelodyGenerator";
import { getState, setState }                      from "./engine/AppState";
import { resolveSimpleMode, resolveTempoPreset } from "./engine/SimpleModeResolver";
import { initRouter } from "./ui/Router";
import { initSimpleScreen } from "./ui/SimpleScreen";
import { initCustomScreen } from "./ui/CustomScreen";
import "./ui/styles.css";


// シンプルモードで初期状態を解決
const initialResult = resolveSimpleMode("EDM", "明るい");
const initialBpm    = resolveTempoPreset("EDM", "普通");
setState({
  genre:        "EDM",
  mood:         "明るい",
  tempoPreset:  "普通",
  bpm:          initialBpm,
  chordPattern: initialResult.chordPattern,
  drumPattern:  initialResult.drumPattern,
});

window.addEventListener("load", () => {
  initChordSynth();
  initBassSynth();
  initArpSynth();
  initPadSynth();
  initMelodySynth();
  initFxSynth();

  // メロディ生成
  setState({ melodyNotes: generateMelody(getState().chordPattern!, getState().key, getState().genre) });

  initSimpleScreen();
  initCustomScreen();
  initRouter();
});
