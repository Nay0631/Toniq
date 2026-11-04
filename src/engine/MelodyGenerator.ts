import { ChordProgression } from "../data/types";
import {
  resolveChord, ResolvedChord, NOTE_INDEX, SCALE_TONES, ScaleTones,
} from "../data/degree_resolver";
import melodyParams from "../data/melody_params.json";

// ===== 型定義 =====
export interface MelodyNote {
  note:     string | null; // null = 休符
  duration: string;
  time:     string;
}

interface MelodyParam {
  rhythmPatterns:    string[];  // 1小節16ステップのリズム（x = 発音, - = 伸ばす, . = 休符）
  phraseForms:       string[];  // フレーズ形式（1文字 = 1小節。同じ文字の小節は同じモチーフ）
  maxLeap:           number;
  preferStepwise:    boolean;
  octaveRange:       number[];  // [number, number] → number[] に変更
  accentProbability: number;    // 弱拍でアクセント音（ペンタトニック外の2音）を使う確率
}

// ===== 音名→MIDIノート番号 =====
const NOTE_ORDER = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

export function noteToMidi(note: string): number {
  const name   = note.slice(0, -1);
  const octave = parseInt(note.slice(-1));
  return NOTE_ORDER.indexOf(name) + (octave + 1) * 12;
}

export function midiToNote(midi: number): string {
  const name   = NOTE_ORDER[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

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

// ===== リズムテンプレート =====
interface RhythmEvent {
  start: number; // 曲頭からの16分音符単位
  units: number; // 長さ（16分音符単位）
}

// 16ステップの文字列を発音イベントに変換する（先頭の "-" は休符扱い）
function parseRhythm(pattern: string, barOffset: number): RhythmEvent[] {
  const events: RhythmEvent[] = [];
  let current: RhythmEvent | null = null;
  for (let step = 0; step < 16; step++) {
    const c = pattern[step] ?? ".";
    if (c === "x") {
      current = { start: barOffset + step, units: 1 };
      events.push(current);
    } else if (c === "-" && current) {
      current.units++;
    } else {
      current = null;
    }
  }
  return events;
}

// 16分音符単位の長さを Tone.js の音価表記に変換する
const UNITS_TO_DURATION: Record<number, string> = {
  1: "16n", 2: "8n", 3: "8n.", 4: "4n", 6: "4n.", 8: "2n", 12: "2n.", 16: "1n",
};

export function unitsToDuration(units: number): string {
  return UNITS_TO_DURATION[units]
      ?? `0:${Math.floor(units / 4)}:${units % 4}`; // 半端な長さは 小節:拍:16分 表記
}

export function unitsToTime(units: number): string {
  return `${Math.floor(units / 16)}:${Math.floor((units % 16) / 4)}:${units % 4}`;
}

// 小節:拍:16分 表記を16分音符単位に戻す
export function timeToUnits(time: string): number {
  const [bar = 0, beat = 0, sixteenth = 0] = time.split(":").map(Number);
  return bar * 16 + beat * 4 + sixteenth;
}

// 音価表記（"4n" など）か 小節:拍:16分 表記の長さを16分音符単位に戻す
export function durationToUnits(duration: string): number {
  const entry = Object.entries(UNITS_TO_DURATION).find(([, d]) => d === duration);
  if (entry) return Number(entry[0]);
  return duration.includes(":") ? timeToUnits(duration) : 4;
}

function pickRandom<T>(list: T[]): T {
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
  isDownbeat:    boolean;  // 小節の最初の音
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

  // 小節の最初の音はコード構成音に着地
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

  const totalBars  = progression.length_bars;
  const totalUnits = totalBars * 16; // 1小節 = 16ステップ（16分音符基準）

  // フレーズ形式（例: "AAAB"）。同じ記号の小節は同じモチーフ（リズム＋音の動き）を使う。
  // 形式より長い進行は形式を繰り返す
  const form     = pickRandom(param.phraseForms);
  const letterOf = (bar: number) => form[bar % form.length];
  const rhythmOf: Record<string, string> = {};
  for (let bar = 0; bar < totalBars; bar++) {
    rhythmOf[letterOf(bar)] ??= pickRandom(param.rhythmPatterns);
  }

  // 小節ごとの発音イベントを先に決める
  const barEvents: RhythmEvent[][] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    barEvents.push(parseRhythm(rhythmOf[letterOf(bar)], bar * 16));
  }
  const events = barEvents.flat();

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

  function makeContext(index: number): PickContext {
    const ev         = events[index];
    const next       = events[index + 1];
    const isDownbeat = index === 0 || Math.floor(events[index - 1].start / 16) !== Math.floor(ev.start / 16);
    // 1拍目・3拍目の頭にはアクセント音を置かない。
    // 次の音が休符を挟まず続くときだけ置く（解決できずに途切れるのを防ぐ）
    const accentAllowed = ev.start % 8 !== 0 && !isDownbeat
                       && next !== undefined && next.start === ev.start + ev.units;
    return {
      root, tones, scaleNotes, coreNotes, chordMidi: getChordMidi(ev.start),
      param, isDownbeat, accentAllowed,
    };
  }

  // モチーフの小節を、最初の音が新しいコードの構成音になるようスケール上でずらす。
  // ずらさずに合うならそのまま繰り返す。音域に収まらなければ null
  function transposeBar(source: number[], firstIndex: number): number[] | null {
    if (source.length === 0) return [];
    const chordMidi = getChordMidi(events[firstIndex].start);
    const indices   = source.map(m => scaleNotes.indexOf(m));
    const shifts    = [0];
    for (let k = 1; k <= 3; k++) shifts.push(...(Math.random() < 0.5 ? [k, -k] : [-k, k]));
    for (const shift of shifts) {
      const moved = indices.map(i => scaleNotes[i + shift]);
      if (moved.some(m => m === undefined)) continue;
      if (chordMidi.includes(moved[0] % 12)) return moved;
    }
    return null;
  }

  // ===== 音高を決める =====
  const midis: number[] = [];
  const firstBarOf: Record<string, number> = {};
  let prevMidi: number | null = null;
  let prevNeedsRes = false;

  barEvents.forEach((evs, bar) => {
    const firstIndex = midis.length;
    const sourceBar  = firstBarOf[letterOf(bar)];
    firstBarOf[letterOf(bar)] ??= bar;

    let barMidis: number[] | null = null;
    if (sourceBar !== undefined) {
      const sourceIndex = barEvents.slice(0, sourceBar).reduce((s, e) => s + e.length, 0);
      barMidis = transposeBar(midis.slice(sourceIndex, sourceIndex + evs.length), firstIndex);
    }

    // 新しいモチーフ（またはずらしても合わないとき）は1音ずつ選ぶ
    if (!barMidis) {
      barMidis = evs.map((_, j) => {
        const ctx  = makeContext(firstIndex + j);
        const midi = pickNextNote(prevMidi, prevNeedsRes, ctx);
        prevMidi     = midi;
        prevNeedsRes = needsResolve(midi, ctx);
        return midi;
      });
    }

    midis.push(...barMidis);
    if (barMidis.length > 0) {
      // ずらしたモチーフの末尾が置けない位置のアクセント音なら、あとで直すので解決させない
      const ctx    = makeContext(midis.length - 1);
      prevMidi     = barMidis[barMidis.length - 1];
      prevNeedsRes = needsResolve(prevMidi, ctx) && ctx.accentAllowed;
    }
  });

  // ずらしたモチーフで解決できなくなったアクセント音は、いちばん近いペンタトニック音かコード構成音に直す
  midis.forEach((midi, i) => {
    const ctx = makeContext(i);
    if (!needsResolve(midi, ctx)) return;
    const next     = midis[i + 1];
    const targets  = tones.accent[degreeOf(midi, root)];
    const resolved = ctx.accentAllowed && next !== undefined && next !== midi
                  && Math.abs(next - midi) <= 2 && targets.includes(degreeOf(next, root));
    if (resolved) return;
    const pool = scaleNotes.filter(n => coreNotes.includes(n) || ctx.chordMidi.includes(n % 12));
    const best = Math.min(...pool.map(n => Math.abs(n - midi)));
    midis[i] = pickRandom(pool.filter(n => Math.abs(n - midi) === best));
  });

  // ===== MelodyNote に変換（音の間は休符） =====
  const notes: MelodyNote[] = [];
  let currentTime = 0; // 16分音符単位で管理

  events.forEach((ev, i) => {
    if (ev.start > currentTime) {
      notes.push({ note: null, duration: unitsToDuration(ev.start - currentTime), time: unitsToTime(currentTime) });
    }
    notes.push({ note: midiToNote(midis[i]), duration: unitsToDuration(ev.units), time: unitsToTime(ev.start) });
    currentTime = ev.start + ev.units;
  });

  if (currentTime < totalUnits) {
    notes.push({ note: null, duration: unitsToDuration(totalUnits - currentTime), time: unitsToTime(currentTime) });
  }

  return notes;
}
