import * as A from "../QuizAudio";
import {
  EQ_BANDS, LISTEN, group, startWith, pickFrom, enabledOf, choice,
} from "../QuizCore";
import type { QuizMode } from "../QuizCore";

// 音楽クイズ「リズム・音響」の出題モード（カテゴリの並びは QuizModes.ts）

// ===== リズム・音響 =====

// accents: 1小節のアクセント（2 = 小節の頭、1 = 拍のまとまりの頭、0 = 弱拍）、step: 1つあたりの秒数
const METERS = [
  { name: "4/4", accents: [2, 0, 1, 0],          step: 0.42, desc: "1小節に4拍。いちばんよく使われる拍子です。Toniq の曲も初期は 4/4 です（カスタムモードの「もっと調整」で 3/4 や3連符にもできます）。" },
  { name: "3/4", accents: [2, 0, 0],             step: 0.42, desc: "1小節に3拍。ワルツの「ズン・チャッ・チャッ」の拍子です。Toniq ではジャンル「ワルツ」がこの拍子で、カスタムモードの「もっと調整」でも選べます。" },
  { name: "5/4", accents: [2, 0, 0, 1, 0],       step: 0.42, desc: "1小節に5拍。3拍＋2拍のまとまりで数えると取りやすい拍子です。" },
  { name: "6/8", accents: [2, 0, 0, 1, 0, 0],    step: 0.24, desc: "8分音符6つで1小節。3つずつのまとまりが2回で、揺れるようなノリになります。" },
  { name: "7/8", accents: [2, 0, 1, 0, 1, 0, 0], step: 0.24, desc: "8分音符7つで1小節。2＋2＋3のまとまりで数えることが多い拍子です。" },
];

export const meterEar = ((): QuizMode => {
  const meters = startWith(group("出題する拍子", METERS.map(m => m.name)), ["4/4", "3/4"]);
  return {
    id: "meter_ear", title: "拍子判定", settings: [meters],
    hint: "最初は 4/4 と 3/4 だけを出題します。いちばん高いクリックが小節の頭です。慣れたら「出題する拍子」を増やしてみましょう。",
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

export const eqEar = ((): QuizMode => {
  const bands = startWith(group("出題する帯域", EQ_BANDS.map(b => b.name)), ["低域（60〜250Hz）", "中域（500Hz〜2kHz）", "高域（4k〜10kHz）"]);
  return {
    id: "eq_ear", title: "周波数帯域", settings: [bands],
    hint: "最初は低域・中域・高域の3つだけを出題します。サブベースはノートPCのスピーカーではほとんど聴こえないので、ヘッドホンで聴くのがおすすめです。",
    question() {
      const band = pickFrom(bands, EQ_BANDS);
      return {
        label: "聴こえる周波数帯を選んでください", prompt: LISTEN,
        sub: "どの帯域も同じくらいの大きさで鳴ります。音の高さ（こもった音か、シャリシャリした音か）で聴き分けてください",
        answer: choice(band.name, enabledOf(bands, EQ_BANDS).map(b => b.name), EQ_BANDS.map(b => b.name)),
        explain: `${band.name}：${band.desc}`,
        sounds: [{ label: "帯域を再生", play: () => A.playBandNoise(band.freq, band.trim) }],
      };
    },
  };
})();
