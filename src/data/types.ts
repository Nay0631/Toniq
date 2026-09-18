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