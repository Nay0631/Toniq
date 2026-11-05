import { initChordSynth }                           from "./engine/ChordPlayer";
import { initBassSynth }                            from "./engine/BassPlayer";
import { initArpSynth }                             from "./engine/ArpPlayer";
import { initPadSynth }                             from "./engine/PadPlayer";
import { initSignatureSynth }                       from "./engine/SignaturePlayer";
import { initMelodySynth }                          from "./engine/MelodyPlayer";
import { initFxSynth }                              from "./engine/FxPlayer";
import { setState }                                 from "./engine/AppState";
import { resolveSimpleMode, resolveTempoPreset } from "./engine/SimpleModeResolver";
import { initRouter } from "./ui/Router";
import { initSimpleScreen } from "./ui/SimpleScreen";
import { initCustomScreen } from "./ui/CustomScreen";
import { initPianoRoll } from "./ui/PianoRollTab";
import { initMusicListScreen } from "./ui/MusicListScreen";
import { initQuizScreen } from "./ui/QuizScreen";
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
  initSignatureSynth();
  initMelodySynth();
  initFxSynth();

  // メロディは起動時には作らない（自動生成ボタンを押したときに初めて作る）

  initSimpleScreen();
  initCustomScreen();
  initPianoRoll();
  initMusicListScreen();
  initQuizScreen();
  initRouter();
});
