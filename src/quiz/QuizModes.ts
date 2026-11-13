import { doremiCde, keyPosition, higherLower, earInterval, degreeSemitone, intervalNote, noteInterval } from "./modes/PitchModes";
import { majorMinorEar, chordNotesMode, chordEar, chordFormula, chordProgEar, scaleNotes, scaleFormula, relativeKey } from "./modes/ChordScaleModes";
import { meterEar, eqEar } from "./modes/RhythmSoundModes";
import { toniqTerms, synthParamQuiz } from "./modes/TermModes";
import type { QuizCategory, QuizMode } from "./QuizCore";

// 音楽クイズの出題モード（初心者向け）。各モードは出題設定（モード内に保持）と問題の作り方を持つ。
// 型・共通データ・ヘルパーは QuizCore.ts、各カテゴリのモードは modes/ にある。モードを足すときは modes/ に作り、ここの QUIZ_CATEGORIES に加える

// 画面（QuizScreen.ts）が使う型・音名
export { NOTES, displayNote } from "./QuizCore";
export type { QuizMode, QuizSetting, Question, QuizAnswer, QuizCategory } from "./QuizCore";

// ===== カテゴリ（各カテゴリの中はやさしい順） =====

export const QUIZ_CATEGORIES: QuizCategory[] = [
  { key: "pitch", label: "音の高さ",
    modes: [doremiCde, keyPosition, higherLower, earInterval, degreeSemitone, intervalNote, noteInterval] },
  { key: "chord_scale", label: "コード・スケール",
    modes: [majorMinorEar, chordNotesMode, chordEar, chordFormula, chordProgEar, scaleNotes, scaleFormula, relativeKey] },
  { key: "rhythm_sound", label: "リズム・音響", modes: [meterEar, eqEar] },
  { key: "terms",        label: "用語",         modes: [toniqTerms, synthParamQuiz] },
];

export const QUIZ_MODES: QuizMode[] = QUIZ_CATEGORIES.flatMap(c => c.modes);
