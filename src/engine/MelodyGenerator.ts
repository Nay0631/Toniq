import { ChordProgression } from "../data/types";
import { resolveChord, ResolvedChord } from "../data/degree_resolver";
import melodyParams from "../data/melody_params.json";

// ===== 型定義 =====
export interface MelodyNote {
  note:     string | null; // null = 休符
  duration: string;
  time:     string;
}

interface MelodyParam {
  noteLengthWeights: Record<string, number>;
  restProbability:   number;
  maxLeap:           number;
  preferStepwise:    boolean;
  octaveRange:       number[];  // [number, number] → number[] に変更
  accentProbability: number;    // 弱拍でアクセント音（ペンタトニック外の2音）を使う確率
}

// ===== 音名→MIDIノート番号 =====
const NOTE_ORDER = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function noteToMidi(note: string): number {
  const name   = note.slice(0, -1);
  const octave = parseInt(note.slice(-1));
  return NOTE_ORDER.indexOf(name) + (octave + 1) * 12;
}

function midiToNote(midi: number): string {
  const name   = NOTE_ORDER[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// ===== スケール音の役割 =====
// core:   ペンタトニックの5音。メロディは基本的にこの5音で作る
// accent: 残りの2音 → 解決先（どちらも主音からの半音数）。
//         弱拍で経過音・刺繍音として使い、次の音で解決先へ順次進行する
interface ScaleTones {
  core:   number[];
  accent: Record<number, number[]>;
}

const SCALE_TONES: Record<string, ScaleTones> = {
  major:    { core: [0, 2, 4, 7, 9],  accent: { 5: [4],     11: [0] } },
  minor:    { core: [0, 3, 5, 7, 10], accent: { 2: [0, 3],  8:  [7] } },
  phrygian: { core: [0, 3, 5, 7, 10], accent: { 1: [0],     8:  [7] } },
  dorian:   { core: [0, 3, 5, 7, 10], accent: { 9: [7, 10], 2:  [0, 3] } },
};

const NOTE_INDEX: Record<string, number> = {
  C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,
  F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,
  A:9,"A#":10,Bb:10,B:11,
};

// ===== スケール音一覧をMIDIで取得 =====
function getScaleNotes(
  root:      number,
  semitones: number[],
  octaveMin: number,
  octaveMax: number
): number[] {
  const notes: number[] = [];
  for (let oct = octaveMin; oct <= octaveMax; oct++) {
    semitones.forEach(s => {
      const midi = (oct + 1) * 12 + ((root + s) % 12);
      notes.push(midi);
    });
  }
  return notes.sort((a, b) => a - b);
}

// ===== 重み付きランダム選択 =====
function weightedRandom(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total   = entries.reduce((s, [, w]) => s + w, 0);
  let rand      = Math.random() * total;
  for (const [key, w] of entries) {
    rand -= w;
    if (rand <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function pickRandom(list: number[]): number {
  return list[Math.floor(Math.random() * list.length)];
}

// ===== 次の音を選ぶ =====
interface PickContext {
  root:          number;   // 主音のピッチクラス
  tones:         ScaleTones;
  scaleNotes:    number[]; // スケール7音（MIDI）
  coreNotes:     number[]; // ペンタトニック5音（MIDI）
  chordMidi:     number[]; // 現在のコードの構成音（ピッチクラス）
  param:         MelodyParam;
  isDownbeat:    boolean;  // 小節の1拍目
  accentAllowed: boolean;  // アクセント音を置いてよい位置か
}

function degreeOf(midi: number, root: number): number {
  return (midi % 12 - root + 12) % 12;
}

// 解決が必要なアクセント音か（コード構成音になっているときは普通の音として扱う）
function needsResolve(midi: number, ctx: PickContext): boolean {
  return ctx.tones.accent[degreeOf(midi, ctx.root)] !== undefined
      && !ctx.chordMidi.includes(midi % 12);
}

function pickNextNote(
  prev:          number | null,
  prevNeedsRes:  boolean,
  ctx:           PickContext
): number {
  const { root, tones, scaleNotes, coreNotes, chordMidi, param } = ctx;

  // 直前がアクセント音なら、解決先へ順次進行（2半音以内）
  if (prev !== null && prevNeedsRes) {
    const targets    = tones.accent[degreeOf(prev, root)] ?? [];
    const candidates = scaleNotes.filter(n =>
      n !== prev && Math.abs(n - prev) <= 2 && targets.includes(degreeOf(n, root))
    );
    if (candidates.length > 0) return pickRandom(candidates);
  }

  // ダウンビート（小節の1拍目）はコード構成音に着地
  if (ctx.isDownbeat && chordMidi.length > 0) {
    const candidates = scaleNotes.filter(n => chordMidi.includes(n % 12));
    if (candidates.length > 0) return pickRandom(candidates);
  }

  if (prev === null) return pickRandom(coreNotes);

  // 弱拍ではアクセント音を経過音・刺繍音として入れる
  if (ctx.accentAllowed && Math.random() < param.accentProbability) {
    const candidates = scaleNotes.filter(n =>
      n !== prev && Math.abs(n - prev) <= 2 && needsResolve(n, ctx)
    );
    if (candidates.length > 0) return pickRandom(candidates);
  }

  // それ以外はペンタトニック5音＋コード構成音になっているアクセント音から選ぶ
  const pool = scaleNotes.filter(n => coreNotes.includes(n) || chordMidi.includes(n % 12));

  // 跳躍幅・順次進行の優先度を適用してフィルタリング
  let candidates = pool.filter(n => {
    const leap = Math.abs(n - prev);
    if (leap === 0) return false;           // 同じ音の連続を避ける
    if (leap > param.maxLeap) return false; // 最大跳躍を超えない
    return true;
  });

  if (candidates.length === 0) candidates = scaleNotes;

  // 順次進行優先の場合、近い音に重みを付ける
  if (param.preferStepwise) {
    candidates.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
    // 上位半分に絞る
    candidates = candidates.slice(0, Math.max(3, Math.ceil(candidates.length / 2)));
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ===== メイン生成関数 =====
export function generateMelody(
  progression: ChordProgression,
  key:         string = "A",
  genre:       string = "ローファイ"
): MelodyNote[] {
  const param = (melodyParams as unknown as Record<string, MelodyParam>)[genre]
              ?? (melodyParams as unknown as Record<string, MelodyParam>)["ローファイ"];
  const root       = NOTE_INDEX[key] ?? 0;
  const tones      = SCALE_TONES[progression.base_scale] ?? SCALE_TONES.minor;
  const allTones   = [...tones.core, ...Object.keys(tones.accent).map(Number)];
  const scaleNotes = getScaleNotes(root, allTones,   param.octaveRange[0], param.octaveRange[1]);
  const coreNotes  = getScaleNotes(root, tones.core, param.octaveRange[0], param.octaveRange[1]);

  const notes: MelodyNote[] = [];
  let currentTime = 0; // 16分音符単位で管理
  const totalBars = progression.length_bars;
  const totalUnits = totalBars * 16; // 1小節 = 16ステップ（16分音符基準）

  const durationToUnits: Record<string, number> = {
    "1n": 16, "2n": 8, "4n": 4, "8n": 2, "16n": 1,
  };

  // コードごとのMIDI構成音を取得
  const chordMap: { startUnit: number; midiNotes: number[] }[] = [];
  progression.progression.forEach(chord => {
    const resolved: ResolvedChord = resolveChord(
      chord.degree, chord.type, chord.inversion,
      key, progression.base_scale, 4
    );
    const midiNotes = resolved.notes.map(n => noteToMidi(n) % 12);
    chordMap.push({ startUnit: (chord.bar - 1) * 16, midiNotes });
  });

  function getChordMidi(unit: number): number[] {
    let current = chordMap[0].midiNotes;
    for (const c of chordMap) {
      if (unit >= c.startUnit) current = c.midiNotes;
    }
    return current;
  }

  let prevMidi: number | null = null;
  let prevNeedsRes = false;

  while (currentTime < totalUnits) {
    // 休符判定（直前のアクセント音は休符を挟まずすぐ解決させる）
    if (!prevNeedsRes && Math.random() < param.restProbability) {
      const dur   = weightedRandom(param.noteLengthWeights);
      const units = durationToUnits[dur] ?? 4;
      const bar   = Math.floor(currentTime / 16);
      const beat  = Math.floor((currentTime % 16) / 4);
      const tick  = (currentTime % 4);
      notes.push({ note: null, duration: dur, time: `${bar}:${beat}:${tick}` });
      currentTime += units;
      continue;
    }

    const dur       = weightedRandom(param.noteLengthWeights);
    const units     = durationToUnits[dur] ?? 4;
    const isDownbeat = currentTime % 16 === 0;
    const chordMidi = getChordMidi(currentTime);
    // 1拍目・3拍目の頭と最後の音にはアクセント音を置かない（解決できずに終わるのを防ぐ）
    const accentAllowed = currentTime % 8 !== 0 && currentTime + units < totalUnits;
    const ctx: PickContext = {
      root, tones, scaleNotes, coreNotes, chordMidi, param, isDownbeat, accentAllowed,
    };
    const midi      = pickNextNote(prevMidi, prevNeedsRes, ctx);
    const bar       = Math.floor(currentTime / 16);
    const beat      = Math.floor((currentTime % 16) / 4);
    const tick      = (currentTime % 4);

    notes.push({
      note:     midiToNote(midi),
      duration: dur,
      time:     `${bar}:${beat}:${tick}`,
    });

    prevMidi     = midi;
    prevNeedsRes = needsResolve(midi, ctx);
    currentTime += Math.min(units, totalUnits - currentTime);
  }

  return notes;
}