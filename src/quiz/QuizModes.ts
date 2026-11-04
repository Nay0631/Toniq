import { getState } from "../engine/AppState";
import * as A from "./QuizAudio";

// 音楽クイズの出題モード（初心者向け）。各モードは出題設定（モード内に保持）と問題の作り方を持つ

// ===== 型 =====

// ON/OFF の設定（表示や回答方法）
export interface QuizToggle {
  kind:  "toggle";
  label: string;
  on:    boolean;
}

// 出題範囲の設定（1つ以上を選ぶ）
export interface QuizGroup {
  kind:    "group";
  label:   string;
  items:   { key: string; label: string }[];
  enabled: Set<string>;
}

export type QuizSetting = QuizToggle | QuizGroup;

// 再生ボタン（afterAnswer = 回答後にだけ出す）
export interface QuizSound {
  label:        string;
  play:         () => void;
  afterAnswer?: boolean;
}

// notes / key の音名は CDE 表記（NOTES）で持ち、表示するときに displayNote で今の表記にする
export type QuizAnswer =
  | { kind: "choice"; choices: string[]; correct: string }                          // 選択肢から選ぶ
  | { kind: "notes";  correct: string[]; octaves: number }                          // 鍵盤で複数の音を選んで「決定」
  | { kind: "key";    correct: string; root?: string; hideLabels?: boolean };       // 鍵盤を1つ押す（root は色付きで示す）

// 参照用の鍵盤（C からの半音数で、root と target を色付きで示す）
export interface QuizRefPiano {
  root:    number;
  target:  number;
  octaves: number;
}

export interface Question {
  label:    string;   // 問いかけ
  prompt:   string;   // 問題（HTML。<em> は強調色）
  size?:    "medium" | "small";  // 問題が長いときの文字サイズ
  sub?:     string;
  answer:   QuizAnswer;
  explain?: string;   // 回答後に出す一言の解説
  sounds?:  QuizSound[];
  ref?:     QuizRefPiano;
}

export interface QuizMode {
  id:       string;
  title:    string;
  hint?:    string;   // 出題設定に出すおすすめの始め方
  settings: QuizSetting[];
  question: () => Question;
}

export interface QuizCategory {
  key:   string;
  label: string;
  modes: QuizMode[];
}

// ===== 音名 =====

export const NOTES  = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DOREMI        = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
const WHITE_INDEXES = [0, 2, 4, 5, 7, 9, 11];
const ALL_INDEXES   = NOTES.map((_, i) => i);

// 音名（CDE 表記）を今の表記（CDE／ドレミ）で表す。コード名・キー名は CDE 表記のまま
export function displayNote(note: string): string {
  return getState().quizNoteNames === "doremi" ? DOREMI[NOTES.indexOf(note)] : note;
}

function noteName(index: number): string {
  return displayNote(NOTES[index % 12]);
}

function noteList(notes: string[]): string {
  return notes.map(displayNote).join(", ");
}

function isBlack(index: number): boolean {
  return !WHITE_INDEXES.includes(index);
}

// 鍵盤の位置の説明
const KEY_PLACES = [
  "2つ並んだ黒鍵のすぐ左の白鍵",
  "2つ並んだ黒鍵の左側の黒鍵",
  "2つ並んだ黒鍵のあいだの白鍵",
  "2つ並んだ黒鍵の右側の黒鍵",
  "2つ並んだ黒鍵のすぐ右の白鍵",
  "3つ並んだ黒鍵のすぐ左の白鍵",
  "3つ並んだ黒鍵の左側の黒鍵",
  "3つ並んだ黒鍵の左と真ん中のあいだの白鍵",
  "3つ並んだ黒鍵の真ん中の黒鍵",
  "3つ並んだ黒鍵の真ん中と右のあいだの白鍵",
  "3つ並んだ黒鍵の右側の黒鍵",
  "3つ並んだ黒鍵のすぐ右の白鍵",
];

// ===== 共通データ =====

const INTERVALS = [
  { name: "完全一度",      abbr: "P1", semi: 0 },
  { name: "短二度",        abbr: "m2", semi: 1 },
  { name: "長二度",        abbr: "M2", semi: 2 },
  { name: "短三度",        abbr: "m3", semi: 3 },
  { name: "長三度",        abbr: "M3", semi: 4 },
  { name: "完全四度",      abbr: "P4", semi: 5 },
  { name: "増四度/減五度", abbr: "TT", semi: 6 },
  { name: "完全五度",      abbr: "P5", semi: 7 },
  { name: "短六度",        abbr: "m6", semi: 8 },
  { name: "長六度",        abbr: "M6", semi: 9 },
  { name: "短七度",        abbr: "m7", semi: 10 },
  { name: "長七度",        abbr: "M7", semi: 11 },
  { name: "完全八度",      abbr: "P8", semi: 12 },
];

interface ChordType { suffix: string; name: string; semis: number[]; feel: string }

const CHORD_TYPES: ChordType[] = [
  { suffix: "",     name: "メジャートライアド",   semis: [0, 4, 7],     feel: "明るく安定した響きです。" },
  { suffix: "m",    name: "マイナートライアド",   semis: [0, 3, 7],     feel: "真ん中の音がメジャーより半音低く、暗い響きです。" },
  { suffix: "dim",  name: "ディミニッシュ",       semis: [0, 3, 6],     feel: "短三度を重ねた、不安定で緊張感のある響きです。" },
  { suffix: "aug",  name: "オーグメント",         semis: [0, 4, 8],     feel: "長三度を重ねた、ふわっと浮いたような響きです。" },
  { suffix: "sus2", name: "サスペンデッド2nd",    semis: [0, 2, 7],     feel: "三度の代わりに長二度を使った、すっきりした響きです。" },
  { suffix: "sus4", name: "サスペンデッド4th",    semis: [0, 5, 7],     feel: "三度の代わりに完全四度を使った、次へ進みたくなる響きです。" },
  { suffix: "maj7", name: "メジャー7th",          semis: [0, 4, 7, 11], feel: "メジャーに長七度を足した、おしゃれで柔らかい響きです。" },
  { suffix: "m7",   name: "マイナー7th",          semis: [0, 3, 7, 10], feel: "マイナーに短七度を足した、落ち着いた切ない響きです。" },
  { suffix: "7",    name: "ドミナント7th",        semis: [0, 4, 7, 10], feel: "メジャーに短七度を足した、次のコードへ進みたくなる響きです。" },
  { suffix: "m7♭5", name: "マイナー7thフラット5", semis: [0, 3, 6, 10], feel: "ディミニッシュに短七度を足した、切なく不安定な響きです。" },
  { suffix: "dim7", name: "ディミニッシュ7th",    semis: [0, 3, 6, 9],  feel: "短三度を3つ重ねた、とても不安定な響きです。" },
];

// 主音（ルート）からの半音数 → 度数の略記
const DEGREE_ABBR: Record<number, string> = {
  0: "R", 1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4",
  6: "TT", 7: "P5", 8: "m6", 9: "M6", 10: "m7", 11: "M7", 12: "P8",
};

interface Scale { name: string; short: string; semis: number[]; feel: string }

const SCALES: Scale[] = [
  { name: "アイオニアン（メジャースケール）", short: "メジャー", semis: [0, 2, 4, 5, 7, 9, 11],
    feel: "明るい響きのスケールです。" },
  { name: "ドリアン", short: "ドリアン", semis: [0, 2, 3, 5, 7, 9, 10],
    feel: "マイナーの6番目の音が半音高い、少し明るさのあるマイナーです。" },
  { name: "フリジアン", short: "フリジアン", semis: [0, 1, 3, 5, 7, 8, 10],
    feel: "マイナーの2番目の音が半音低い、エキゾチックで暗い響きです。" },
  { name: "リディアン", short: "リディアン", semis: [0, 2, 4, 6, 7, 9, 11],
    feel: "メジャーの4番目の音が半音高い、浮遊感のある明るさです。" },
  { name: "ミクソリディアン", short: "ミクソリディアン", semis: [0, 2, 4, 5, 7, 9, 10],
    feel: "メジャーの7番目の音が半音低い、ロックやブルースらしい響きです。" },
  { name: "エオリアン（ナチュラルマイナー）", short: "マイナー", semis: [0, 2, 3, 5, 7, 8, 10],
    feel: "暗く切ない響きのスケールです。" },
  { name: "ロクリアン", short: "ロクリアン", semis: [0, 1, 3, 5, 6, 8, 10],
    feel: "5番目の音まで半音低い、とても不安定な響きです。" },
  { name: "ハーモニックマイナー", short: "ハーモニックマイナー", semis: [0, 2, 3, 5, 7, 8, 11],
    feel: "マイナーの7番目の音が半音高い、クラシックや中東風の響きです。" },
  { name: "メロディックマイナー", short: "メロディックマイナー", semis: [0, 2, 3, 5, 7, 9, 11],
    feel: "マイナーの6番目と7番目の音が半音高いスケールです。" },
  { name: "メジャーペンタトニック", short: "メジャーペンタトニック", semis: [0, 2, 4, 7, 9],
    feel: "メジャーから4番目と7番目を抜いた5音で、どの音を選んでもなじみやすいスケールです。" },
  { name: "マイナーペンタトニック", short: "マイナーペンタトニック", semis: [0, 3, 5, 7, 10],
    feel: "マイナーから2番目と6番目を抜いた5音で、ロックやブルースの定番です。" },
  { name: "ブルーノートスケール", short: "ブルーノート", semis: [0, 2, 3, 4, 5, 6, 7, 9, 10, 11],
    feel: "ブルーノート（半音低い3度・5度・7度）を加えた、ブルースらしい響きです。" },
];

// コード進行（[主音からの半音数, コードのサフィックス]）
interface Progression { name: string; chords: [number, string][]; desc: string }

const PROGRESSIONS: Progression[] = [
  { name: "II-V-I", chords: [[2, "m7"], [7, "7"], [0, "maj7"]],
    desc: "ジャズでよく使われる、きれいに主音へ戻る進行です。" },
  { name: "I-IV-V", chords: [[0, ""], [5, ""], [7, ""]],
    desc: "もっとも基本的な、明るくシンプルな進行です。" },
  { name: "I-V-vi-IV", chords: [[0, ""], [7, ""], [9, "m"], [5, ""]],
    desc: "ポップスで定番の、前向きな雰囲気の進行です。" },
  { name: "vi-IV-I-V", chords: [[9, "m"], [5, ""], [0, ""], [7, ""]],
    desc: "マイナーから始まる、切なさのある定番の進行です。" },
  { name: "王道進行（IV-V-IIIm-VIm）", chords: [[5, ""], [7, ""], [4, "m"], [9, "m"]],
    desc: "J-POP でとてもよく使われる、切なく盛り上がる進行です。" },
  { name: "小室進行（VIm-IV-V-I）", chords: [[9, "m"], [5, ""], [7, ""], [0, ""]],
    desc: "疾走感のある、ダンスミュージックでも使われる進行です。" },
  { name: "カノン進行（I-V-VIm-IIIm-IV-I-IV-V）",
    chords: [[0, ""], [7, ""], [9, "m"], [4, "m"], [5, ""], [0, ""], [5, ""], [7, ""]],
    desc: "パッヘルベルの「カノン」と同じ、流れるように下がっていく進行です。" },
  { name: "丸サ進行（IVM7-III7-VIm7-I7）", chords: [[5, "maj7"], [4, "7"], [9, "m7"], [0, "7"]],
    desc: "セブンスコードを使った、おしゃれでジャジーな進行です。" },
];

const EQ_BANDS = [
  { name: "サブベース（20〜60Hz）", freq: 40,    desc: "耳よりも体で感じる重低音。キックやベースのいちばん下の部分です。" },
  { name: "低域（60〜250Hz）",      freq: 120,   desc: "ベースやキックの太さ・厚みが出る帯域です。" },
  { name: "低中域（250〜500Hz）",   freq: 350,   desc: "多すぎると音がこもって聴こえやすい帯域です。" },
  { name: "中域（500Hz〜2kHz）",    freq: 1000,  desc: "声やメロディの中心になる帯域です。" },
  { name: "中高域（2k〜4kHz）",     freq: 3000,  desc: "音の輪郭や抜けのよさに関わる、耳につきやすい帯域です。" },
  { name: "高域（4k〜10kHz）",      freq: 6000,  desc: "ハイハットやシンバルのきらびやかさが出る帯域です。" },
  { name: "超高域（10k〜20kHz）",   freq: 14000, desc: "空気感やつやに関わる、とても高い帯域です。" },
];

// 聴音問題の表示（ヘッドホンのアイコン）
const LISTEN =
  `<svg class="quiz-listen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/></svg>`;

// ===== ヘルパー =====

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toggle(label: string, on = true): QuizToggle {
  return { kind: "toggle", label, on };
}

// items は [キー, 表示名] か、表示名だけの並び（キーは添字）
function group(label: string, items: ([string, string] | string)[]): QuizGroup {
  const list = items.map((it, i) => typeof it === "string" ? { key: String(i), label: it } : { key: it[0], label: it[1] });
  return { kind: "group", label, items: list, enabled: new Set(list.map(it => it.key)) };
}

// 出題範囲から1つ選ぶ
function pick(g: QuizGroup): string {
  const keys = g.enabled.size > 0 ? [...g.enabled] : g.items.map(it => it.key);
  return keys[rand(keys.length)];
}

function pickFrom<T>(g: QuizGroup, list: T[]): T {
  return list[Number(pick(g))];
}

// 出題範囲に入っている要素（キーが添字のグループ用）
function enabledOf<T>(g: QuizGroup, list: T[]): T[] {
  return [...g.enabled].map(k => list[Number(k)]);
}

// 正解と、候補の並びから選んだ不正解で最大4択を作る（前の候補から優先して使う）
function choice(correct: string, ...pools: string[][]): QuizAnswer {
  const choices = [correct];
  for (const pool of pools) {
    for (const c of shuffle(pool)) {
      if (choices.length >= 4) break;
      if (!choices.includes(c)) choices.push(c);
    }
  }
  return { kind: "choice", choices: shuffle(choices), correct };
}

// 並びを固定した選択肢（二択など）
function fixedChoice(correct: string, choices: string[]): QuizAnswer {
  return { kind: "choice", choices, correct };
}

function chordType(suffix: string): ChordType {
  return CHORD_TYPES.find(c => c.suffix === suffix) ?? CHORD_TYPES[0];
}

function chordNotes(root: number, ct: ChordType): string[] {
  return ct.semis.map(s => NOTES[(root + s) % 12]);
}

// 和音を鳴らす高さ（ルートを F3〜E4 に置く）
function chordRootMidi(root: number): number {
  return 48 + root + (root < 5 ? 12 : 0);
}

function chordMidis(root: number, ct: ChordType): number[] {
  const r = chordRootMidi(root);
  return ct.semis.map(s => r + s);
}

// コード進行の和音（ルートを1オクターブ下に足す）
function progressionMidis(prog: Progression, key: number): number[][] {
  return prog.chords.map(([offset, suffix]) => {
    const r = chordRootMidi((key + offset) % 12);
    return [r - 12, ...chordType(suffix).semis.map(s => r + s)];
  });
}

const SEMITONE_CHOICES = Array.from({ length: 13 }, (_, i) => String(i));

function intervalGroup(): QuizGroup {
  return group("出題する音程", INTERVALS.map(iv => iv.abbr));
}

function chordTypeGroup(): QuizGroup {
  return group("出題するコード", CHORD_TYPES.map(ct => "X" + ct.suffix));
}

function blackKeyToggle(): QuizToggle {
  return toggle("黒鍵（#）も出題する", false);
}

function notePool(black: QuizToggle): number[] {
  return black.on ? ALL_INDEXES : WHITE_INDEXES;
}

function noteSound(index: number): QuizSound {
  return { label: "音を再生", play: () => A.playMelody([60 + index]), afterAnswer: true };
}

// ===== 音の高さ =====

const doremiCde = ((): QuizMode => {
  const black = blackKeyToggle();
  const types = group("出題形式", [["to_doremi", "CDE→ドレミ"], ["to_cde", "ドレミ→CDE"]]);
  return {
    id: "doremi_cde", title: "ドレミと CDE", settings: [black, types],
    question() {
      const pool = notePool(black);
      const i = pool[rand(pool.length)];
      const toDoremi = pick(types) === "to_doremi";
      const [from, to] = toDoremi ? [NOTES, DOREMI] : [DOREMI, NOTES];
      return {
        label: toDoremi ? "ドレミで言うと？" : "CDE で言うと？",
        prompt: from[i],
        answer: choice(to[i], pool.map(j => to[j])),
        explain: `${NOTES[i]} ＝ ${DOREMI[i]}。ドレミファソラシ は C D E F G A B に対応します。` +
          (isBlack(i) ? "「#（シャープ）」は半音高い音という意味です。" : ""),
        sounds: [noteSound(i)],
      };
    },
  };
})();

const keyPosition = ((): QuizMode => {
  const black = blackKeyToggle();
  return {
    id: "key_position", title: "鍵盤の位置当て", settings: [black],
    question() {
      const pool = notePool(black);
      const i = pool[rand(pool.length)];
      const other = getState().quizNoteNames === "doremi" ? NOTES[i] : DOREMI[i];
      return {
        label: "この音の鍵盤を押してください",
        prompt: `<em>${noteName(i)}</em>`,
        sub: `（${other}）`,
        answer: { kind: "key", correct: NOTES[i], hideLabels: true },
        explain: `${noteName(i)} は${KEY_PLACES[i]}です。` +
          (isBlack(i) ? `${noteName(i - 1)} より半音高い音です。` : ""),
        sounds: [noteSound(i)],
      };
    },
  };
})();

const higherLower = ((): QuizMode => {
  const gaps = group("2音の差", [["large", "大きい（5〜12半音）"], ["small", "小さい（1〜4半音）"]]);
  gaps.enabled.delete("small");  // 初期状態は聴き分けやすい大きな差だけ
  return {
    id: "higher_lower", title: "高い？低い？", settings: [gaps],
    question() {
      const gap = pick(gaps) === "large" ? 5 + rand(8) : 1 + rand(4);
      const up = Math.random() < 0.5;
      const first = 57 + rand(12);  // A3〜G#4
      const second = first + (up ? gap : -gap);
      return {
        label: "2音目は1音目より高い？低い？", prompt: LISTEN,
        answer: fixedChoice(up ? "高い" : "低い", ["高い", "低い"]),
        explain: `2音目は1音目より ${gap} 半音${up ? "高い" : "低い"}音でした。鍵盤では右へ行くほど高い音になります。`,
        sounds: [{ label: "2音を再生", play: () => A.playMelody([first, second]) }],
      };
    },
  };
})();

const earInterval = ((): QuizMode => {
  const intervals = intervalGroup();
  return {
    id: "ear_interval", title: "音程聴音", settings: [intervals],
    hint: "まずは「出題する音程」を M3（長三度）・P5（完全五度）・P8（完全八度）だけにして始めるのがおすすめです。",
    question() {
      const root = rand(12);
      const iv = pickFrom(intervals, INTERVALS);
      const rootMidi = 60 + root;
      return {
        label: "2音を聴いて、2音目の音を鍵盤で選んでください（色付きの鍵盤が1音目）",
        prompt: LISTEN,
        answer: { kind: "key", correct: NOTES[(root + iv.semi) % 12], root: NOTES[root] },
        explain: `${iv.name}（${iv.abbr}）：1音目から ${iv.semi} 半音上の音です。`,
        sounds: [
          { label: "2音を再生",     play: () => A.playMelody([rootMidi, rootMidi + iv.semi]) },
          { label: "1音目のみ",     play: () => A.playMelody([rootMidi]) },
          { label: "2音目のみ",     play: () => A.playMelody([rootMidi + iv.semi]), afterAnswer: true },
          { label: "2音同時に再生", play: () => A.playNotes([rootMidi, rootMidi + iv.semi]), afterAnswer: true },
        ],
      };
    },
  };
})();

const degreeSemitone = ((): QuizMode => {
  const types = group("出題形式", [["name", "度数→半音数"], ["semitone", "半音数→度数"], ["abbr", "略記→半音数"]]);
  const intervals = intervalGroup();
  return {
    id: "degree_semitone", title: "度数・半音数", settings: [types, intervals],
    question() {
      const iv = pickFrom(intervals, INTERVALS);
      const type = pick(types);
      const explain = `${iv.name}（${iv.abbr}）は ${iv.semi} 半音です。`;
      if (type === "semitone") {
        return {
          label: "度数の名前は？", prompt: `${iv.semi} 半音`, explain,
          answer: choice(iv.name, enabledOf(intervals, INTERVALS).map(i => i.name), INTERVALS.map(i => i.name)),
        };
      }
      return {
        label: "半音数はいくつ？", prompt: type === "name" ? iv.name : iv.abbr, explain,
        answer: choice(String(iv.semi), SEMITONE_CHOICES),
      };
    },
  };
})();

const intervalNote = ((): QuizMode => {
  const usePiano = toggle("鍵盤で回答");
  const intervals = intervalGroup();
  return {
    id: "interval_note", title: "音程（度数）", settings: [usePiano, intervals],
    question() {
      const root = rand(12);
      const iv = pickFrom(intervals, INTERVALS);
      const target = (root + iv.semi) % 12;
      return {
        label: usePiano.on ? "答えの音を鍵盤で選んでください" : "答えの音を選んでください",
        prompt: `<em>${noteName(root)}</em> の${iv.name}`,
        sub: `${iv.abbr} / +${iv.semi} 半音`,
        answer: usePiano.on
          ? { kind: "key", correct: NOTES[target], root: NOTES[root] }
          : choice(noteName(target), NOTES.map(displayNote)),
        explain: `${noteName(root)} から ${iv.semi} 半音上が ${noteName(target)}（${iv.name}）です。`,
        sounds: [{ label: "2音を再生", play: () => A.playMelody([60 + root, 60 + root + iv.semi]), afterAnswer: true }],
      };
    },
  };
})();

const noteInterval = ((): QuizMode => {
  const showPiano = toggle("鍵盤を表示");
  const twoOctave = toggle("2オクターブ表示");
  const types = group("回答方法", [["semitone", "半音数で回答"], ["abbr", "略記で回答"], ["name", "度数で回答"]]);
  return {
    id: "note_interval", title: "2音間の音程", settings: [showPiano, twoOctave, types],
    question() {
      const root = rand(12);
      const semi = rand(11) + 1;  // 1〜11（ユニゾン・オクターブのあいまいさを避ける）
      const iv = INTERVALS[semi];
      const type = pick(types);
      const base = {
        prompt: `<em>${noteName(root)}</em> から <em>${noteName(root + semi)}</em>`,
        ref: showPiano.on
          ? { root, target: twoOctave.on ? root + semi : (root + semi) % 12, octaves: twoOctave.on ? 2 : 1 }
          : undefined,
        explain: `${noteName(root)} から ${noteName(root + semi)} は ${semi} 半音上で、${iv.name}（${iv.abbr}）です。`,
        sounds: [{ label: "2音を再生", play: () => A.playMelody([60 + root, 60 + root + semi]), afterAnswer: true }],
      };
      if (type === "semitone") return { ...base, label: "半音数はいくつ？", answer: choice(String(semi), SEMITONE_CHOICES) };
      if (type === "abbr") return { ...base, label: "度数の略記は？", answer: choice(iv.abbr, INTERVALS.map(i => i.abbr)) };
      return { ...base, label: "度数の名前は？", answer: choice(iv.name, INTERVALS.map(i => i.name)) };
    },
  };
})();

// ===== コード・スケール =====

const majorMinorEar: QuizMode = {
  id: "major_minor_ear", title: "メジャー/マイナー判定", settings: [],
  question() {
    const root = rand(12);
    const major = Math.random() < 0.5;
    const ct = chordType(major ? "" : "m");
    return {
      label: "コードを聴いて、メジャーかマイナーかを選んでください", prompt: LISTEN,
      answer: fixedChoice(major ? "メジャー" : "マイナー", ["メジャー", "マイナー"]),
      explain: `今のコードは ${NOTES[root]}${ct.suffix}（${noteList(chordNotes(root, ct))}）。` +
        "メジャーは明るく、マイナーは暗く聴こえます。違いは真ん中の音で、マイナーはメジャーより半音低くなります。",
      sounds: [
        { label: "コードを再生", play: () => A.playNotes(chordMidis(root, ct)) },
        { label: "1音ずつ再生", play: () => A.playMelody(chordMidis(root, ct), 0.4) },
      ],
    };
  },
};

function chordExplain(root: number, ct: ChordType): string {
  return `${NOTES[root]}${ct.suffix} の構成音は ${noteList(chordNotes(root, ct))}。${ct.feel}`;
}

const chordNotesMode = ((): QuizMode => {
  const twoOctave = toggle("鍵盤を2オクターブ表示");
  const types = group("出題形式", [["to_notes", "コード→構成音（鍵盤）"], ["to_chord", "構成音→コード"]]);
  const chords = chordTypeGroup();
  return {
    id: "chord_notes", title: "コード構成音", settings: [twoOctave, types, chords],
    hint: "まずは「出題するコード」を X（メジャー）と Xm（マイナー）だけにして始めるのがおすすめです。",
    question() {
      const root = rand(12);
      const ct = pickFrom(chords, CHORD_TYPES);
      const notes = chordNotes(root, ct);
      const explain = chordExplain(root, ct);
      const sounds = [{ label: "コードを再生", play: () => A.playNotes(chordMidis(root, ct)), afterAnswer: true }];
      if (pick(types) === "to_notes") {
        return {
          label: "構成音を鍵盤で選んで「決定」を押してください", prompt: NOTES[root] + ct.suffix,
          answer: { kind: "notes", correct: notes, octaves: twoOctave.on ? 2 : 1 }, explain, sounds,
        };
      }
      // 構成音が同じになるコードは不正解の候補にしない
      const decoys = (list: ChordType[]) =>
        list.filter(t => chordNotes(root, t).join() !== notes.join()).map(t => NOTES[root] + t.suffix);
      return {
        label: "コード名は？", prompt: noteList(notes),
        answer: choice(NOTES[root] + ct.suffix, decoys(enabledOf(chords, CHORD_TYPES)), decoys(CHORD_TYPES)),
        explain, sounds,
      };
    },
  };
})();

const chordEar = ((): QuizMode => {
  const twoOctave = toggle("鍵盤を2オクターブ表示");
  const modes = group("回答方法", [["piano", "鍵盤で回答"], ["choice", "選択肢で回答"]]);
  const chords = chordTypeGroup();
  return {
    id: "chord_ear", title: "コード聴音", settings: [twoOctave, modes, chords],
    question() {
      const root = rand(12);
      const ct = pickFrom(chords, CHORD_TYPES);
      const notes = chordNotes(root, ct);
      const midis = chordMidis(root, ct);
      const explain = chordExplain(root, ct);
      const sounds = [
        { label: "コードを再生", play: () => A.playNotes(midis) },
        { label: "1音ずつ再生", play: () => A.playMelody(midis, 0.4) },
      ];
      if (pick(modes) === "piano") {
        return {
          label: "音を聴いて構成音を鍵盤で選び、「決定」を押してください", prompt: LISTEN,
          answer: { kind: "notes", correct: notes, octaves: twoOctave.on ? 2 : 1 }, explain, sounds,
        };
      }
      const decoys = (list: ChordType[]) => list.map(t => noteList(chordNotes(root, t)));
      return {
        label: "音を聴いて構成音を選んでください", prompt: LISTEN,
        answer: choice(noteList(notes), decoys(enabledOf(chords, CHORD_TYPES)), decoys(CHORD_TYPES)),
        explain, sounds,
      };
    },
  };
})();

const chordFormula = ((): QuizMode => {
  const types = group("出題形式", [["to_formula", "コード→度数構成"], ["to_chord", "度数構成→コード"]]);
  const chords = chordTypeGroup();
  const formula = (ct: ChordType) => ct.semis.map(s => DEGREE_ABBR[s]).join(" - ");
  const display = (ct: ChordType) => `${ct.name}（${ct.suffix || "maj"}）`;
  return {
    id: "chord_formula", title: "コードの度数構成", settings: [types, chords],
    question() {
      const ct = pickFrom(chords, CHORD_TYPES);
      const enabled = enabledOf(chords, CHORD_TYPES);
      const explain = `${display(ct)} は ${formula(ct)}。${ct.feel}`;
      if (pick(types) === "to_formula") {
        return {
          label: "度数構成は？", prompt: display(ct), size: "medium", explain,
          answer: choice(formula(ct), enabled.map(formula), CHORD_TYPES.map(formula)),
        };
      }
      return {
        label: "コード名は？", prompt: formula(ct), explain,
        answer: choice(display(ct), enabled.map(display), CHORD_TYPES.map(display)),
      };
    },
  };
})();

const chordProgEar = ((): QuizMode => {
  const progressions = group("出題する進行", PROGRESSIONS.map(p => p.name));
  return {
    id: "chord_prog_ear", title: "コード進行聴音", settings: [progressions],
    question() {
      const prog = pickFrom(progressions, PROGRESSIONS);
      const midis = progressionMidis(prog, rand(12));
      return {
        label: "進行を聴いて、パターンを選んでください", prompt: LISTEN,
        answer: choice(prog.name, enabledOf(progressions, PROGRESSIONS).map(p => p.name), PROGRESSIONS.map(p => p.name)),
        explain: `${prog.name}：${prog.desc}`,
        sounds: [{ label: "進行を再生", play: () => A.playChords(midis) }],
      };
    },
  };
})();

const scaleNotes = ((): QuizMode => {
  const scales = group("出題するスケール", SCALES.map(s => s.short));
  return {
    id: "scale_notes", title: "スケール構成音", settings: [scales],
    question() {
      const root = rand(12);
      const scale = pickFrom(scales, SCALES);
      const notes = scale.semis.map(s => NOTES[(root + s) % 12]);
      return {
        label: "構成音を鍵盤で選んで「決定」を押してください",
        prompt: `<em>${NOTES[root]}</em> ${scale.short}スケール`, size: "medium",
        answer: { kind: "notes", correct: notes, octaves: 1 },
        explain: `${NOTES[root]} ${scale.short}スケールは ${noteList(notes)}。${scale.feel}`,
        sounds: [{
          label: "スケールを再生", afterAnswer: true,
          play: () => A.playMelody([...scale.semis, 12].map(s => 60 + root + s), 0.28),
        }],
      };
    },
  };
})();

const scaleFormula = ((): QuizMode => {
  const types = group("出題形式", [["to_formula", "スケール→度数構成"], ["to_scale", "度数構成→スケール"]]);
  const scales = group("出題するスケール", SCALES.map(s => s.short));
  const formula = (s: Scale) => s.semis.map(x => DEGREE_ABBR[x]).join(" - ");
  return {
    id: "scale_formula", title: "スケールの度数構成", settings: [types, scales],
    question() {
      const scale = pickFrom(scales, SCALES);
      const enabled = enabledOf(scales, SCALES);
      const explain = `${scale.name}：${scale.feel}`;
      if (pick(types) === "to_formula") {
        return {
          label: "主音から見た度数構成は？", prompt: scale.name, size: "medium", explain,
          answer: choice(formula(scale), enabled.map(formula), SCALES.map(formula)),
        };
      }
      return {
        label: "スケール名は？", prompt: formula(scale), size: "small", explain,
        answer: choice(scale.name, enabled.map(s => s.name), SCALES.map(s => s.name)),
      };
    },
  };
})();

const relativeKey = ((): QuizMode => {
  const directions = group("出題形式", [["to_minor", "メジャー→マイナー"], ["to_major", "マイナー→メジャー"]]);
  return {
    id: "relative_key", title: "平行調", settings: [directions],
    question() {
      const root = rand(12);
      const toMinor = pick(directions) === "to_minor";
      const quality = toMinor ? "マイナー" : "メジャー";
      const answerRoot = (root + (toMinor ? 9 : 3)) % 12;
      const major = NOTES[toMinor ? root : answerRoot];
      const minor = NOTES[toMinor ? answerRoot : root];
      return {
        label: "平行調は？",
        prompt: `<em>${NOTES[root]}</em> ${toMinor ? "メジャー" : "マイナー"}`,
        answer: choice(NOTES[answerRoot] + quality, NOTES.map(n => n + quality)),
        explain: `${major}メジャーと ${minor}マイナーは同じ音を使う平行調です。` +
          "マイナーの主音は、メジャーの主音から3半音（短三度）下にあります。",
      };
    },
  };
})();

// ===== リズム・音響 =====

// accents: 1小節のアクセント（2 = 小節の頭、1 = 拍のまとまりの頭、0 = 弱拍）、step: 1つあたりの秒数
const METERS = [
  { name: "4/4", accents: [2, 0, 1, 0],          step: 0.42, desc: "1小節に4拍。いちばんよく使われる拍子で、Toniq の曲もすべて 4/4 です。" },
  { name: "3/4", accents: [2, 0, 0],             step: 0.42, desc: "1小節に3拍。ワルツの「ズン・チャッ・チャッ」の拍子です。" },
  { name: "5/4", accents: [2, 0, 0, 1, 0],       step: 0.42, desc: "1小節に5拍。3拍＋2拍のまとまりで数えると取りやすい拍子です。" },
  { name: "6/8", accents: [2, 0, 0, 1, 0, 0],    step: 0.24, desc: "8分音符6つで1小節。3つずつのまとまりが2回で、揺れるようなノリになります。" },
  { name: "7/8", accents: [2, 0, 1, 0, 1, 0, 0], step: 0.24, desc: "8分音符7つで1小節。2＋2＋3のまとまりで数えることが多い拍子です。" },
];

const meterEar = ((): QuizMode => {
  const meters = group("出題する拍子", METERS.map(m => m.name));
  return {
    id: "meter_ear", title: "拍子判定", settings: [meters],
    question() {
      const meter = pickFrom(meters, METERS);
      const bars = meter.step < 0.3 ? 4 : 3;
      return {
        label: "拍子を聴き取ってください", prompt: LISTEN,
        answer: choice(meter.name, enabledOf(meters, METERS).map(m => m.name), METERS.map(m => m.name)),
        explain: `${meter.name}：${meter.desc}`,
        sounds: [{
          label: "リズムを再生",
          play: () => A.playClicks(Array.from({ length: bars }, () => meter.accents).flat(), meter.step),
        }],
      };
    },
  };
})();

const eqEar = ((): QuizMode => {
  const bands = group("出題する帯域", EQ_BANDS.map(b => b.name));
  return {
    id: "eq_ear", title: "周波数帯域", settings: [bands],
    question() {
      const band = pickFrom(bands, EQ_BANDS);
      return {
        label: "聴こえる周波数帯を選んでください", prompt: LISTEN,
        answer: choice(band.name, enabledOf(bands, EQ_BANDS).map(b => b.name), EQ_BANDS.map(b => b.name)),
        explain: `${band.name}：${band.desc}`,
        sounds: [{ label: "帯域を再生", play: () => A.playBandNoise(band.freq) }],
      };
    },
  };
})();

// ===== 用語（[用語, 説明] から「用語→説明」「説明→用語」を出題する） =====

function termMode(id: string, title: string, terms: [string, string][]): QuizMode {
  const enabled = group("出題する用語", terms.map(t => t[0]));
  return {
    id, title, settings: [enabled],
    question() {
      const [term, desc] = pickFrom(enabled, terms);
      const explain = `${term}：${desc}`;
      if (Math.random() < 0.5) {
        return {
          label: "説明として正しいものは？", prompt: term, size: "medium", explain,
          answer: choice(desc, terms.map(t => t[1])),
        };
      }
      return {
        label: "この説明にあてはまる用語は？", prompt: desc, size: "small", explain,
        answer: choice(term, terms.map(t => t[0])),
      };
    },
  };
}

const toniqTerms = termMode("toniq_terms", "Toniq の用語", [
  ["BPM",          "1分間に打つ拍の数。曲の速さを表す"],
  ["小節",         "拍をいくつかまとめた区切り。Toniq では4拍で1小節"],
  ["ループ",       "同じフレーズをくり返して鳴らすこと"],
  ["コード進行",   "コードを順番に並べた流れ。曲の雰囲気の土台になる"],
  ["メロディ",     "曲の主役になる、1音ずつ流れる旋律"],
  ["ベース",       "低い音でコードの土台を支えるパート"],
  ["アルペジオ",   "コードの音を1音ずつ順番に鳴らす弾き方"],
  ["パッド",       "後ろで長く鳴り続けて、音の厚みを出すパート"],
  ["ドラム",       "キック・スネア・ハイハットなどでリズムを刻むパート"],
  ["キー",         "曲の中心になる音。変えると曲全体の高さが変わる"],
  ["スケール",     "曲で使う音の並び。メジャーは明るく、マイナーは暗く聴こえやすい"],
  ["ディグリー",   "キーの主音から何番目の音かでコードを表す書き方（I・IV・V など）"],
  ["ピアノロール", "横が時間、縦が音の高さの画面で、音符を置いてメロディを入力する画面"],
  ["アレンジ",     "どの小節でどのパートを鳴らすかの組み立て"],
]);

const synthParamQuiz = termMode("synth_param_quiz", "シンセのパラメータ", [
  ["アタック（Attack）",       "音が鳴り始めてから最大音量に達するまでの時間"],
  ["ディケイ（Decay）",        "最大音量からサステインレベルまで下がる時間"],
  ["サステイン（Sustain）",    "鍵盤を押し続けている間、一定に保たれる音量レベル"],
  ["リリース（Release）",      "鍵盤を離してから音が消えるまでの時間"],
  ["カットオフ（Cutoff）",     "フィルターが効き始める周波数のポイント"],
  ["レゾナンス（Resonance）",  "カットオフ周波数付近を強調する量"],
  ["ユニゾン（Unison）",       "複数のオシレーターを重ねて音を太くする機能"],
  ["デチューン（Detune）",     "重ねた音の音程を微妙にずらして広がりを出す設定"],
]);

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
