import { ChordProgression } from "../data/types";
import {
  resolveChord, ResolvedChord, NOTE_INDEX, SCALE_TONES, ScaleTones,
} from "../data/degree_resolver";
import melodyParams from "../data/melody_params.json";
import type { Section } from "./AppState";

// ===== 型定義 =====
export interface MelodyNote {
  note:     string | null; // null = 休符
  duration: string;
  time:     string;
}

interface MelodyParam {
  rhythmPatterns:    string[];  // 1小節16ステップのリズム（x = 発音, - = 伸ばす, . = 休符）
  chorusRhythmPatterns?: string[];  // サビ（section B）のリズム。拍の頭から始まる・長く伸ばす音で Aメロと差を付ける（なし = rhythmPatterns）
  phraseForms:       string[];  // フレーズ形式（1文字 = 1小節。同じ文字の小節は同じモチーフ。小文字は大文字のモチーフの終わりを必ず変える A'）
  maxLeap:           number;
  preferStepwise:    boolean;
  octaveRange:       number[];  // [number, number] → number[] に変更
  accentProbability: number;    // 弱拍でアクセント音（ペンタトニック外の2音）を使う確率
  variation?:        number;    // くり返すモチーフの最後の音を変える確率（なし = DEFAULT_VARIATION）
  suspension?:       number;    // コードが変わる小節の頭で掛留を使う確率（なし = DEFAULT_SUSPENSION）
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

// 重みを付けて1つ選ぶ（重みがすべて 0 なら均等に選ぶ）
function pickWeighted<T>(list: T[], weight: (item: T) => number): T {
  const weights = list.map(weight);
  const total   = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pickRandom(list);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

// ===== 音の上がり下がりの形（輪郭） =====
// フレーズ（フレーズ形式1回分）の中の位置 t（0〜1）で、音域のどのあたりを狙うか（0 = 低い、1 = 高い）
type Contour = "arch" | "rise" | "fall" | "wave";

const CONTOURS: Record<Contour, (t: number) => number> = {
  arch: t => t < 0.6 ? 0.2 + 0.8 * (t / 0.6) : 1 - 0.7 * ((t - 0.6) / 0.4),  // 山型（6割あたりで最高音）
  rise: t => 0.15 + 0.85 * t,                                               // だんだん上がる
  fall: t => 1 - 0.8 * t,                                                   // だんだん下がる
  wave: t => 0.5 + 0.4 * Math.sin(2 * Math.PI * t),                         // 上がって下がって戻る
};

// セクションごとの形の候補と、音域のうち使う範囲（サビは高めの音域で、山型か上昇の形にする）
const SECTION_SHAPE: Record<Section, { contours: Contour[]; band: [number, number] }> = {
  A: { contours: ["arch", "wave", "fall", "rise"], band: [0,   0.6] },
  B: { contours: ["arch", "rise", "arch"],         band: [0.4, 1] },
};

// melody_params.json に variation / suspension がないときの値
const DEFAULT_VARIATION = 0.35;  // くり返すモチーフの最後の音を変える確率（A → A'）
const DEFAULT_SUSPENSION: Record<string, number> = {  // コードが変わる小節の頭で掛留を使う確率
  "ローファイ": 0.3, "アンビエント": 0.3, "ハウス": 0.25, "トランス": 0.25,
  "EDM": 0.2, "ゲームBGM": 0.2, "テクノ": 0.15, "8bit": 0.1,
};
const STRONG_BEAT_CHORD_TONE = 0.7;  // 3拍目の頭の音をコード構成音にする確率

// ===== 次の音を選ぶ =====
interface PickContext {
  root:          number;   // 主音のピッチクラス
  tones:         ScaleTones;
  scaleNotes:    number[]; // スケール7音（MIDI）
  coreNotes:     number[]; // ペンタトニック5音（MIDI）
  chordMidi:     number[]; // 現在のコードの構成音（ピッチクラス）
  param:         MelodyParam;
  isDownbeat:    boolean;  // 小節の最初の音
  strongBeat:    boolean;  // 3拍目の頭（小節の最初の音を除く）
  accentAllowed: boolean;  // アクセント音を置いてよい位置か
  target:        number;   // 輪郭から決めた、この位置で狙う高さ（MIDI）
}

function degreeOf(midi: number, root: number): number {
  return (midi % 12 - root + 12) % 12;
}

// 解決が必要なアクセント音か（コード構成音になっているときは普通の音として扱う）
function needsResolve(midi: number, ctx: PickContext): boolean {
  return ctx.tones.accent[degreeOf(midi, ctx.root)] !== undefined
      && !ctx.chordMidi.includes(midi % 12);
}

// 狙う高さに近いほど大きい重み
function closeness(midi: number, target: number): number {
  const d = Math.abs(midi - target) / 4;
  return 1 / (1 + d * d);
}

function pickNextNote(
  prev:          number | null,
  prevNeedsRes:  boolean,
  ctx:           PickContext
): number {
  const { root, tones, scaleNotes, coreNotes, chordMidi, param, target } = ctx;

  // 直前がアクセント音なら、解決先へ順次進行（2半音以内）
  if (prev !== null && prevNeedsRes) {
    const targets    = tones.accent[degreeOf(prev, root)] ?? [];
    const candidates = scaleNotes.filter(n =>
      n !== prev && Math.abs(n - prev) <= 2 && targets.includes(degreeOf(n, root))
    );
    if (candidates.length > 0) return pickRandom(candidates);
  }

  // 小節の最初の音はコード構成音に着地（大きく跳ばず、輪郭の高さに近いものを選ぶ）
  if (ctx.isDownbeat && chordMidi.length > 0) {
    let candidates = scaleNotes.filter(n => chordMidi.includes(n % 12));
    if (prev !== null) {
      const near = candidates.filter(n => Math.abs(n - prev) <= Math.max(param.maxLeap, 5) + 2);
      if (near.length > 0) candidates = near;
    }
    if (candidates.length > 0) return pickWeighted(candidates, n => closeness(n, target));
  }

  if (prev === null) return pickWeighted(coreNotes, n => closeness(n, target));

  // 弱拍ではアクセント音を経過音・刺繍音として入れる
  if (ctx.accentAllowed && Math.random() < param.accentProbability) {
    const candidates = scaleNotes.filter(n =>
      n !== prev && Math.abs(n - prev) <= 2 && needsResolve(n, ctx)
    );
    if (candidates.length > 0) return pickRandom(candidates);
  }

  // それ以外はペンタトニック5音＋コード構成音になっているアクセント音から選ぶ
  let pool = scaleNotes.filter(n => coreNotes.includes(n) || chordMidi.includes(n % 12));

  // 3拍目の頭はコード構成音を優先する（コードとぶつかる音を強拍に置かない）
  if (ctx.strongBeat && Math.random() < STRONG_BEAT_CHORD_TONE) {
    const chordTones = pool.filter(n =>
      chordMidi.includes(n % 12) && n !== prev && Math.abs(n - prev) <= param.maxLeap);
    if (chordTones.length > 0) pool = chordTones;
  }

  // 跳躍幅を適用してフィルタリング
  let candidates = pool.filter(n => {
    const leap = Math.abs(n - prev);
    if (leap === 0) return false;           // 同じ音の連続を避ける
    if (leap > param.maxLeap) return false; // 最大跳躍を超えない
    return true;
  });

  if (candidates.length === 0) candidates = scaleNotes;

  // 輪郭の高さに近い音ほど選ばれやすく、順次進行優先なら直前の音に近い音にも重みを付ける
  return pickWeighted(candidates, n => {
    let w = closeness(n, target);
    if (param.preferStepwise) w *= 1 / (1 + Math.abs(n - prev) / 2);
    return w;
  });
}

// ===== メイン生成関数 =====
export interface MelodyOptions {
  section?:  Section;  // B（サビ）なら高めの音域で、山型・上昇の形にする。省略すると A
  prevNote?: number;   // このメロディの直前に鳴る音（MIDI。Aメロの最後の音など）。最初の音を近くに置き、継ぎ目で大きく跳ばない
}

export function generateMelody(
  progression: ChordProgression,
  key:         string = "A",
  genre:       string = "ローファイ",
  options:     MelodyOptions = {}
): MelodyNote[] {
  const params     = melodyParams as unknown as Record<string, MelodyParam>;
  const param      = params[genre] ?? params["ローファイ"];
  const section    = options.section ?? "A";
  const variation  = param.variation  ?? DEFAULT_VARIATION;
  const suspension = param.suspension ?? DEFAULT_SUSPENSION[genre] ?? 0.2;
  const root       = NOTE_INDEX[key] ?? 0;
  const tones      = SCALE_TONES[progression.base_scale] ?? SCALE_TONES.minor;
  const allTones   = [...tones.core, ...Object.keys(tones.accent).map(Number)];
  const scaleNotes = getScaleNotes(root, allTones,   param.octaveRange[0], param.octaveRange[1]);
  const coreNotes  = getScaleNotes(root, tones.core, param.octaveRange[0], param.octaveRange[1]);

  const totalBars  = progression.length_bars;
  const totalUnits = totalBars * 16; // 1小節 = 16ステップ（16分音符基準）

  // フレーズ形式（例: "AAAB"）。同じ記号の小節は同じモチーフ（リズム＋音の動き）を使う。
  // 小文字（例: "AABa" の a）は大文字と同じモチーフで、終わりの音を必ず変える（A'）。
  // 形式より長い進行は形式を繰り返す
  const form       = pickRandom(param.phraseForms);
  const letterOf   = (bar: number) => form[bar % form.length].toUpperCase();
  const isVariant  = (bar: number) => form[bar % form.length] !== letterOf(bar);
  // サビは専用のリズムがあればそちらから選ぶ（Aメロとリズムの感じを変える）
  const rhythmPool = section === "B" && param.chorusRhythmPatterns?.length ? param.chorusRhythmPatterns : param.rhythmPatterns;
  const rhythmOf: Record<string, string> = {};
  for (let bar = 0; bar < totalBars; bar++) {
    rhythmOf[letterOf(bar)] ??= pickRandom(rhythmPool);
  }

  // 小節ごとの発音イベントを先に決める
  const barEvents: RhythmEvent[][] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    barEvents.push(parseRhythm(rhythmOf[letterOf(bar)], bar * 16));
  }
  const events = barEvents.flat();

  // 輪郭：フレーズ形式1回分を1つの形で動く。音域のうちセクションの範囲を使う
  const shape       = SECTION_SHAPE[section];
  const contour     = CONTOURS[pickRandom(shape.contours)];
  const lowMidi     = scaleNotes[0];
  const highMidi    = scaleNotes[scaleNotes.length - 1];
  const phraseUnits = Math.min(totalUnits, form.length * 16);
  function targetAt(unit: number): number {
    const t = (unit % phraseUnits) / phraseUnits;
    const [lo, hi] = shape.band;
    return lowMidi + (highMidi - lowMidi) * (lo + (hi - lo) * contour(t));
  }

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
      strongBeat: ev.start % 16 === 8 && !isDownbeat,
      target:     targetAt(ev.start),
    };
  }

  // 掛留：コードが変わる小節の頭で、前の音が新しいコードの構成音でなければ同じ音を弾き直し、
  // 次の音で下の構成音（1〜2半音下）へ解決する。解決先を返す（使わないときは null）
  function suspensionAt(index: number, prev: number | null, ctx: PickContext): number | null {
    if (prev === null || index === 0 || Math.random() >= suspension) return null;
    const ev = events[index], next = events[index + 1];
    if (!next || next.start !== ev.start + ev.units || Math.floor(next.start / 16) !== Math.floor(ev.start / 16)) return null;
    if (ctx.chordMidi.includes(prev % 12)) return null;
    if (getChordMidi(events[index - 1].start) === ctx.chordMidi) return null;  // コードが変わっていない
    return scaleNotes.find(n => (n === prev - 1 || n === prev - 2) && ctx.chordMidi.includes(n % 12)) ?? null;
  }

  // モチーフの小節を、最初の音が新しいコードの構成音になるようスケール上でずらす（オクターブ違いも含める）。
  // 候補のうち、直前の音からの跳躍が小さく、輪郭の高さに近いものを選ぶ（最初の小節より前に音がなければ、ずらし幅が小さいもの）。
  // 音域に収まらなければ null
  function transposeBar(source: number[], firstIndex: number, prev: number | null): number[] | null {
    if (source.length === 0) return [];
    const chordMidi = getChordMidi(events[firstIndex].start);
    const target    = targetAt(events[firstIndex].start);
    const indices   = source.map(m => scaleNotes.indexOf(m));
    let best: number[] | null = null;
    let bestScore = Infinity;
    for (let shift = -10; shift <= 10; shift++) {
      const moved = indices.map(i => scaleNotes[i + shift]);
      if (moved.some(m => m === undefined) || !chordMidi.includes(moved[0] % 12)) continue;
      const center = moved.reduce((a, b) => a + b, 0) / moved.length;
      const score  = prev === null
        ? Math.abs(shift)
        : Math.abs(moved[0] - prev) + Math.abs(center - target) * 0.3;
      if (score < bestScore || (score === bestScore && Math.random() < 0.5)) {
        best = moved;
        bestScore = score;
      }
    }
    // 近い候補でも跳躍が大きすぎるなら、くり返さずに1音ずつ選び直す
    const limit = Math.max(param.maxLeap, 5) + 2;
    if (best && prev !== null && Math.abs(best[0] - prev) > limit) return null;
    return best;
  }

  // ===== 音高を決める =====
  const midis: number[] = [];
  const keep = new Set<number>();  // あとの直しで変えない音（掛留とその解決、終止の音）
  const firstBarOf: Record<string, number> = {};
  let prevMidi: number | null = options.prevNote ?? null;
  let prevNeedsRes = false;

  barEvents.forEach((evs, bar) => {
    const firstIndex = midis.length;
    const sourceBar  = firstBarOf[letterOf(bar)];
    firstBarOf[letterOf(bar)] ??= bar;

    let barMidis: number[] | null = null;
    if (sourceBar !== undefined) {
      const sourceIndex = barEvents.slice(0, sourceBar).reduce((s, e) => s + e.length, 0);
      barMidis = transposeBar(midis.slice(sourceIndex, sourceIndex + evs.length), firstIndex, prevMidi);

      // モチーフを少し変える：くり返しの最後の1〜2音だけ選び直す（A → A'。機械的なくり返しにしない）。
      // 形式で小文字の小節は必ず変える
      if (barMidis && barMidis.length >= 2 && (isVariant(bar) || Math.random() < variation)) {
        const k = barMidis.length >= 4 ? 2 : 1;
        for (let j = barMidis.length - k; j < barMidis.length; j++) {
          const ctx = makeContext(firstIndex + j);
          barMidis[j] = pickNextNote(barMidis[j - 1], false, { ...ctx, accentAllowed: false });
        }
      }
    }

    // 新しいモチーフ（またはずらしても合わないとき）は1音ずつ選ぶ
    if (!barMidis) {
      const picked: number[] = [];
      let resolveTo: number | null = null;
      evs.forEach((_, j) => {
        const index = firstIndex + j;
        const ctx   = makeContext(index);
        let midi: number;
        const sus = resolveTo === null && j === 0 ? suspensionAt(index, prevMidi, ctx) : null;
        if (resolveTo !== null) {
          midi = resolveTo;  // 掛留の解決
          resolveTo = null;
          keep.add(index);
        } else if (sus !== null && prevMidi !== null) {
          midi = prevMidi;   // 掛留：前の音を弾き直す
          resolveTo = sus;
          keep.add(index);
        } else {
          midi = pickNextNote(prevMidi, prevNeedsRes, ctx);
        }
        prevMidi     = midi;
        prevNeedsRes = !keep.has(index) && needsResolve(midi, ctx);
        picked.push(midi);
      });
      barMidis = picked;
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
    if (keep.has(i)) return;
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

  // ===== 終止：フレーズの終わりの音 =====
  // 進行の最後の音は主音で言い切る（コードに合わなければ安定したコード構成音）。
  // 前半の終わりは主音を避けて5度・2度などで止め、問いかけと答えの形にする
  const lastIndexInBar = (bar: number): number => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (Math.floor(events[i].start / 16) === bar) return i;
    }
    return -1;
  };

  // preferences：主音からの半音数の候補を優先順に。maxUnits：この長さ（16分音符）までは伸ばす。
  // wrapTo：ループで次に鳴る音（進行の最初の音）。指定すると、その音からも離れすぎない高さを選ぶ
  function land(i: number, preferences: number[][], avoidRoot: boolean, maxUnits: number, wrapTo?: number): void {
    if (i < 0) return;
    const ctx  = makeContext(i);
    const prev = i > 0 ? midis[i - 1] : midis[i];
    const deg  = (n: number) => degreeOf(n, root);
    const fits = (n: number) => ctx.chordMidi.includes(n % 12) && !(avoidRoot && deg(n) === 0);
    let pool: number[] = [];
    for (const degrees of preferences) {
      pool = scaleNotes.filter(n => degrees.includes(deg(n)) && fits(n));
      if (pool.length > 0) break;
    }
    if (pool.length === 0) pool = scaleNotes.filter(fits);
    if (pool.length === 0) return;
    const cost = (n: number) => Math.abs(n - prev) + (wrapTo === undefined ? 0 : Math.abs(n - wrapTo) * 0.7);
    const best = Math.min(...pool.map(cost));
    midis[i] = pickRandom(pool.filter(n => cost(n) === best));
    keep.add(i);

    // 短すぎる音は、次の音（なければ進行の終わり）までの間で少し伸ばして落ち着かせる
    const ev    = events[i];
    const limit = (events[i + 1]?.start ?? totalUnits) - ev.start;
    if (ev.units < maxUnits) ev.units = Math.max(ev.units, Math.min(limit, maxUnits));
  }

  const finalIndex = events.length - 1;
  if (totalBars >= 2) {
    const halfBar   = Math.max(0, Math.floor(totalBars / 2) - 1);
    const halfIndex = lastIndexInBar(halfBar);
    if (halfIndex >= 0 && halfIndex !== finalIndex) land(halfIndex, [[7], [2], [3, 4]], true, 4);
  }
  land(finalIndex, [[0], [7], [3, 4]], false, 6, midis[0]);

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
