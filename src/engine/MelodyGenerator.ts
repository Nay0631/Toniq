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

// ===== スケール音一覧をMIDIで取得 =====
const SCALE_SEMITONES: Record<string, number[]> = {
  major:    [0, 2, 4, 5, 7, 9, 11],
  minor:    [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian:   [0, 2, 3, 5, 7, 9, 10],
};

const NOTE_INDEX: Record<string, number> = {
  C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,
  F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,
  A:9,"A#":10,Bb:10,B:11,
};

function getScaleNotes(
  key: string,
  scale: string,
  octaveMin: number,
  octaveMax: number
): number[] {
  const root      = NOTE_INDEX[key] ?? 0;
  const semitones = SCALE_SEMITONES[scale] ?? SCALE_SEMITONES.minor;
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

// ===== 次の音を選ぶ =====
function pickNextNote(
  prev:       number | null,
  scaleNotes: number[],
  chordMidi:  number[],
  param:      MelodyParam,
  isDownbeat: boolean
): number {
  // ダウンビート（小節の1拍目）はコード構成音に着地
  if (isDownbeat && chordMidi.length > 0) {
    const candidates = scaleNotes.filter(n => chordMidi.includes(n % 12));
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  if (prev === null) {
    return scaleNotes[Math.floor(Math.random() * scaleNotes.length)];
  }

  // 跳躍幅・順次進行の優先度を適用してフィルタリング
  let candidates = scaleNotes.filter(n => {
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
  const scaleNotes = getScaleNotes(key, progression.base_scale, param.octaveRange[0], param.octaveRange[1]);

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

  while (currentTime < totalUnits) {
    // 休符判定
    if (Math.random() < param.restProbability) {
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
    const midi      = pickNextNote(prevMidi, scaleNotes, chordMidi, param, isDownbeat);
    const bar       = Math.floor(currentTime / 16);
    const beat      = Math.floor((currentTime % 16) / 4);
    const tick      = (currentTime % 4);

    notes.push({
      note:     midiToNote(midi),
      duration: dur,
      time:     `${bar}:${beat}:${tick}`,
    });

    prevMidi     = midi;
    currentTime += Math.min(units, totalUnits - currentTime);
  }

  return notes;
}