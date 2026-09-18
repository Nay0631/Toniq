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
}