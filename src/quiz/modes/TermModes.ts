import {
  group, pickFrom, choice,
} from "../QuizCore";
import type { QuizMode } from "../QuizCore";

// 音楽クイズ「用語」の出題モード（カテゴリの並びは QuizModes.ts）

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

export const toniqTerms = termMode("toniq_terms", "Toniq の用語", [
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

export const synthParamQuiz = termMode("synth_param_quiz", "シンセのパラメータ", [
  ["アタック（Attack）",       "音が鳴り始めてから最大音量に達するまでの時間"],
  ["ディケイ（Decay）",        "最大音量からサステインレベルまで下がる時間"],
  ["サステイン（Sustain）",    "鍵盤を押し続けている間、一定に保たれる音量レベル"],
  ["リリース（Release）",      "鍵盤を離してから音が消えるまでの時間"],
  ["カットオフ（Cutoff）",     "フィルターが効き始める周波数のポイント"],
  ["レゾナンス（Resonance）",  "カットオフ周波数付近を強調する量"],
  ["ユニゾン（Unison）",       "複数のオシレーターを重ねて音を太くする機能"],
  ["デチューン（Detune）",     "重ねた音の音程を微妙にずらして広がりを出す設定"],
]);
