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

export function resolveTempoPreset(
  genre: string,
  preset: "ゆっくり" | "普通" | "速い"
): number {
  const presets = tempoPresets as Record<string, Record<string, number>>;
  return presets[genre]?.[preset] ?? 128;
}