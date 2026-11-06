import { Midi, Track } from "@tonejs/midi";
import { getState } from "./AppState";
import { MelodyNote } from "./MelodyGenerator";
import { arpNotes, arpParam } from "./ArpPlayer";
import { bassNotes } from "./BassPlayer";
import { chordEvents } from "./ChordPlayer";
import { padEvents } from "./PadPlayer";
import { blockDrumPattern } from "./DrumEngine";
import { getArrangement, findBlock } from "./LoopArranger";
import { swingAmount, SWING_MAX } from "./Groove";
import type { LayerName } from "./LayerManager";

// MIDI書き出し。今の曲（AppState）を再生と同じ内容で書き出す：
// - 長さは曲全体（AppState.bars 小節）。コード進行・メロディはその長さまでループする
// - アレンジ（ブロックのある小節だけ鳴らす）と パートの ON/OFF に従う。ドラムはブロックごとのパターンも反映する
// - ベースはジャンル別のパターン、コードはコードのリズム、アルペジオ・パッドは再生と同じボイシング
// - スウィングは発音位置に反映する（Tone.js の Transport と同じずらし方）
// シグネチャー・FX / SE は音色そのものが特徴のパートなので書き出さない。

// ===== 共通ユーティリティ =====
const NOTE_INDEX: Record<string, number> = {
  C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,
  F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,
  A:9,"A#":10,Bb:10,B:11,
};

// "C#4" → 61（Tone.js と同じく C4 = 60）
function noteToMidi(note: string): number {
  const m = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!m) return 60;
  return NOTE_INDEX[m[1]] + (parseInt(m[2]) + 1) * 12;
}

const DURATION_TO_BEATS: Record<string, number> = {
  "1n": 4, "2n": 2, "4n": 1, "8n": 0.5, "16n": 0.25, "32n": 0.125,
  "1n.": 6, "2n.": 3, "4n.": 1.5, "8n.": 0.75, "16n.": 0.375,
};

function timeStrToBeats(time: string): number {
  const [bar, beat, sixteenth] = time.split(":").map(Number);
  return (bar || 0) * 4 + (beat || 0) + (sixteenth || 0) * 0.25;
}

// 音価表記（"4n" など）か 小節:拍:16分 表記の長さを拍数に変換する
export function durationToBeats(duration: string): number {
  return DURATION_TO_BEATS[duration]
      ?? (duration.includes(":") ? timeStrToBeats(duration) : 1);
}

// General MIDI のドラムの音の番号（チャンネル 10）
const GM_DRUMS: Record<string, number> = {
  kick:         36,
  rim:          37,
  snare:        38,
  clap:         39,
  hihat_closed: 42,
  hihat_open:   46,
};

// パートごとのトラック名・チャンネル・GM の音色番号（0 始まり）
const TRACKS: Record<Exclude<LayerName, "signature" | "fx">, { name: string; channel: number; program: number }> = {
  melody: { name: "Melody",   channel: 0, program: 80 },  // Lead 1 (square)
  chord:  { name: "Chord",    channel: 1, program: 4  },  // Electric Piano 1
  pad:    { name: "Pad",      channel: 2, program: 89 },  // Pad 2 (warm)
  arp:    { name: "Arpeggio", channel: 3, program: 81 },  // Lead 2 (sawtooth)
  bass:   { name: "Bass",     channel: 4, program: 38 },  // Synth Bass 1
  drum:   { name: "Drums",    channel: 9, program: 0  },
};

// ===== MIDIエクスポート本体 =====
export function exportMidi(filename?: string): void {
  const s = getState();
  const progression = s.chordPattern;
  if (!progression) return;

  const midi = new Midi();
  midi.header.setTempo(s.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  midi.header.name = `Toniq ${s.genre} ${s.key}`;

  const ppq         = midi.header.ppq;  // デフォルト 480
  const totalBeats  = s.bars * 4;
  const loopBeats   = progression.length_bars * 4;
  const arrangement = getArrangement();
  // Tone.js の swing と同じ：8分音符の中の位置に応じて sin の形でずらす（裏の16分で最大 16分 × 2/3 × 量）
  const swing = (swingAmount() / 100) * SWING_MAX;

  const toTicks = (beats: number) => Math.round(beats * ppq);
  const swung = (beats: number): number => {
    const pos = beats % 0.5;
    if (swing <= 0 || pos < 1e-6) return beats;
    return beats + Math.sin((pos / 0.5) * Math.PI) * swing * (0.5 / 3);
  };

  // アレンジ上、その拍（曲の頭から）でパートが鳴るか
  const arranged = (part: LayerName, beats: number) =>
    s.parts[part] && findBlock(arrangement[part], Math.floor(beats / 4 + 1e-6)) !== undefined;

  // ループの頭からの位置で並んだ音を、曲の長さまで周回させて置く（鳴らない小節・曲の終わりより後は除く）
  function addLooped(
    track: Track, part: LayerName,
    notes: { beats: number; length: number; midi: number; velocity: number }[],
  ): void {
    for (let loop = 0; loop * loopBeats < totalBeats; loop++) {
      for (const n of notes) {
        const start = loop * loopBeats + n.beats;
        if (start >= totalBeats || !arranged(part, start)) continue;
        const length = Math.min(n.length, totalBeats - start);
        track.addNote({
          midi:          n.midi,
          ticks:         toTicks(swung(start)),
          durationTicks: Math.max(1, toTicks(length)),
          velocity:      n.velocity,
        });
      }
    }
  }

  function addTrack(part: keyof typeof TRACKS): Track | null {
    if (!s.parts[part] || arrangement[part].length === 0) return null;
    const def   = TRACKS[part];
    const track = midi.addTrack();
    track.name           = def.name;
    track.channel        = def.channel;
    track.instrument.number = def.program;
    return track;
  }

  const key = s.key;

  // ===== メロディ =====
  const melTrack = addTrack("melody");
  if (melTrack) {
    addLooped(melTrack, "melody", s.melodyNotes
      .filter((n): n is MelodyNote & { note: string } => !!n.note)
      .map(n => {
        const beats = timeStrToBeats(n.time);
        // 強拍ほど強く（MelodyPlayer と同じ：小節頭 > 拍頭 > それ以外）
        const velocity = beats % 4 === 0 ? 0.95 : beats % 1 === 0 ? 0.85 : 0.72;
        return { beats, length: durationToBeats(n.duration), midi: noteToMidi(n.note), velocity };
      }));
  }

  // ===== コード（コードのリズムとボイシングは ChordPlayer と共通） =====
  const chordTrack = addTrack("chord");
  if (chordTrack) {
    addLooped(chordTrack, "chord", chordEvents(progression, key).flatMap(h =>
      h.notes.map(note => ({ beats: h.sixteenth / 4, length: h.length / 4, midi: noteToMidi(note), velocity: h.velocity }))));
  }

  // ===== パッド（開離配置。PadPlayer と共通） =====
  const padTrack = addTrack("pad");
  if (padTrack) {
    addLooped(padTrack, "pad", padEvents(progression, key).flatMap(h =>
      h.notes.map(note => ({ beats: h.sixteenth / 4, length: h.length / 4, midi: noteToMidi(note), velocity: 0.7 }))));
  }

  // ===== アルペジオ（ジャンル別の刻み・パターン・音の長さ。ArpPlayer と共通） =====
  const arpTrack = addTrack("arp");
  if (arpTrack) {
    const param  = arpParam();
    const length = DURATION_TO_BEATS[param.step] * param.gate;
    addLooped(arpTrack, "arp", arpNotes(progression, key, param).map(n =>
      ({ beats: n.sixteenth / 4, length, midi: noteToMidi(n.note), velocity: n.velocity })));
  }

  // ===== ベース（ジャンル別のパターン。BassPlayer と共通。基準オクターブは再生と同じ 2） =====
  const bassTrack = addTrack("bass");
  if (bassTrack) {
    addLooped(bassTrack, "bass", bassNotes(progression, key, 2).map(n =>
      ({ beats: n.sixteenth / 4, length: n.length / 4, midi: noteToMidi(n.note), velocity: 0.8 })));
  }

  // ===== ドラム（16分ごとに、その小節のブロックのパターンで鳴らす。DrumEngine と同じ選び方） =====
  const drumTrack = addTrack("drum");
  if (drumTrack) {
    for (let step = 0; step < s.bars * 16; step++) {
      const bar   = Math.floor(step / 16);
      const block = findBlock(arrangement.drum, bar);
      if (!block) continue;
      const pattern = blockDrumPattern(block);
      if (!pattern) continue;
      const i = step % pattern.steps;
      for (const [name, track] of Object.entries(pattern.tracks)) {
        if (!track.pattern[i] || GM_DRUMS[name] === undefined) continue;
        drumTrack.addNote({
          midi:          GM_DRUMS[name],
          ticks:         toTicks(swung(step / 4)),
          durationTicks: toTicks(0.25),
          velocity:      track.velocity?.[i] ?? 1,
        });
      }
    }
  }

  // ===== ダウンロード =====
  const name   = filename ?? `toniq_${s.genre}_${s.key}.mid`;
  const bytes  = midi.toArray();
  const blob   = new Blob([new Uint8Array(bytes)], { type: "audio/midi" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = name;
  a.click();
  URL.revokeObjectURL(url);

  console.log("MIDIエクスポート完了:", name);
}
