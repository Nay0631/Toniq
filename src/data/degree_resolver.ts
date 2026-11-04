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

const SCALE_INTERVALS: Record<string, Record<string, number>> = {
  major:    { I:0, II:2, III:4, IV:5, V:7, VI:9, VII:11, IIm:2, IIIm:4, VIm:9 },
  minor:    { I:0, II:2, bIII:3, IV:5, V:7, bVI:8, bVII:10, Im:0, IVm:5, Vm:7, IIm:2 },
  phrygian: { I:0, bII:1, bIII:3, IV:5, V:7, bVI:8, bVII:10 },
  dorian:   { I:0, II:2, bIII:3, IV:5, V:7, VI:9, bVII:10 },
};

// ===== メロディ用のスケール音の役割（スケールを追加するときは SCALE_INTERVALS とそろえる） =====
// core:   ペンタトニックの5音。メロディは基本的にこの5音で作る
// accent: 残りの2音 → 解決先（どちらも主音からの半音数）。
//         弱拍で経過音・刺繍音として使い、次の音で解決先へ順次進行する
export interface ScaleTones {
  core:   number[];
  accent: Record<number, number[]>;
}

export const SCALE_TONES: Record<string, ScaleTones> = {
  major:    { core: [0, 2, 4, 7, 9],  accent: { 5: [4],     11: [0] } },
  minor:    { core: [0, 3, 5, 7, 10], accent: { 2: [0, 3],  8:  [7] } },
  phrygian: { core: [0, 3, 5, 7, 10], accent: { 1: [0],     8:  [7] } },
  dorian:   { core: [0, 3, 5, 7, 10], accent: { 9: [7, 10], 2:  [0, 3] } },
};

const CHORD_INTERVALS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim:   [0, 3, 6],
  aug:   [0, 4, 8],
  maj7:  [0, 4, 7, 11],
  min7:  [0, 3, 7, 10],
  dom7:  [0, 4, 7, 10],
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

  let notes = chordIntervals.map((interval) => {
    const noteIndex = (chordRootIndex + interval) % 12;
    const noteName = NOTE_NAMES[noteIndex];
    const noteOctave = (chordRootIndex + interval) >= 12 ? octave + 1 : octave;
    return `${noteName}${noteOctave}`;
  });

  if (inversion > 0) {
    for (let i = 0; i < inversion; i++) {
      const bottom = notes.shift()!;
      const noteName = bottom.slice(0, -1);
      const oct = parseInt(bottom.slice(-1));
      notes.push(`${noteName}${oct + 1}`);
    }
  }

  const bass_note = `${root}${octave - 1}`;
  return { root, type, notes, bass_note, degree };
}