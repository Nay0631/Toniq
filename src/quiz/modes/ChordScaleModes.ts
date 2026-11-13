import * as A from "../QuizAudio";
import {
  NOTES, noteList, CHORD_TYPES, DEGREE_ABBR, SCALES, PROGRESSIONS, LISTEN, rand, toggle, group, pick, pickFrom, enabledOf, choice, fixedChoice, chordType, chordNotes, chordMidis, progressionMidis, chordTypeGroup,
} from "../QuizCore";
import type { QuizMode, ChordType, Scale } from "../QuizCore";

// 音楽クイズ「コード・スケール」の出題モード（カテゴリの並びは QuizModes.ts）

// ===== コード・スケール =====

export const majorMinorEar: QuizMode = {
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

export const chordNotesMode = ((): QuizMode => {
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

export const chordEar = ((): QuizMode => {
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

export const chordFormula = ((): QuizMode => {
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

export const chordProgEar = ((): QuizMode => {
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

export const scaleNotes = ((): QuizMode => {
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

export const scaleFormula = ((): QuizMode => {
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

export const relativeKey = ((): QuizMode => {
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
