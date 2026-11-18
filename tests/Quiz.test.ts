import { describe, it, expect, afterEach } from "vitest";
import { QUIZ_MODES } from "../src/quiz/QuizModes";
import { NOTES, PROGRESSIONS, EQ_BANDS, chordType } from "../src/quiz/QuizCore";
import type { QuizGroup, QuizToggle, Question } from "../src/quiz/QuizCore";
import { seededRandom } from "./helpers";

// 音楽クイズ：出題範囲の初期値・全モードの出題・音程を鍵盤で答える問題の位置

const random = Math.random;
afterEach(() => { Math.random = random; });

const groupsOf = (id: string) =>
  QUIZ_MODES.find(m => m.id === id)!.settings.filter((s): s is QuizGroup => s.kind === "group");
const togglesOf = (id: string) =>
  QUIZ_MODES.find(m => m.id === id)!.settings.filter((s): s is QuizToggle => s.kind === "toggle");

// 出題設定を一時的に変えて問題を作る（終わったら元に戻す）
function withSettings<T>(id: string, apply: () => void, run: () => T): T {
  const groups = groupsOf(id).map(g => [g, new Set(g.enabled)] as const);
  const toggles = togglesOf(id).map(t => [t, t.on] as const);
  try {
    apply();
    return run();
  } finally {
    groups.forEach(([g, saved]) => { g.enabled = saved; });
    toggles.forEach(([t, on]) => { t.on = on; });
  }
}

function questions(id: string, count: number): Question[] {
  const mode = QUIZ_MODES.find(m => m.id === id)!;
  return Array.from({ length: count }, () => mode.question());
}

describe("音楽クイズ", () => {
  it("どの出題範囲も1つ以上選ばれていて、選んだキーは項目にある", () => {
    for (const mode of QUIZ_MODES) {
      for (const g of groupsOf(mode.id)) {
        expect(g.enabled.size, `${mode.id} ${g.label}`).toBeGreaterThan(0);
        for (const key of g.enabled) expect(g.items.some(it => it.key === key), `${mode.id} ${key}`).toBe(true);
      }
    }
  });

  it("初心者向けに、聴き取り・知識の難しいモードは範囲を絞って始め、出題設定でおすすめを案内する", () => {
    const narrowed = ["ear_interval", "degree_semitone", "interval_note", "chord_notes", "chord_ear", "chord_formula",
      "chord_prog_ear", "scale_notes", "scale_formula", "meter_ear", "eq_ear"];
    for (const id of narrowed) {
      const range = groupsOf(id).find(g => g.label.startsWith("出題する"))!;
      expect(range.enabled.size, id).toBeLessThan(range.items.length);
      expect(QUIZ_MODES.find(m => m.id === id)!.hint, id).toBeTruthy();
    }
  });

  it("出題範囲をすべて選んでも、すべてのモードで例外なく問題を作れ、正解が選択肢にある", () => {
    Math.random = seededRandom(1);
    for (const mode of QUIZ_MODES) {
      withSettings(mode.id, () => groupsOf(mode.id).forEach(g => { g.enabled = new Set(g.items.map(it => it.key)); }), () => {
        for (const q of questions(mode.id, 60)) {
          expect(q.explain, mode.id).toBeTruthy();
          if (q.answer.kind === "choice") {
            expect(q.answer.choices, mode.id).toContain(q.answer.correct);
            expect(new Set(q.answer.choices).size, mode.id).toBe(q.answer.choices.length);
          }
        }
      });
    }
  });

  it("コード進行のコードはどれも CHORD_TYPES にあり、名前は重ならない", () => {
    for (const p of PROGRESSIONS) for (const [, suffix] of p.chords) expect(() => chordType(suffix), p.name).not.toThrow();
    expect(new Set(PROGRESSIONS.map(p => p.name)).size).toBe(PROGRESSIONS.length);
  });

  it("音程を鍵盤で答える問題は、答えの鍵盤が1音目と同じかそれより右にあり、表示した鍵盤に収まる", () => {
    Math.random = seededRandom(2);
    const all = (id: string) => () => groupsOf(id).forEach(g => { g.enabled = new Set(g.items.map(it => it.key)); });
    const check = (q: Question) => {
      if (q.answer.kind !== "key") throw new Error("鍵盤で答える問題ではありません");
      const at = q.answer.at!;
      expect(at.root).toBeGreaterThanOrEqual(0);
      expect(at.root).toBeLessThan(12);
      expect(at.correct).toBeGreaterThanOrEqual(at.root);
      expect(at.correct).toBeLessThan(at.octaves * 12);
      expect(NOTES[at.correct % 12]).toBe(q.answer.correct);
    };
    withSettings("ear_interval", all("ear_interval"), () => questions("ear_interval", 300).forEach(check));
    withSettings("interval_note", () => { all("interval_note")(); togglesOf("interval_note")[0].on = true; },
      () => questions("interval_note", 300).forEach(check));
  });

  it("2音間の音程の参照用の鍵盤は、2音目がいつも1音目より右にある", () => {
    Math.random = seededRandom(3);
    for (const q of questions("note_interval", 300)) {
      expect(q.ref!.target).toBeGreaterThan(q.ref!.root);
      expect(q.ref!.target).toBeLessThan(q.ref!.octaves * 12);
    }
  });

  it("周波数帯域の持ち上げは小さく（ピークが 0dBFS を超えない範囲）、サブベースと超高域だけに付ける", () => {
    for (const b of EQ_BANDS) {
      expect(b.trim).toBeGreaterThanOrEqual(0);
      expect(b.trim).toBeLessThanOrEqual(6);
    }
    expect(EQ_BANDS.filter(b => b.trim > 0).map(b => b.freq)).toEqual([40, 14000]);
  });
});
