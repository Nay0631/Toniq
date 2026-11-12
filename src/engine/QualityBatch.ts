import { defaultState, getState, setState } from "./AppState";
import { resolveSimpleMode, pickChorus } from "./SimpleModeResolver";
import { generateSongMelodies } from "./SongForm";
import { songMetrics, chordDBIssues, melodyParamIssues, QUALITY_RULES, SongMetrics } from "./QualityCheck";
import { noteToMidi, timeToUnits, MelodyNote } from "./MelodyGenerator";
import { NOTE_INDEX } from "../data/degree_resolver";
import easyTable from "../data/easy_mode_table.json";

// 自動チェックをまとめて測る（npm run quality。tools/quality-report.mjs が Node から呼ぶ。アプリからは使わない）。
// シンプルモードの「生成する」と同じ手順で、ジャンル×雰囲気ごとに何曲も作り、自動チェックの数値と
// 「どれも似た曲にならないか」（進行・ドラム・メロディのリズムの種類）を集める。
// 乱数は曲ごとにシードから作るので、同じシード・同じ回数なら生成ルールを変えた前後で同じ条件で比べられる

export interface BatchOptions {
  runs:    number;          // ジャンル×雰囲気ごとに作る曲の数
  seed:    number;
  key:     string | null;   // null = 12 のキーを順に使う
  genres:  string[] | null; // null = 全ジャンル
}

// 合否を数える項目（QUALITY_RULES の名前）
export const RULE_NAMES = ["strongFit", "phraseEnd", "leap", "chorusLift", "section", "drops"] as const;
export type RuleName = typeof RULE_NAMES[number];

export interface ComboResult {
  genre: string;
  mood:  string;
  runs:  number;
  pass:  Record<RuleName, { ok: number; judged: number }>;  // 合格の数・判定した数
  avg: {
    strongFit:  number;  // 強拍のコード構成音の割合（0〜1）
    stepRatio:  number;  // 順次進行の割合（0〜1）
    maxLeap:    number;  // 最大の跳躍（半音）
    range:      number;  // 音域（半音）
    chorusLift: number;  // サビ − Aメロの平均の高さ（半音）
    notesPerBar: number; // 1小節あたりの音の数
    drops:      number;  // パートが抜ける所
  };
  variety: {
    chords:   number;  // 使われたコード進行の種類
    drums:    number;  // 使われたドラムパターンの種類
    rhythms:  number;  // メロディの小節ごとのリズムの種類
    melodies: number;  // メロディ（Aメロ。キーからの音程で比べる）の種類
  };
  rhythmSet: string[];  // ジャンル単位で種類を数え直すための元データ
}

export interface BatchResult {
  options:  BatchOptions;
  combos:   ComboResult[];
  chordDB:  ReturnType<typeof chordDBIssues>;
  melodyParams: string[];  // 書式が違うメロディのパラメータ
}

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// シードから作る乱数（mulberry32）
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 小節ごとのリズム（16ステップ。x = 発音、- = 伸ばす、. = 休符）
function barRhythms(notes: MelodyNote[]): string[] {
  const bars = new Map<number, string[]>();
  for (const n of notes) {
    if (n.note === null) continue;
    const start = timeToUnits(n.time);
    const bar = Math.floor(start / 16);
    const steps = bars.get(bar) ?? Array(16).fill(".");
    steps[start % 16] = "x";
    bars.set(bar, steps);
  }
  return [...bars.values()].map(s => s.join(""));
}

// メロディの中身（キーの主音からの音程と位置）。キーが違っても同じメロディなら同じ文字列になる
function melodySignature(notes: MelodyNote[], key: string): string {
  const tonic = NOTE_INDEX[key] ?? 0;
  return notes.filter(n => n.note !== null)
    .map(n => `${timeToUnits(n.time)}:${noteToMidi(n.note!) - tonic}:${n.duration}`).join(" ");
}

// シンプルモードの「生成する」と同じ手順で1曲作る（SimpleScreen.ts の generate / makeMelody）
function generateSong(genre: string, mood: string, key: string): void {
  setState({ ...defaultState, parts: { ...defaultState.parts }, volumes: { ...defaultState.volumes }, genre, mood, key });
  const result = resolveSimpleMode(genre, mood);
  setState({
    chordPattern:  result.chordPattern,
    chorusPattern: pickChorus(result.chordPattern, genre, mood),
    drumPattern:   result.drumPattern,
    bpm:           result.bpm,
    arrangement:   null,
    sections:      null,
    bars:          32,  // SimpleScreen.ts の SIMPLE_SONG_BARS
    melodyMethod:  "auto",
  });
  setState(generateSongMelodies());
}

function judge(metrics: SongMetrics): Record<RuleName, boolean | null> {
  const m = metrics.melody;
  return {
    strongFit:  m ? QUALITY_RULES.strongFit(m) : null,
    phraseEnd:  m ? QUALITY_RULES.phraseEnd(m) : null,
    leap:       m ? QUALITY_RULES.leap(m) : null,
    chorusLift: m ? QUALITY_RULES.chorusLift(m) : null,
    section:    QUALITY_RULES.section(metrics),
    drops:      QUALITY_RULES.drops(metrics),
  };
}

export function runBatch(options: BatchOptions): BatchResult {
  const table = easyTable as Record<string, Record<string, unknown>>;
  const genres = (options.genres ?? Object.keys(table)).filter(g => table[g]);
  const random = Math.random;
  const combos: ComboResult[] = [];

  try {
    for (const genre of genres) {
      for (const mood of Object.keys(table[genre])) {
        const pass = Object.fromEntries(RULE_NAMES.map(r => [r, { ok: 0, judged: 0 }])) as ComboResult["pass"];
        const sum = { strongFit: 0, stepRatio: 0, maxLeap: 0, range: 0, chorusLift: 0, notesPerBar: 0, drops: 0 };
        let melodyCount = 0, liftCount = 0;
        const chords = new Set<string>(), drums = new Set<string>(), rhythms = new Set<string>(), melodies = new Set<string>();

        for (let run = 0; run < options.runs; run++) {
          Math.random = seededRandom(hash(`${options.seed}/${genre}/${mood}/${run}`));
          const key = options.key ?? KEYS[run % KEYS.length];
          generateSong(genre, mood, key);
          const s = getState();
          const metrics = songMetrics();

          const verdict = judge(metrics);
          for (const r of RULE_NAMES) {
            if (verdict[r] === null) continue;
            pass[r].judged++;
            if (verdict[r]) pass[r].ok++;
          }
          sum.drops += metrics.drops;
          const m = metrics.melody;
          if (m) {
            melodyCount++;
            sum.strongFit += m.strongTotal === 0 ? 0 : m.strongFit / m.strongTotal;
            sum.stepRatio += m.stepRatio;
            sum.maxLeap += m.maxLeap;
            sum.range += m.range;
            sum.notesPerBar += m.notes / s.bars;
            if (m.chorusLift !== null) { sum.chorusLift += m.chorusLift; liftCount++; }
          }

          if (s.chordPattern) chords.add(s.chordPattern.id);
          if (s.drumPattern) drums.add(s.drumPattern.id);
          for (const r of [...barRhythms(s.melodyNotes), ...barRhythms(s.chorusMelodyNotes)]) rhythms.add(r);
          melodies.add(melodySignature(s.melodyNotes, s.key));
        }

        const per = (v: number, n: number) => n === 0 ? 0 : v / n;
        combos.push({
          genre, mood, runs: options.runs, pass,
          avg: {
            strongFit:   per(sum.strongFit, melodyCount),
            stepRatio:   per(sum.stepRatio, melodyCount),
            maxLeap:     per(sum.maxLeap, melodyCount),
            range:       per(sum.range, melodyCount),
            chorusLift:  per(sum.chorusLift, liftCount),
            notesPerBar: per(sum.notesPerBar, melodyCount),
            drops:       per(sum.drops, options.runs),
          },
          variety: { chords: chords.size, drums: drums.size, rhythms: rhythms.size, melodies: melodies.size },
          rhythmSet: [...rhythms],
        });
      }
    }
  } finally {
    Math.random = random;
  }
  return { options, combos, chordDB: chordDBIssues(), melodyParams: melodyParamIssues() };
}
