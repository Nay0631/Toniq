import { setState }                                 from "./engine/AppState";
import { resolveSimpleMode, resolveTempoPreset, pickChorus } from "./engine/SimpleModeResolver";
import { onPlaybackError }                          from "./engine/Playback";
import { markSongClean }                            from "./engine/SongLibrary";
import { initRouter, render as renderAll } from "./ui/Router";
import { initSimpleScreen } from "./ui/SimpleScreen";
import { initCustomScreen } from "./ui/CustomScreen";
import { initPianoRoll } from "./ui/PianoRollTab";
import { initMusicListScreen } from "./ui/MusicListScreen";
import { initQuizScreen } from "./ui/QuizScreen";
import { initTheme } from "./ui/Theme";
import { initHistoryControls } from "./ui/HistoryControls";
import { initGlossary } from "./ui/Glossary";
import { initSettingsScreen } from "./ui/SettingsScreen";
import { initPreferences } from "./ui/Preferences";
import { initRatingScreen } from "./ui/RatingScreen";
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
  chorusPattern: pickChorus(initialResult.chordPattern, "EDM", "明るい"),
  drumPattern:  initialResult.drumPattern,
});
markSongClean();  // 起動したままの曲は、閉じても失うものがない

window.addEventListener("load", () => {
  // 各パートの音色は起動時には作らない（再生・試聴を始めるとき、grow の準備ができてから作る）。
  // メロディも起動時には作らない（自動生成ボタンを押したときに初めて作る）

  initTheme();
  initPreferences();  // 音名の表記・ループ再生・ドラムの音源（各画面の初期化より先に読む）
  initSimpleScreen();
  initCustomScreen();
  initPianoRoll();
  initMusicListScreen();
  initQuizScreen();
  initHistoryControls();
  initGlossary();
  initSettingsScreen();
  initRatingScreen();
  initRouter();

  // 再生を始められなかったとき（読み込んだ曲ファイルの内容が壊れているなど）は、無反応にせず知らせて画面を戻す
  onPlaybackError(error => {
    renderAll();
    alert("この曲を再生できませんでした。曲の内容（コード進行・キーなど）が正しくない可能性があります。\n"
        + `（${error instanceof Error ? error.message : String(error)}）`);
  });
});
