import { ChordProgression } from "./types";

export const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1,
  D: 2, "D#": 3, Eb: 3,
  E: 4,
  F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8,
  A: 9, "A#": 10, Bb: 10,
  B: 11,
};

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// キーを半音 semitones だけずらしたキー（転調。"A" を 2 なら "B"）
export function shiftKey(key: string, semitones: number): string {
  if (!semitones) return key;
  const index = NOTE_INDEX[key];
  if (index === undefined) return key;
  return NOTE_NAMES[((index + semitones) % 12 + 12) % 12];
}

// コードを鳴らすキー（曲全体の並びで転調している所のコードは keyShift だけずらす）
export function chordKey(key: string, chord: { keyShift?: number }): string {
  return shiftKey(key, chord.keyShift ?? 0);
}

const SCALE_INTERVALS: Record<string, Record<string, number>> = {
  major:    { I:0, II:2, III:4, IV:5, V:7, VI:9, VII:11, IIm:2, IIIm:4, VIm:9 },
  minor:    { I:0, II:2, bIII:3, IV:5, V:7, bVI:8, bVII:10, Im:0, IVm:5, Vm:7, IIm:2 },
  phrygian: { I:0, bII:1, bIII:3, IV:5, V:7, bVI:8, bVII:10 },
  dorian:   { I:0, II:2, bIII:3, IV:5, V:7, VI:9, bVII:10 },
  // ハーモニックマイナー：ナチュラルマイナー（minor）の7度を半音上げる（V が長三和音になり、主音へ強く戻る）
  harmonic_minor: { I:0, II:2, bIII:3, IV:5, V:7, bVI:8, VII:11, Im:0, IVm:5 },
  // メロディックマイナー：ナチュラルマイナーの6度・7度を半音上げる（IV・V が長三和音）
  melodic_minor:  { I:0, II:2, bIII:3, IV:5, V:7, VI:9, VII:11, Im:0, IIm:2 },
  // ミクソリディアン：メジャーの7度を半音下げる（bVII の長三和音が特徴）
  mixolydian:     { I:0, II:2, III:4, IV:5, V:7, VI:9, bVII:10, IIm:2, Vm:7, VIm:9 },
  // リディアン：メジャーの4度を半音上げる（II が長三和音になり、浮遊感が出る）
  lydian:         { I:0, II:2, III:4, "#IV":6, V:7, VI:9, VII:11, IIIm:4, VIm:9, VIIm:11 },
  // メジャーペンタトニック（5音）。コードの根音はメジャーと同じ。メロディは5音だけで作る
  major_pentatonic: { I:0, II:2, III:4, IV:5, V:7, VI:9, VII:11, IIm:2, IIIm:4, VIm:9 },
  // 全音音階（6音。どの音の間も全音）。コードは増三和音（aug / aug7）
  whole_tone:     { I:0, II:2, III:4, "#IV":6, "#V":8, bVII:10 },
};

// ===== メロディ用のスケール音の役割（スケールを追加するときは SCALE_INTERVALS とそろえる） =====
// core:   基本の5音。メロディは基本的にこの5音で作る。
//         メジャー系（major / mixolydian）はスケールの 1・2・3・5・6 番目（メジャーペンタトニックの形）、
//         マイナー系はスケールの 1・3・4・5・7 番目（マイナーペンタトニックの形）
// accent: 残りの2音 → 次に進む先（どちらも主音からの半音数）。メロディは1小節に数回この音で外す。
//         メジャー系は 4・7 番目、マイナー系は 2・6 番目。外した音の次は進む先へ順次進行する
export interface ScaleTones {
  core:   number[];
  accent: Record<number, number[]>;
}

export const SCALE_TONES: Record<string, ScaleTones> = {
  major:    { core: [0, 2, 4, 7, 9],  accent: { 5: [4],     11: [0] } },
  minor:    { core: [0, 3, 5, 7, 10], accent: { 2: [0, 3],  8:  [7] } },
  phrygian: { core: [0, 3, 5, 7, 10], accent: { 1: [0],     8:  [7] } },
  dorian:   { core: [0, 3, 5, 7, 10], accent: { 9: [7, 10], 2:  [0, 3] } },
  harmonic_minor: { core: [0, 3, 5, 7, 11], accent: { 2: [0, 3], 8: [7, 11] } },
  melodic_minor:  { core: [0, 3, 5, 7, 11], accent: { 2: [0, 3], 9: [7, 11] } },
  mixolydian:     { core: [0, 2, 4, 7, 9],  accent: { 5: [4, 7], 10: [9, 0] } },
  lydian:         { core: [0, 2, 4, 7, 9],  accent: { 6: [7, 4], 11: [0, 9] } },
  // 5音・6音のスケールは外す音がない（スケールの音だけで作る）
  major_pentatonic: { core: [0, 2, 4, 7, 9], accent: {} },
  whole_tone:     { core: [0, 2, 4, 6, 8, 10], accent: {} },
};

// スケールの音（主音からの半音数、低い順。ふつうは7音、ペンタトニックは5音・全音音階は6音）。SCALE_TONES の core＋accent から作る。未定義なら minor
export function scaleSemitones(scale: string): number[] {
  const tones = SCALE_TONES[scale] ?? SCALE_TONES.minor;
  return [...tones.core, ...Object.keys(tones.accent).map(Number)].sort((a, b) => a - b);
}

const CHORD_INTERVALS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim:   [0, 3, 6],
  aug:   [0, 4, 8],
  maj7:  [0, 4, 7, 11],
  min7:  [0, 3, 7, 10],
  dom7:  [0, 4, 7, 10],
  // 9th（ローファイのメジャーなど）・sus・add9（メジャーペンタトニック）・aug7（全音音階）
  maj9:  [0, 4, 7, 11, 14],
  min9:  [0, 3, 7, 10, 14],
  dom9:  [0, 4, 7, 10, 14],
  add9:  [0, 4, 7, 14],
  sus2:  [0, 2, 7],
  sus4:  [0, 5, 7],
  aug7:  [0, 4, 8, 10],
};

export interface ResolvedChord {
  root:      string;
  type:      string;
  notes:     string[];
  bass_note: string;
  degree:    string;
}

function parseDegree(degree: string, scale: string): number {
  const degreeKey = degree.replace(/m$/, "");
  const intervals = SCALE_INTERVALS[scale];
  if (!intervals) throw new Error(`Unknown scale: ${scale}`);
  const semitones = intervals[degreeKey] ?? intervals[degree];
  if (semitones === undefined) throw new Error(`Unknown degree: ${degree} in scale: ${scale}`);
  return semitones;
}

export function resolveChord(
  degree: string,
  type: string,
  inversion: number,
  key: string,
  scale: string,
  octave: number = 4
): ResolvedChord {
  const rootIndex = NOTE_INDEX[key];
  if (rootIndex === undefined) throw new Error(`Unknown key: ${key}`);

  const degreeOffset = parseDegree(degree, scale);
  const chordRootIndex = (rootIndex + degreeOffset) % 12;
  const root = NOTE_NAMES[chordRootIndex];

  const chordIntervals = CHORD_INTERVALS[type];
  if (!chordIntervals) throw new Error(`Unknown chord type: ${type}`);

  const notes = chordIntervals.map((interval) => {
    const noteIndex = (chordRootIndex + interval) % 12;
    const noteName = NOTE_NAMES[noteIndex];
    const noteOctave = octave + Math.floor((chordRootIndex + interval) / 12);
    return `${noteName}${noteOctave}`;
  });

  if (inversion > 0) {
    for (let i = 0; i < inversion; i++) {
      const bottom = notes.shift()!;
      const noteName = bottom.slice(0, -1);
      const oct = parseInt(bottom.slice(-1), 10);
      notes.push(`${noteName}${oct + 1}`);
    }
  }

  const bass_note = `${root}${octave - 1}`;
  return { root, type, notes, bass_note, degree };
}
// ===== ボイシング（コード・パッド・アルペジオの音の積み方） =====
// 実音は resolveChord で求め、ここでは並べ方（転回形とオクターブ）だけを決める

export function noteToMidi(note: string): number {
  const m = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!m) throw new Error(`Unknown note: ${note}`);
  return NOTE_INDEX[m[1]] + (parseInt(m[2], 10) + 1) * 12;
}

export function midiToNote(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// 最低音を置く範囲（MIDI ノート番号、両端を含む）。幅を12以上にして、どの転回形も必ず1つ収まるようにする
export interface VoicingRange { low: number; high: number }

export const VOICING_RANGES = {
  chord: { low: 55, high: 66 },  // G3〜F#4：メロディ（4〜5オクターブ）の下で密集配置
  pad:   { low: 52, high: 63 },  // E3〜D#4：開離配置にして上に広げる
  arp:   { low: 67, high: 78 },  // G4〜F#5
  arpWide: { low: 60, high: 71 }, // C4〜B4：2オクターブのアルペジオ（上に1オクターブ足す）
} satisfies Record<string, VoicingRange>;

// 転回形ごとに、最低音が範囲に入るオクターブへ移した候補を作る
function voicingCandidates(notes: number[], range: VoicingRange): { notes: number[]; inversion: number }[] {
  const base = [...notes].sort((a, b) => a - b);
  const out: { notes: number[]; inversion: number }[] = [];
  for (let inv = 0; inv < base.length; inv++) {
    // 9th など1オクターブを超えるコードは、上げた音が上の音を追い越すことがあるので並べ直す
    const rotated = [...base.slice(inv), ...base.slice(0, inv).map((n) => n + 12)].sort((a, b) => a - b);
    const shift = Math.ceil((range.low - rotated[0]) / 12) * 12;
    const v = rotated.map((n) => n + shift);
    if (v[0] <= range.high) out.push({ notes: v, inversion: inv });
  }
  return out;
}

// 前のコードからの動きの大きさ（各音から一番近い音までの距離の合計を両方向で）
function movement(a: number[], b: number[]): number {
  const nearest = (from: number[], to: number[]) =>
    from.reduce((sum, n) => sum + Math.min(...to.map((m) => Math.abs(n - m))), 0);
  return nearest(a, b) + nearest(b, a);
}

// 開離配置：下から2番目の音を1オクターブ上げる
function spreadVoicing(notes: number[]): number[] {
  if (notes.length < 3) return notes;
  const v = [...notes];
  v[1] += 12;
  return v.sort((a, b) => a - b);
}

// コード進行の各コードを、前のコードから一番近い転回形で並べる（ボイスリーディング）。
// 進行に書かれた inversion は動きが同じくらいなら優先する。ループの継ぎ目もなめらかになるよう、
// 1周目の最後のコードを起点にもう1周決め直す。戻り値は progression.progression と同じ並びの音名
export function voiceProgression(
  progression: ChordProgression,
  key: string,
  range: VoicingRange,
  options: { spread?: boolean } = {}
): string[][] {
  const chords = progression.progression.map((c) => ({
    notes:     resolveChord(c.degree, c.type, 0, chordKey(key, c), progression.base_scale, 4).notes.map(noteToMidi),
    inversion: c.inversion,
  }));

  const pick = (prev: number[] | null, chord: { notes: number[]; inversion: number }) => {
    const candidates = voicingCandidates(chord.notes, range);
    let best = candidates[0];
    let bestCost = Infinity;
    for (const c of candidates) {
      const preferred = c.inversion === chord.inversion % chord.notes.length ? 0 : 2;
      const cost = (prev ? movement(prev, c.notes) : 0) + preferred;
      if (cost < bestCost) { best = c; bestCost = cost; }
    }
    return best.notes;
  };

  let prev: number[] | null = null;
  let voiced: number[][] = [];
  for (let pass = 0; pass < 2; pass++) {
    voiced = chords.map((c) => (prev = pick(prev, c)));
  }

  return voiced.map((v) => (options.spread ? spreadVoicing(v) : v).map(midiToNote));
}
