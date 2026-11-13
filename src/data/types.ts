export interface DrumTrack {
  pattern:  number[];
  velocity: number[];
  note:     string;
}

export interface DrumPattern {
  id:        string;
  name:      string;
  genre:     string[];
  mood:      string[];
  bpm_range: { min: number; max: number };
  steps:     number;
  step_unit: string;
  tracks:    Record<string, DrumTrack>;
  notes?:    string;  
}

export interface ChordDegree {
  bar:          number;
  degree:       string;
  type:         string;
  inversion:    number;
  duration_bars: number;
  // 曲全体の並び（SongForm.songProgression）でだけ付く印
  ending?:  boolean;      // 曲の終わり（エンディング）の主和音
  section?: "A" | "B";    // どのセクション（Aメロ／サビ）のコードか
  keyShift?: number;      // 転調（半音。曲のキーからずらす量。AppState.modulation）
}

export interface ChordProgression {
  id:          string;
  name:        string;
  mood:        string[];
  genre:       string[];
  bpm_range:   { min: number; max: number };
  base_scale:  string;
  length_bars: number;
  progression: ChordDegree[];
  chord_rhythm: { pattern: string; description: string };
  notes?:      string;
  // 曲全体の並び（SongForm.songProgression）でだけ付く：元のコード進行1周の長さ（小節）。
  // ベースのフィルなど「1周の最後の小節」を求めるのに使う
  section_bars?: number;
}
// ピアノロールで作ったオリジナルのドラムパターンの ID（drum_patterns.json にはない。AppState.drumPattern に丸ごと持つ）
export const CUSTOM_DRUM_ID = "custom";
