import easyTable from "../data/easy_mode_table.json";
import chordDB   from "../data/chord_progressions.json";
import drumDB    from "../data/drum_patterns.json";
import { ChordProgression, DrumPattern } from "../data/types";
import tempoPresets from "../data/tempo_presets.json";

interface SimpleModeResult {
  bpm:          number;
  chordPattern: ChordProgression;
  drumPattern:  DrumPattern;
  genre:        string;
  mood:         string;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function resolveSimpleMode(
  genre: string,
  mood:  string
): SimpleModeResult {
  const table = easyTable as Record<string, Record<string, {
    bpm:       number;
    chord_ids: string[];
    drum_ids:  string[];
  }>>;

  // ジャンル・雰囲気が見つからない場合はデフォルト値を使用
  const genreTable = table[genre] ?? table["ローファイ"];
  const entry      = genreTable[mood] ?? genreTable["落ち着いた"];

  // IDをランダムに1つ選択
  const chordId = pickRandom(entry.chord_ids);
  const drumId  = pickRandom(entry.drum_ids);

  // DBから該当パターンを取得
  const chords = chordDB as unknown as ChordProgression[];
  const drums  = drumDB  as unknown as DrumPattern[];

  const chordPattern = chords.find(c => c.id === chordId) ?? chords[0];
  const drumPattern  = drums.find(d  => d.id === drumId)  ?? drums[0];

  return {
    bpm: entry.bpm,
    chordPattern,
    drumPattern,
    genre,
    mood,
  };
}

// ジャンル・雰囲気に合う候補：シンプルモード表の候補＋DBで同じジャンル・雰囲気のタグを持つもの
function matchedPatterns<T extends { id: string; genre: string[]; mood: string[] }>(
  db: T[], tableIds: string[], genre: string, mood: string
): T[] {
  return db.filter(p =>
    tableIds.includes(p.id) || (p.genre.includes(genre) && p.mood.includes(mood)));
}

// 再抽選の候補：合う候補のうち現在のもの以外
function rerollCandidates<T extends { id: string; genre: string[]; mood: string[] }>(
  db: T[], tableIds: string[], genre: string, mood: string, currentId: string | undefined
): T[] {
  const matched = matchedPatterns(db, tableIds, genre, mood);
  const others = matched.filter(p => p.id !== currentId);
  return others.length > 0 ? others : matched;
}

function lookupEntry(genre: string, mood: string) {
  const table = easyTable as Record<string, Record<string, { chord_ids: string[]; drum_ids: string[] }>>;
  const genreTable = table[genre] ?? table["ローファイ"];
  return genreTable[mood] ?? genreTable["落ち着いた"];
}

// 現在とは別のコード進行を選ぶ
export function rerollChord(genre: string, mood: string, currentId?: string): ChordProgression {
  const chords = chordDB as unknown as ChordProgression[];
  const candidates = rerollCandidates(chords, lookupEntry(genre, mood).chord_ids, genre, mood, currentId);
  return pickRandom(candidates);
}

// 現在とは別のドラムパターンを選ぶ
export function rerollDrum(genre: string, mood: string, currentId?: string): DrumPattern {
  const drums = drumDB as unknown as DrumPattern[];
  const candidates = rerollCandidates(drums, lookupEntry(genre, mood).drum_ids, genre, mood, currentId);
  return pickRandom(candidates);
}

export function resolveTempoPreset(
  genre: string,
  preset: "ゆっくり" | "普通" | "速い"
): number {
  const presets = tempoPresets as Record<string, Record<string, number>>;
  return presets[genre]?.[preset] ?? 128;
}
// ===== サビ（セクション B）の進行 =====

// ジャンル・雰囲気の合い方（ジャンルが合う = 2、雰囲気が合う = 1）
function matchScore(c: ChordProgression, genre: string, mood: string): number {
  return (c.genre.includes(genre) ? 2 : 0) + (c.mood.includes(mood) ? 1 : 0);
}

// サビに使える進行：Aメロの進行と同じ長さ・スケールの別の進行（ジャンル・雰囲気が合うものを先に並べる）
export function chorusCandidates(base: ChordProgression, genre: string, mood: string): ChordProgression[] {
  const chords = chordDB as unknown as ChordProgression[];
  return chords
    .filter(c => c.id !== base.id && c.length_bars === base.length_bars && c.base_scale === base.base_scale)
    .sort((a, b) => matchScore(b, genre, mood) - matchScore(a, genre, mood));
}

// サビの進行を自動で選ぶ（いちばん合う候補の中からランダム。currentId 以外を優先。なければ null = Aメロと同じ進行）
export function pickChorus(base: ChordProgression, genre: string, mood: string, currentId?: string): ChordProgression | null {
  const candidates = chorusCandidates(base, genre, mood);
  if (candidates.length === 0) return null;
  const others = candidates.filter(c => c.id !== currentId);
  const pool   = others.length > 0 ? others : candidates;
  const best   = Math.max(...pool.map(c => matchScore(c, genre, mood)));
  return pickRandom(pool.filter(c => matchScore(c, genre, mood) === best));
}
