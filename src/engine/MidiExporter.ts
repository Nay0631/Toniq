import { Midi } from "@tonejs/midi";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { MelodyNote } from "./MelodyGenerator";

// ===== 共通ユーティリティ =====
const NOTE_ORDER = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const NOTE_INDEX: Record<string, number> = {
  C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,
  F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,
  A:9,"A#":10,Bb:10,B:11,
};

function noteToMidi(note: string): number {
  const name   = note.slice(0, -1);
  const octave = parseInt(note.slice(-1));
  return NOTE_INDEX[name] + (octave + 1) * 12;
}

const DURATION_TO_BEATS: Record<string, number> = {
  "1n": 4, "2n": 2, "4n": 1, "8n": 0.5, "16n": 0.25,
};

function timeStrToBeats(time: string): number {
  const [bar, beat, tick] = time.split(":").map(Number);
  return bar * 4 + beat + (tick ?? 0) * 0.25;
}

// ===== MIDIエクスポート本体 =====
export function exportMidi(
  progression: ChordProgression,
  melodyNotes: MelodyNote[],
  key:         string = "A",
  bpm:         number = 128,
  filename:    string = "toniq_export.mid"
): void {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });

  const ticksPerBeat = midi.header.ppq; // デフォルト 480

  function beatsToTicks(beats: number): number {
    return Math.round(beats * ticksPerBeat);
  }

  // ===== Track 1: メロディ =====
  const melTrack = midi.addTrack();
  melTrack.name = "Melody";
  melodyNotes.forEach(n => {
    if (!n.note) return;
    const startBeats = timeStrToBeats(n.time);
    const durBeats   = DURATION_TO_BEATS[n.duration] ?? 1;
    melTrack.addNote({
      midi:     noteToMidi(n.note),
      ticks:    beatsToTicks(startBeats),
      durationTicks: beatsToTicks(durBeats),
      velocity: 0.75,
    });
  });

  // ===== Track 2: コード =====
  const chordTrack = midi.addTrack();
  chordTrack.name = "Chord";
  progression.progression.forEach(chord => {
    const resolved = resolveChord(
      chord.degree, chord.type, chord.inversion,
      key, progression.base_scale, 4
    );
    const startBeats = (chord.bar - 1) * 4;
    const durBeats   = chord.duration_bars * 4;
    resolved.notes.forEach(note => {
      chordTrack.addNote({
        midi:     noteToMidi(note),
        ticks:    beatsToTicks(startBeats),
        durationTicks: beatsToTicks(durBeats),
        velocity: 0.65,
      });
    });
  });

  // ===== Track 3: ベース =====
  const bassTrack = midi.addTrack();
  bassTrack.name = "Bass";
  progression.progression.forEach(chord => {
    const resolved = resolveChord(
      chord.degree, chord.type, 0,
      key, progression.base_scale, 2
    );
    const startBeats = (chord.bar - 1) * 4;
    const durBeats   = chord.duration_bars * 4;
    bassTrack.addNote({
      midi:     noteToMidi(resolved.bass_note),
      ticks:    beatsToTicks(startBeats),
      durationTicks: beatsToTicks(durBeats),
      velocity: 0.8,
    });
  });

  // ===== Track 4: アルペジオ =====
  const arpTrack = midi.addTrack();
  arpTrack.name = "Arpeggio";
  const stepUnit    = "8n";
  const durBeatsArp = DURATION_TO_BEATS[stepUnit];

  progression.progression.forEach(chord => {
    const resolved = resolveChord(
      chord.degree, chord.type, chord.inversion,
      key, progression.base_scale, 5
    );
    const notes      = resolved.notes;
    const barStart   = (chord.bar - 1) * 4;
    const totalSteps = chord.duration_bars * 8; // 8分音符単位

    for (let i = 0; i < totalSteps; i++) {
      const note       = notes[i % notes.length];
      const startBeats = barStart + i * durBeatsArp;
      arpTrack.addNote({
        midi:     noteToMidi(note),
        ticks:    beatsToTicks(startBeats),
        durationTicks: beatsToTicks(durBeatsArp * 0.9),
        velocity: 0.6,
      });
    }
  });

  // ===== ダウンロード =====
  const bytes  = midi.toArray();
  const blob   = new Blob([new Uint8Array(bytes)], { type: "audio/midi" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = filename;
  a.click();
  URL.revokeObjectURL(url);

  console.log("MIDIエクスポート完了:", filename);
}