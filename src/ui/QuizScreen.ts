import * as Playback from "../engine/Playback";
import { onRender, render as renderAll } from "./Router";
import { getState, setState, NoteNames } from "../engine/AppState";
import { setNoteNames } from "./Preferences";
import {
  QUIZ_CATEGORIES, QUIZ_MODES, NOTES, displayNote, QuizMode, QuizSetting, Question, QuizAnswer,
} from "../quiz/QuizModes";
import { stopQuizSound } from "../quiz/QuizAudio";

const $ = (id: string) => document.getElementById(id)!;

// 鍵盤の並び（C からの半音数）と大きさ
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_SEMIS = [1, 3, 6, 8, 10];
const WHITE_W = 44;
const BLACK_W = 28;

const SPEAKER_ICON =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>`;

// 表示上の一時的な状態（出題中の問題・回答済みか・モードごとの成績・カテゴリごとに最後に開いたモード）
let question: Question | null = null;
let questionModeId = "";
let answered = false;
let settingsModeId = "";
let onScreen = false;
const scores = new Map<string, { score: number; streak: number }>();
const lastModeOfCategory = new Map<string, string>();

function currentMode(): QuizMode {
  return QUIZ_MODES.find(m => m.id === getState().quizMode) ?? QUIZ_MODES[0];
}

function scoreOf(modeId: string): { score: number; streak: number } {
  let s = scores.get(modeId);
  if (!s) {
    s = { score: 0, streak: 0 };
    scores.set(modeId, s);
  }
  return s;
}

function selectMode(id: string): void {
  setState({ quizMode: id });
  renderAll();
}

// ===== 出題・採点 =====

function nextQuestion(): void {
  stopQuizSound();
  const mode = currentMode();
  question = mode.question();
  questionModeId = mode.id;
  answered = false;
  renderQuestion();
}

function finish(correct: boolean, correctText: string): void {
  answered = true;
  const s = scoreOf(questionModeId);
  if (correct) {
    s.score++;
    s.streak++;
  } else {
    s.streak = 0;
  }
  const feedback = $("quiz-feedback");
  feedback.textContent = correct ? "正解！" : `不正解。正解は ${correctText}`;
  feedback.className = "quiz-feedback " + (correct ? "is-good" : "is-bad");
  $("quiz-explain").textContent = question?.explain ?? "";
  $("quiz-next").classList.add("is-shown");
  renderStats();
  renderSounds();
}

// ===== 鍵盤 =====

// octaves オクターブ分の鍵盤を作る。onPress を渡すと押せる鍵盤になる
function buildKeyboard(octaves: number, onPress?: (note: string, key: HTMLElement) => void): HTMLElement {
  const piano = document.createElement("div");
  piano.className = "quiz-piano" + (onPress ? " is-input" : "");
  piano.style.width = `${octaves * 7 * WHITE_W}px`;

  const addKey = (semi: number, octave: number, left: number, color: "white" | "black") => {
    const key = document.createElement("div");
    const note = NOTES[semi];
    key.className = `quiz-key is-${color}`;
    key.style.left = `${left}px`;
    key.dataset.note = note;
    key.dataset.abs = String(octave * 12 + semi);
    key.textContent = displayNote(note);
    if (onPress) key.addEventListener("click", () => onPress(note, key));
    piano.appendChild(key);
  };

  for (let o = 0; o < octaves; o++) {
    const offset = o * 7 * WHITE_W;
    WHITE_SEMIS.forEach((semi, i) => addKey(semi, o, offset + i * WHITE_W, "white"));
    BLACK_SEMIS.forEach(semi => {
      const whitesBefore = WHITE_SEMIS.filter(w => w < semi).length;
      addKey(semi, o, offset + whitesBefore * WHITE_W - BLACK_W / 2, "black");
    });
  }
  return piano;
}

function keysOf(piano: HTMLElement, note: string): NodeListOf<HTMLElement> {
  return piano.querySelectorAll<HTMLElement>(`[data-note="${note}"]`);
}

// 鍵盤で複数の音を選んで「決定」する
function buildNotesAnswer(area: HTMLElement, correct: string[], octaves: number): void {
  const selected = new Set<string>();
  const decide = document.createElement("button");
  decide.className = "btn quiz-decide";
  decide.textContent = "決定";
  decide.disabled = true;

  const piano = buildKeyboard(octaves, note => {
    if (answered) return;
    if (selected.has(note)) selected.delete(note);
    else selected.add(note);
    // 同じ音名の鍵盤（2オクターブ表示のとき）をそろえて表示する
    keysOf(piano, note).forEach(k => k.classList.toggle("is-selected", selected.has(note)));
    decide.disabled = selected.size === 0;
  });

  decide.addEventListener("click", () => {
    if (answered) return;
    const ok = selected.size === correct.length && correct.every(n => selected.has(n));
    piano.querySelectorAll<HTMLElement>(".quiz-key").forEach(k => {
      const note = k.dataset.note!;
      const isRight = correct.includes(note);
      k.classList.remove("is-selected");
      if (isRight && selected.has(note)) k.classList.add("is-correct");
      else if (isRight) k.classList.add("is-missed");
      else if (selected.has(note)) k.classList.add("is-wrong");
    });
    piano.classList.add("is-done");
    decide.disabled = true;
    finish(ok, correct.map(displayNote).join(", "));
  });

  area.append(piano, decide);
}

// 鍵盤を1つ押して答える（hideLabels のときは回答するまで音名を隠す）
function buildKeyAnswer(area: HTMLElement, answer: Extract<QuizAnswer, { kind: "key" }>): void {
  const piano = buildKeyboard(1, (note, key) => {
    if (answered) return;
    const ok = note === answer.correct;
    key.classList.add(ok ? "is-correct" : "is-wrong");
    if (!ok) keysOf(piano, answer.correct).forEach(k => k.classList.add("is-correct"));
    piano.classList.add("is-done");
    piano.classList.remove("is-unlabeled");
    finish(ok, displayNote(answer.correct));
  });
  if (answer.hideLabels) piano.classList.add("is-unlabeled");
  if (answer.root) keysOf(piano, answer.root).forEach(k => k.classList.add("is-root"));
  area.appendChild(piano);
}

// 選択肢から選ぶ
function buildChoiceAnswer(area: HTMLElement, answer: Extract<QuizAnswer, { kind: "choice" }>): void {
  const grid = document.createElement("div");
  // 二択と長い選択肢は2列にする
  const wide = answer.choices.length <= 2 || answer.choices.some(c => c.length > 4);
  grid.className = "quiz-choices" + (wide ? " is-wide" : "");
  answer.choices.forEach(value => {
    const btn = document.createElement("button");
    btn.className = "quiz-choice";
    btn.textContent = value;
    btn.addEventListener("click", () => {
      if (answered) return;
      const ok = value === answer.correct;
      grid.querySelectorAll<HTMLButtonElement>(".quiz-choice").forEach(b => {
        b.disabled = true;
        if (b.textContent === answer.correct) b.classList.add("is-correct");
      });
      if (!ok) btn.classList.add("is-wrong");
      finish(ok, answer.correct);
    });
    grid.appendChild(btn);
  });
  area.appendChild(grid);
}

// ===== 表示 =====

function renderQuestion(): void {
  const q = question;
  if (!q) return;

  $("quiz-label").textContent = q.label;
  const prompt = $("quiz-prompt");
  prompt.className = "quiz-prompt" + (q.size ? ` is-${q.size}` : "");
  prompt.innerHTML = q.prompt;
  $("quiz-sub").textContent = q.sub ?? "";

  const feedback = $("quiz-feedback");
  feedback.textContent = "";
  feedback.className = "quiz-feedback";
  $("quiz-explain").textContent = "";
  $("quiz-next").classList.remove("is-shown");

  // 参照用の鍵盤（押せない）
  const ref = $("quiz-ref");
  ref.innerHTML = "";
  if (q.ref) {
    const piano = buildKeyboard(q.ref.octaves);
    piano.querySelector(`[data-abs="${q.ref.root}"]`)?.classList.add("is-root");
    piano.querySelector(`[data-abs="${q.ref.target}"]`)?.classList.add("is-target");
    ref.appendChild(piano);
  }

  const area = $("quiz-answer");
  area.innerHTML = "";
  const a = q.answer;
  if (a.kind === "notes") buildNotesAnswer(area, a.correct, a.octaves);
  else if (a.kind === "key") buildKeyAnswer(area, a);
  else buildChoiceAnswer(area, a);

  renderSounds();
}

function renderSounds(): void {
  const box = $("quiz-sounds");
  box.innerHTML = "";
  question?.sounds
    ?.filter(s => !s.afterAnswer || answered)
    .forEach(s => {
      const btn = document.createElement("button");
      btn.className = "quiz-sound";
      btn.innerHTML = SPEAKER_ICON;
      btn.append(s.label);
      btn.addEventListener("click", s.play);
      box.appendChild(btn);
    });
}

function renderStats(): void {
  const s = scoreOf(currentMode().id);
  $("quiz-score").textContent = String(s.score);
  $("quiz-streak").textContent = String(s.streak);
}

function renderSettings(mode: QuizMode): void {
  const box = $("quiz-settings");
  box.innerHTML = "";
  if (mode.hint) {
    const hint = document.createElement("p");
    hint.className = "quiz-settings-hint";
    hint.textContent = mode.hint;
    box.appendChild(hint);
  }
  if (mode.settings.length === 0) {
    const p = document.createElement("p");
    p.className = "quiz-settings-empty";
    p.textContent = "このモードに設定項目はありません";
    box.appendChild(p);
    return;
  }

  // ON/OFF の設定は「表示・回答方法」にまとめる
  const toggles = mode.settings.filter(s => s.kind === "toggle");
  if (toggles.length > 0) box.appendChild(settingRow("表示・回答方法", toggles));
  mode.settings.forEach(s => {
    if (s.kind === "group") box.appendChild(settingRow(s.label, [s]));
  });
}

function settingRow(label: string, settings: QuizSetting[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "quiz-setting-row";
  const title = document.createElement("div");
  title.className = "quiz-setting-label";
  title.textContent = label;
  const options = document.createElement("div");
  options.className = "quiz-options";

  settings.forEach(s => {
    if (s.kind === "toggle") {
      // 表示・回答方法は今の問題にもすぐ反映する
      options.appendChild(optionPill(s.label, s.on, cb => {
        s.on = cb.checked;
        nextQuestion();
      }));
      return;
    }
    s.items.forEach(item => {
      options.appendChild(optionPill(item.label, s.enabled.has(item.key), cb => {
        if (cb.checked) s.enabled.add(item.key);
        else if (s.enabled.size > 1) s.enabled.delete(item.key);
        else cb.checked = true;  // 1つは残す
      }));
    });
  });

  row.append(title, options);
  return row;
}

function optionPill(label: string, checked: boolean, onChange: (cb: HTMLInputElement) => void): HTMLElement {
  const pill = document.createElement("label");
  pill.className = "quiz-option";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb));
  pill.append(cb, label);
  return pill;
}

function render(): void {
  if (getState().screen !== "quiz") {
    if (onScreen) stopQuizSound();
    onScreen = false;
    return;
  }
  if (!onScreen) {
    // 聴き取りの邪魔にならないよう、曲の再生は止める
    if (Playback.isPlaying()) Playback.stop();
    onScreen = true;
  }

  const mode = currentMode();
  const category = QUIZ_CATEGORIES.find(c => c.modes.includes(mode))!;
  lastModeOfCategory.set(category.key, mode.id);

  document.querySelectorAll<HTMLButtonElement>("[data-quiz-category]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.quizCategory === category.key);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-quiz-notes]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.quizNotes === getState().noteNames);
  });

  const modeTabs = $("quiz-modes");
  modeTabs.innerHTML = "";
  category.modes.forEach(m => {
    const btn = document.createElement("button");
    btn.className = "quiz-mode" + (m === mode ? " is-active" : "");
    btn.textContent = m.title;
    btn.addEventListener("click", () => selectMode(m.id));
    modeTabs.appendChild(btn);
  });

  $("quiz-title").textContent = mode.title;
  renderStats();

  if (settingsModeId !== mode.id) {
    renderSettings(mode);
    settingsModeId = mode.id;
  }
  if (questionModeId !== mode.id) nextQuestion();
}

export function initQuizScreen(): void {
  const categories = $("quiz-categories");
  QUIZ_CATEGORIES.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.quizCategory = c.key;
    btn.textContent = c.label;
    btn.addEventListener("click", () => selectMode(lastModeOfCategory.get(c.key) ?? c.modes[0].id));
    categories.appendChild(btn);
  });

  // 音名の表記（CDE／ドレミ。設定画面と共通のアプリ全体の設定）。問題の文面に音名が入るので、切り替えたら新しい問題を出す
  document.querySelectorAll<HTMLButtonElement>("[data-quiz-notes]").forEach(btn => {
    btn.addEventListener("click", () => {
      const notation = btn.dataset.quizNotes as NoteNames;
      if (notation === getState().noteNames) return;
      setNoteNames(notation);
      nextQuestion();
      renderAll();
    });
  });

  $("quiz-next").addEventListener("click", nextQuestion);

  // 回答後は Enter / Space でも次の問題へ
  document.addEventListener("keydown", e => {
    if (getState().screen !== "quiz" || !answered) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    e.preventDefault();
    nextQuestion();
  });

  onRender(render);
}
