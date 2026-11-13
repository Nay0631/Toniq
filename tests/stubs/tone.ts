// テスト用の Tone.js の代わり（vitest.config.ts で "tone" をこれに差し替える）。
// テストで使うのは Transport の時刻 → tick の変換（LoopArranger.ts の arrangementGate など）と、音名の変換（Frequency）だけ。
// BPM 120・PPQ 192 として、1 秒 = 2 拍 = 384 tick
export const transport = {
  PPQ: 192,
  bpm: 120,
  getTicksAtTime(time: number): number {
    return time * (this.bpm / 60) * this.PPQ;
  },
};

export function getTransport() {
  return transport;
}

// 音名・MIDI ノート番号の変換（BassPlayer.ts などが使う Tone.Frequency の一部：toMidi / toNote / transpose）
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

function noteToMidi(note: string): number {
  const m = /^([A-G][#b]?)(-?\d+)$/.exec(note);
  if (!m) throw new Error(`音名ではない: ${note}`);
  const name = FLATS[m[1]] ?? m[1];
  return NAMES.indexOf(name) + (Number(m[2]) + 1) * 12;
}

class FrequencyStub {
  constructor(private midi: number) {}
  toMidi(): number { return this.midi; }
  toNote(): string { return `${NAMES[((this.midi % 12) + 12) % 12]}${Math.floor(this.midi / 12) - 1}`; }
  transpose(semitones: number): FrequencyStub { return new FrequencyStub(this.midi + semitones); }
}

export function Frequency(value: string | number, unit?: string): FrequencyStub {
  if (typeof value === "number" && unit === "midi") return new FrequencyStub(value);
  if (typeof value === "string") return new FrequencyStub(noteToMidi(value));
  throw new Error(`テスト用の Frequency が扱えない値: ${value} ${unit ?? ""}`);
}
