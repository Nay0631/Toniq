import { ChordProgression } from "../data/types";
import { NOTE_INDEX, SCALE_TONES } from "../data/degree_resolver";
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
  variation?:        number;    // くり返すモチーフの最後の音を変える確率（なし = DEFAULT_VARIATION）
  pitchLimit?:       number;    // メロディで使う音の数の上限（主音を含む。テクノ = 2 でミニマルにする。なし = 制限なし）
  chorusBand?:       number[];  // サビ（section B）で使う音域の範囲 [下, 上]（0〜1。なし = SECTION_SHAPE.B.band）。音域の狭いジャンルでサビを持ち上げる
  verseBand?:        number[];  // Aメロ（section A）で使う音域の範囲（なし = SECTION_SHAPE.A.band）
}

// ===== 音名→MIDIノート番号 =====
const NOTE_ORDER = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

export function noteToMidi(note: string): number {
  const name   = note.slice(0, -1);
  const octave = parseInt(note.slice(-1), 10);
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

// melody_params.json に variation がないときの値
const DEFAULT_VARIATION = 0.35;  // くり返すモチーフの最後の音を変える確率（A → A'）
// 同じ音を続けて鳴らしてよい数（連打はここまで）と、同じ音を選ぶときの重み（順次進行などとの比）
const MAX_REPEAT    = 3;
const REPEAT_WEIGHT = 0.6;
// 休符をはさまずに続く音どうしで許す跳躍（半音）。ループの継ぎ目も含め、超えた所は小節の一部をオクターブ動かして直す。
// 自動チェック（QualityCheck.ts の QUALITY_RULES.leap）の基準と同じ
export const JUMP_LIMIT = 9;

// 1小節で外す（基本の5音以外の accent の2音を使う）回数。小節の音の数から決める
export function accentsPerBar(notes: number): number {
  if (notes <= 1) return 0;
  if (notes <= 3) return 1;
  if (notes <= 7) return 2;
  return 3;
}

// ===== 次の音を選ぶ =====
// コード構成音は見ない。基本の5音（pool）から、輪郭の高さに近い音・順次進行の音を選びやすくする
interface PickContext {
  pool:   number[];  // 選べる音（MIDI。基本の5音。pitchLimit のジャンルはその数の音だけ）
  param:  MelodyParam;
  target: number;    // 輪郭から決めた、この位置で狙う高さ（MIDI）
  downbeat: boolean; // 小節の最初の音（輪郭の高さを狙い直す）
}

function degreeOf(midi: number, root: number): number {
  return (midi % 12 - root + 12) % 12;
}

// 狙う高さに近いほど大きい重み
function closeness(midi: number, target: number): number {
  const d = Math.abs(midi - target) / 4;
  return 1 / (1 + d * d);
}

// 列の終わりで同じ音が何回続いているか（空なら 1 = 直前の音 prev だけ）
function trailingRepeats(seq: number[]): number {
  if (seq.length === 0) return 1;
  let n = 1;
  while (n < seq.length && seq[seq.length - 1 - n] === seq[seq.length - 1]) n++;
  return n;
}

// repeats = 直前の音が今いくつ続いているか
function pickNextNote(prev: number | null, repeats: number, ctx: PickContext): number {
  const { pool, param, target } = ctx;
  if (prev === null) return pickWeighted(pool, n => closeness(n, target));

  let candidates = pool.filter(n => {
    const leap = Math.abs(n - prev);
    if (leap === 0) return repeats < MAX_REPEAT;  // 同じ音の連打は MAX_REPEAT 回まで
    return leap <= param.maxLeap;
  });
  if (candidates.length === 0) candidates = pool;

  // 小節の最初の音は、大きく跳ばない範囲で輪郭の高さに近い音を選ぶ（フレーズ全体の山・谷を作る）
  if (ctx.downbeat) {
    const reach = Math.max(param.maxLeap, 5) + 2;
    const near  = candidates.filter(n => Math.abs(n - prev) <= reach);
    return pickWeighted(near.length > 0 ? near : candidates, n => closeness(n, target) * (n === prev ? REPEAT_WEIGHT : 1));
  }

  // それ以外は、輪郭の高さに近い音ほど選ばれやすく、直前の音に近い音（順次進行）にも重みを付ける。
  // preferStepwise のジャンルは強く、そうでないジャンルも弱く順次進行を好む
  return pickWeighted(candidates, n => {
    const w = closeness(n, target);
    const leap = Math.abs(n - prev);
    if (leap === 0) return w * REPEAT_WEIGHT;
    return w / (1 + leap / (param.preferStepwise ? 2 : 6));
  });
}

// ===== メイン生成関数 =====
export interface MelodyOptions {
  section?:  Section;  // B（サビ）なら高めの音域で、山型・上昇の形にする。省略すると A
  prevNote?: number;   // このメロディの直前に鳴る音（MIDI。Aメロの最後の音など）。最初の音を近くに置き、継ぎ目で大きく跳ばない
  nextNote?: number;   // このメロディのあとに鳴る別のメロディの最初の音（MIDI。サビのあとの Aメロの最初の音など）。最後の音をそこからも離しすぎない
  pitchClasses?: number[];  // pitchLimit のジャンルで使う音名（ピッチクラス 0〜11）。Aメロと同じ音名でサビを作るのに使う
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
  const variation  = param.variation ?? DEFAULT_VARIATION;
  const root       = NOTE_INDEX[key] ?? 0;
  const tones      = SCALE_TONES[progression.base_scale] ?? SCALE_TONES.minor;
  const accentDegs = Object.keys(tones.accent).map(Number);
  const scaleNotes = getScaleNotes(root, [...tones.core, ...accentDegs], param.octaveRange[0], param.octaveRange[1]);
  const coreNotes  = getScaleNotes(root, tones.core, param.octaveRange[0], param.octaveRange[1]);
  const isAccent   = (midi: number) => accentDegs.includes(degreeOf(midi, root));

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
  const barOf  = (i: number) => Math.floor(events[i].start / 16);

  // 輪郭：フレーズ形式1回分を1つの形で動く。音域のうちセクションの範囲を使う
  const bandParam   = section === "B" ? param.chorusBand : param.verseBand;
  const shape       = bandParam?.length === 2
    ? { ...SECTION_SHAPE[section], band: [bandParam[0], bandParam[1]] as [number, number] }
    : SECTION_SHAPE[section];
  const contour     = CONTOURS[pickRandom(shape.contours)];
  const lowMidi     = scaleNotes[0];
  const highMidi    = scaleNotes[scaleNotes.length - 1];
  const phraseUnits = Math.min(totalUnits, form.length * 16);
  function targetAt(unit: number): number {
    const t = (unit % phraseUnits) / phraseUnits;
    const [lo, hi] = shape.band;
    return lowMidi + (highMidi - lowMidi) * (lo + (hi - lo) * contour(t));
  }

  // 使う音：基本の5音。pitchLimit のジャンル（テクノ）は、主音を含むその数の音だけ（ミニマルにする）
  const limited = (param.pitchLimit ?? 0) > 0;
  const pool    = limited ? limitedPool(param.pitchLimit ?? 2) : coreNotes;

  function limitedPool(limit: number): number[] {
    let degrees = (options.pitchClasses ?? [])
      .map(pc => ((pc - root) % 12 + 12) % 12)
      .filter((d, i, list) => tones.core.includes(d) && list.indexOf(d) === i);
    if (!degrees.includes(0)) {
      // 主音＋基本の5音からランダムに選んだ音
      degrees = [0, ...tones.core.filter(d => d !== 0).sort(() => Math.random() - 0.5)];
    }
    degrees = [0, ...degrees.filter(d => d !== 0)].slice(0, limit);
    // 主音は音域の真ん中に近い高さ。ほかの音は Aメロでは主音の下、サビでは主音の上に置く（サビを高くする）
    const center = (lowMidi + highMidi) / 2;
    const tonics = scaleNotes.filter(n => degreeOf(n, root) === 0);
    const tonic  = tonics.reduce((a, b) => Math.abs(b - center) < Math.abs(a - center) ? b : a);
    const notes  = degrees.map(d => {
      if (d === 0) return tonic;
      const up = tonic + d, down = tonic + d - 12;
      // 主音から JUMP_LIMIT を超えて離れない側に置く
      const near = section === "B" ? (d <= JUMP_LIMIT ? up : down) : (12 - d <= JUMP_LIMIT ? down : up);
      const far  = near === up ? down : up;
      return near >= lowMidi && near <= highMidi ? near : far;
    });
    return [...new Set(notes)].sort((a, b) => a - b);
  }

  function contextAt(index: number): PickContext {
    const downbeat = index === 0 || barOf(index - 1) !== barOf(index);
    return { pool, param, target: targetAt(events[index].start), downbeat };
  }

  // モチーフの小節を、使う音（pool）の上でずらす（ゼクエンツ）。直前の音からの跳躍が小さく、輪郭の高さに近いものを選ぶ
  // （最初の小節より前に音がなければ、ずらし幅が小さいもの）。音域に収まらない・跳びすぎるなら null（1音ずつ選び直す）。
  // pitchLimit のジャンルは使う音が決まっているので、そのままくり返す
  function transposeBar(source: number[], firstIndex: number, prev: number | null): number[] | null {
    if (source.length === 0 || limited) return [...source];
    const target  = targetAt(events[firstIndex].start);
    const indices = source.map(m => pool.indexOf(m));
    if (indices.some(i => i < 0)) return null;
    let best: number[] | null = null;
    let bestScore = Infinity;
    for (let shift = -10; shift <= 10; shift++) {
      const moved = indices.map(i => pool[i + shift]);
      if (moved.some(m => m === undefined)) continue;
      const center = moved.reduce((a, b) => a + b, 0) / moved.length;
      const score  = prev === null
        ? Math.abs(shift)
        : Math.abs(moved[0] - prev) * 0.5 + Math.abs(center - target) * 0.5;
      if (score < bestScore || (score === bestScore && Math.random() < 0.5)) {
        best = moved;
        bestScore = score;
      }
    }
    const limit = Math.max(param.maxLeap, 5) + 2;
    if (best && prev !== null && Math.abs(best[0] - prev) > limit) return null;
    return best;
  }

  // ===== 音高を決める（基本の5音だけで作る。コード構成音は見ない） =====
  const midis: number[] = [];
  const keep = new Set<number>();  // 外す音にしない音（フレーズの終わりの音）
  const firstBarOf: Record<string, number> = {};
  let prevMidi: number | null = options.prevNote ?? null;

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
          barMidis[j] = pickNextNote(barMidis[j - 1], trailingRepeats([...midis, ...barMidis.slice(0, j)]), contextAt(firstIndex + j));
        }
      }
    }

    // 新しいモチーフ（またはずらしても合わないとき）は1音ずつ選ぶ
    if (!barMidis) {
      const picked: number[] = [];
      evs.forEach((_, j) => {
        const midi = pickNextNote(prevMidi, trailingRepeats([...midis, ...picked]), contextAt(firstIndex + j));
        picked.push(midi);
        prevMidi = midi;
      });
      barMidis = picked;
    }

    midis.push(...barMidis);
    if (barMidis.length > 0) prevMidi = barMidis[barMidis.length - 1];
  });

  // ===== 終止：フレーズの終わりの音 =====
  // 進行の最後の音は主音で言い切る（なければ5度・3度）。
  // 前半の終わりは主音を避けて5度・2度・3度などで止め、問いかけと答えの形にする
  const lastIndexInBar = (bar: number): number => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (barOf(i) === bar) return i;
    }
    return -1;
  };

  // preferences：主音からの半音数の候補を優先順に。maxUnits：この長さ（16分音符）までは伸ばす。
  // wrapTo：ループで次に鳴る音（進行の最初の音）。指定すると、その音からも離れすぎない高さを選ぶ
  function land(i: number, preferences: number[][], avoidRoot: boolean, maxUnits: number, wrapTo: number[] = []): void {
    if (i < 0) return;
    const prev = i > 0 ? midis[i - 1] : midis[i];
    const deg  = (n: number) => degreeOf(n, root);
    const fits = (n: number) => !(avoidRoot && deg(n) === 0);
    let cands: number[] = [];
    for (const degrees of preferences) {
      cands = pool.filter(n => degrees.includes(deg(n)) && fits(n));
      if (cands.length > 0) break;
    }
    if (cands.length === 0) cands = pool.filter(fits);
    if (cands.length === 0) return;
    // 直前の音から跳びすぎない候補を優先する（ループの頭との継ぎ目はあとで smoothLeaps が直す）
    const near = cands.filter(n => Math.abs(n - prev) <= JUMP_LIMIT);
    if (near.length > 0) cands = near;
    const cost = (n: number) => Math.abs(n - prev) + wrapTo.reduce((sum, w) => sum + Math.abs(n - w) * 0.7, 0);
    const best = Math.min(...cands.map(cost));
    midis[i] = pickRandom(cands.filter(n => cost(n) === best));
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
  land(finalIndex, [[0], [7], [3, 4]], false, 6,
       options.nextNote === undefined ? [midis[0]] : [midis[0], options.nextNote]);

  // ===== 外す：1小節に数回、基本の5音以外の音（accent）を使う =====
  // メジャー系は 4・7 番目、マイナー系は 2・6 番目の音（SCALE_TONES の accent）。今の音から2半音以内（なければ3半音以内）の音に置き換え、
  // 次の音で進む先（accent の値）へ順次進行させる。同じ文字（モチーフ）の小節は、なるべく同じ位置で外す。
  // 小節の最初の音（ほかに置ける所がないときを除く）・フレーズの終わりの音は外さない。
  // pitchLimit のジャンルは使う音が決まっているので外さない
  if (!limited) placeAccents();

  function placeAccent(i: number): boolean {
    const cur = midis[i], prev = midis[i - 1];
    const next: number | undefined = midis[i + 1];
    if (isAccent(prev) || (next !== undefined && isAccent(next))) return false;  // 外した音を続けない
    // 今の音から2半音以内（なければ3半音以内）で、前後の音から大きく跳ばないもの
    const near = (range: number) => scaleNotes.filter(n => isAccent(n) && Math.abs(n - cur) <= range && n !== prev && n !== next
      && Math.abs(n - prev) <= JUMP_LIMIT && (next === undefined || Math.abs(next - n) <= JUMP_LIMIT));
    let cands = near(2);
    if (cands.length === 0) cands = near(3);
    if (cands.length === 0) return false;
    const resolves = (a: number) => next !== undefined && next !== a && Math.abs(next - a) <= 2
      && tones.accent[degreeOf(a, root)].includes(degreeOf(next, root));
    const score = (a: number) => (resolves(a) ? 0 : 3) + Math.abs(a - prev) * 0.3 + Math.random() * 0.1;
    const accent = cands.reduce((a, b) => score(b) < score(a) ? b : a);
    midis[i] = accent;

    // 次の音が進む先でなければ、同じ小節の中なら進む先へ直す（終止の音は変えない）
    if (!resolves(accent) && next !== undefined && !keep.has(i + 1) && barOf(i + 1) === barOf(i)) {
      const goals = tones.accent[degreeOf(accent, root)];
      const after = midis[i + 2];
      const to = scaleNotes.filter(n => n !== accent && Math.abs(n - accent) <= 2 && goals.includes(degreeOf(n, root))
        && (after === undefined || Math.abs(after - n) <= JUMP_LIMIT));
      if (to.length > 0) midis[i + 1] = to.reduce((a, b) => Math.abs(b - next) < Math.abs(a - next) ? b : a);
    }
    return true;
  }

  function placeAccents(): void {
    const positionsOf: Record<string, number[]> = {};  // 文字（モチーフ）ごとに、外した位置（小節の何音目か）
    let first = 0;
    barEvents.forEach((evs, bar) => {
      const eligible = evs.map((_, j) => j).filter(j => j > 0 && !keep.has(first + j) && first + j < finalIndex);
      const want     = Math.min(accentsPerBar(evs.length), eligible.length);
      const before   = (positionsOf[letterOf(bar)] ?? []).filter(j => eligible.includes(j));
      const order    = [...before, ...eligible.filter(j => !before.includes(j)).sort(() => Math.random() - 0.5)];
      const placed: number[] = [];
      for (const j of order) {
        if (placed.length >= want) break;
        if (placeAccent(first + j)) placed.push(j);
      }
      // ほかに置ける所がなければ、小節の最初の音で外す（音が少ない小節。メロディの最初の音は除く）
      if (placed.length === 0 && evs.length >= 2 && first > 0 && !keep.has(first) && placeAccent(first)) placed.push(0);
      positionsOf[letterOf(bar)] ??= placed;
      first += evs.length;
    });
  }

  // ===== 大きな跳躍を直す =====
  // 続けて鳴る音（間の休符が1拍未満）の跳躍が JUMP_LIMIT を超える所を、小節の前側か後ろ側をまとめてオクターブ動かして直す。
  // まとめて動かすので小節の中の動き（モチーフ・外した音の進み方）は変わらない。
  // ループの継ぎ目（最後の音 → 最初の音）と、前後に鳴る別のメロディ（prevNote / nextNote）との継ぎ目も数える。
  // pitchLimit のジャンルは使う音を増やさないよう動かさない（使う音は主音から上下6半音以内なので大きく跳ばない）
  if (!limited) smoothLeaps();

  function smoothLeaps(): void {
    const n = midis.length;
    if (n === 0) return;
    const endOf     = (i: number) => events[i].start + events[i].units;
    const connected = (i: number) => events[i].start - endOf(i - 1) < 4;
    const wraps     = totalUnits - endOf(n - 1) + events[0].start < 4;
    const opensNear = events[0].start < 4;
    const endsNear  = totalUnits - endOf(n - 1) < 4;
    const excess    = (a: number, b: number) => Math.max(0, Math.abs(a - b) - JUMP_LIMIT);
    const cost = (m: number[]): number => {
      let c = 0;
      for (let i = 1; i < n; i++) if (connected(i)) c += excess(m[i - 1], m[i]);
      if (wraps) c += excess(m[n - 1], m[0]);
      if (options.prevNote !== undefined && opensNear) c += excess(options.prevNote, m[0]);
      if (options.nextNote !== undefined && endsNear)  c += excess(m[n - 1], options.nextNote);
      return c;
    };

    // 動かす範囲の候補：小節ごとに、ある音より前（小節の頭から）か、その音から後ろ（小節の終わりまで）
    const segments: [number, number][] = [];
    let barStart = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && barOf(i) === barOf(barStart)) continue;
      for (let k = barStart + 1; k < i; k++) segments.push([barStart, k], [k, i]);
      segments.push([barStart, i]);
      barStart = i;
    }

    let current = cost(midis);
    for (let round = 0; round < 16 && current > 0; round++) {
      let best: number[] | null = null;
      let bestCost = current, bestSize = Infinity;
      for (const [from, to] of segments) {
        for (const shift of [-12, 12]) {
          const moved = midis.map((m, i) => i >= from && i < to ? m + shift : m);
          if (moved.slice(from, to).some(m => m < lowMidi || m > highMidi)) continue;
          const c = cost(moved);
          if (c < bestCost || (c === bestCost && best && to - from < bestSize)) {
            best = moved; bestCost = c; bestSize = to - from;
          }
        }
      }
      if (!best || bestCost >= current) break;
      best.forEach((m, i) => { midis[i] = m; });
      current = bestCost;
    }
  }

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
