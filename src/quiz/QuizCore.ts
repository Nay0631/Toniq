import { displayNote } from "../ui/format";
import * as A from "./QuizAudio";

// 音楽クイズの共通部分：型・音名・出題に使うデータ（音程・コード・スケール・進行など）・ヘルパー。
// 各カテゴリの出題モードは modes/ に、カテゴリの並びは QuizModes.ts にある

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
export const DOREMI        = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
export const WHITE_INDEXES = [0, 2, 4, 5, 7, 9, 11];
export const ALL_INDEXES   = NOTES.map((_, i) => i);

// 音名（CDE 表記）を今の表記（CDE／ドレミ。アプリ全体の設定 AppState.noteNames）で表す。
// コード名・キー名は CDE 表記のまま
export { displayNote };

export function noteName(index: number): string {
  return displayNote(NOTES[index % 12]);
}

export function noteList(notes: string[]): string {
  return notes.map(displayNote).join(", ");
}

export function isBlack(index: number): boolean {
  return !WHITE_INDEXES.includes(index);
}

// 鍵盤の位置の説明
export const KEY_PLACES = [
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

export const INTERVALS = [
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

export interface ChordType { suffix: string; name: string; semis: number[]; feel: string }

export const CHORD_TYPES: ChordType[] = [
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
export const DEGREE_ABBR: Record<number, string> = {
  0: "R", 1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4",
  6: "TT", 7: "P5", 8: "m6", 9: "M6", 10: "m7", 11: "M7", 12: "P8",
};

export interface Scale { name: string; short: string; semis: number[]; feel: string }

export const SCALES: Scale[] = [
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
export interface Progression { name: string; chords: [number, string][]; desc: string }

export const PROGRESSIONS: Progression[] = [
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

export const EQ_BANDS = [
  { name: "サブベース（20〜60Hz）", freq: 40,    desc: "耳よりも体で感じる重低音。キックやベースのいちばん下の部分です。" },
  { name: "低域（60〜250Hz）",      freq: 120,   desc: "ベースやキックの太さ・厚みが出る帯域です。" },
  { name: "低中域（250〜500Hz）",   freq: 350,   desc: "多すぎると音がこもって聴こえやすい帯域です。" },
  { name: "中域（500Hz〜2kHz）",    freq: 1000,  desc: "声やメロディの中心になる帯域です。" },
  { name: "中高域（2k〜4kHz）",     freq: 3000,  desc: "音の輪郭や抜けのよさに関わる、耳につきやすい帯域です。" },
  { name: "高域（4k〜10kHz）",      freq: 6000,  desc: "ハイハットやシンバルのきらびやかさが出る帯域です。" },
  { name: "超高域（10k〜20kHz）",   freq: 14000, desc: "空気感やつやに関わる、とても高い帯域です。" },
];

// 聴音問題の表示（ヘッドホンのアイコン）
export const LISTEN =
  `<svg class="quiz-listen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/></svg>`;

// ===== ヘルパー =====

export function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

export function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function toggle(label: string, on = true): QuizToggle {
  return { kind: "toggle", label, on };
}

// items は [キー, 表示名] か、表示名だけの並び（キーは添字）
export function group(label: string, items: ([string, string] | string)[]): QuizGroup {
  const list = items.map((it, i) => typeof it === "string" ? { key: String(i), label: it } : { key: it[0], label: it[1] });
  return { kind: "group", label, items: list, enabled: new Set(list.map(it => it.key)) };
}

// 出題範囲から1つ選ぶ
export function pick(g: QuizGroup): string {
  const keys = g.enabled.size > 0 ? [...g.enabled] : g.items.map(it => it.key);
  return keys[rand(keys.length)];
}

export function pickFrom<T>(g: QuizGroup, list: T[]): T {
  return list[Number(pick(g))];
}

// 出題範囲に入っている要素（キーが添字のグループ用）
export function enabledOf<T>(g: QuizGroup, list: T[]): T[] {
  return [...g.enabled].map(k => list[Number(k)]);
}

// 正解と、候補の並びから選んだ不正解で最大4択を作る（前の候補から優先して使う）
export function choice(correct: string, ...pools: string[][]): QuizAnswer {
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
export function fixedChoice(correct: string, choices: string[]): QuizAnswer {
  return { kind: "choice", choices, correct };
}

export function chordType(suffix: string): ChordType {
  return CHORD_TYPES.find(c => c.suffix === suffix) ?? CHORD_TYPES[0];
}

export function chordNotes(root: number, ct: ChordType): string[] {
  return ct.semis.map(s => NOTES[(root + s) % 12]);
}

// 和音を鳴らす高さ（ルートを F3〜E4 に置く）
export function chordRootMidi(root: number): number {
  return 48 + root + (root < 5 ? 12 : 0);
}

export function chordMidis(root: number, ct: ChordType): number[] {
  const r = chordRootMidi(root);
  return ct.semis.map(s => r + s);
}

// コード進行の和音（ルートを1オクターブ下に足す）
export function progressionMidis(prog: Progression, key: number): number[][] {
  return prog.chords.map(([offset, suffix]) => {
    const r = chordRootMidi((key + offset) % 12);
    return [r - 12, ...chordType(suffix).semis.map(s => r + s)];
  });
}

export const SEMITONE_CHOICES = Array.from({ length: 13 }, (_, i) => String(i));

export function intervalGroup(): QuizGroup {
  return group("出題する音程", INTERVALS.map(iv => iv.abbr));
}

export function chordTypeGroup(): QuizGroup {
  return group("出題するコード", CHORD_TYPES.map(ct => `X${ct.suffix}`));
}

export function blackKeyToggle(): QuizToggle {
  return toggle("黒鍵（#）も出題する", false);
}

export function notePool(black: QuizToggle): number[] {
  return black.on ? ALL_INDEXES : WHITE_INDEXES;
}

export function noteSound(index: number): QuizSound {
  return { label: "音を再生", play: () => A.playMelody([60 + index]), afterAnswer: true };
}
