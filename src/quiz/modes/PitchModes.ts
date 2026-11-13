import { getState } from "../../engine/AppState";
import * as A from "../QuizAudio";
import {
  displayNote,
  NOTES, DOREMI, noteName, isBlack, KEY_PLACES, INTERVALS, LISTEN, rand, toggle, group, pick, pickFrom, enabledOf, choice, fixedChoice, SEMITONE_CHOICES, intervalGroup, blackKeyToggle, notePool, noteSound,
} from "../QuizCore";
import type { QuizMode } from "../QuizCore";

// 音楽クイズ「音の高さ」の出題モード（カテゴリの並びは QuizModes.ts）

// ===== 音の高さ =====

export const doremiCde = ((): QuizMode => {
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

export const keyPosition = ((): QuizMode => {
  const black = blackKeyToggle();
  return {
    id: "key_position", title: "鍵盤の位置当て", settings: [black],
    question() {
      const pool = notePool(black);
      const i = pool[rand(pool.length)];
      const other = getState().noteNames === "doremi" ? NOTES[i] : DOREMI[i];
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

export const higherLower = ((): QuizMode => {
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

export const earInterval = ((): QuizMode => {
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

export const degreeSemitone = ((): QuizMode => {
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

export const intervalNote = ((): QuizMode => {
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

export const noteInterval = ((): QuizMode => {
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
