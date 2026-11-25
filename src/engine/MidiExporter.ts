import { Midi, Track } from "@tonejs/midi";
import { getState } from "./AppState";
import { MelodyNote } from "./MelodyGenerator";
import { arpNotes, arpParam } from "./ArpPlayer";
import { bassNotes, bassVelocity } from "./BassPlayer";
import { chordEvents } from "./ChordPlayer";
import { padEvents } from "./PadPlayer";
import { counterNotes } from "./CounterPlayer";
import { percStepHits } from "./PercPlayer";
import { blockDrumPattern, drumStepHits } from "./DrumEngine";
import { songMelody, songProgression } from "./SongForm";
import { getArrangement, findBlock, withArrangement } from "./LoopArranger";
import { swungBeats } from "./Groove";
import type { LayerName } from "./LayerManager";
import { saveOutput } from "./OutputFiles";
import { beatsPerBar, durationToBeats, timeToBeats, unitsPerBar, unitsPerBeat } from "./Meter";

// MIDI書き出し。今の曲（AppState）を再生と同じ内容で書き出す：
// - 長さは曲全体（AppState.bars 小節）。コード進行・メロディは曲全体の並び（セクションごとの進行・エンディング）で書き出す
// - アレンジ（ブロックのある小節だけ鳴らす）と パートの ON/OFF に従う。ドラムはブロックごとのパターンも反映する
// - ベースはジャンル別のパターン、コードはコードのリズム、アルペジオ・パッドは再生と同じボイシング
// - スウィングは発音位置に反映する（Tone.js の Transport と同じずらし方）
// - カウンターメロディ（CounterPlayer と同じ音）、パーカッション（ドラムと同じチャンネル 10 の別トラック）も書き出す
// シグネチャー・FX / SE は音色そのものが特徴のパートなので書き出さない。サブベースはベースと同じ音なので書き出さない。

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
  return NOTE_INDEX[m[1]] + (parseInt(m[2], 10) + 1) * 12;
}

// 位置（小節:拍:16分）・長さ（"4n" など）と拍の変換は拍子で変わるので Meter.ts に置く
export { durationToBeats };

// General MIDI のドラムの音の番号（チャンネル 10）
const GM_DRUMS: Record<string, number> = {
  kick:         36,
  rim:          37,
  snare:        38,
  clap:         39,
  hihat_closed: 42,
  hihat_open:   46,
  // パーカッション（PercPlayer.ts）
  ride:         51,
  tambourine:   54,
  conga_high:   63,
  conga_low:    64,
  shaker:       70,  // Maracas
};

// パートごとのトラック名・チャンネル・GM の音色番号（0 始まり）
const TRACKS: Record<Exclude<LayerName, "signature" | "fx">, { name: string; channel: number; program: number }> = {
  melody: { name: "Melody",   channel: 0, program: 80 },  // Lead 1 (square)
  chord:  { name: "Chord",    channel: 1, program: 4  },  // Electric Piano 1
  pad:    { name: "Pad",      channel: 2, program: 89 },  // Pad 2 (warm)
  arp:    { name: "Arpeggio", channel: 3, program: 81 },  // Lead 2 (sawtooth)
  bass:   { name: "Bass",     channel: 4, program: 38 },  // Synth Bass 1
  counter: { name: "Counter Melody", channel: 5, program: 11 },  // Vibraphone
  drum:   { name: "Drums",    channel: 9, program: 0  },
  perc:   { name: "Percussion", channel: 9, program: 0 },
};

// ===== MIDIエクスポート本体 =====
export async function exportMidi(filename?: string): Promise<void> {
  // コード進行・ドラムの試聴中はアレンジを通していないので、通した内容で作る（試聴は鳴らしたまま）
  const midi = withArrangement(buildMidi);
  if (!midi) return;

  // 保存（Electron は output/midi フォルダ、ブラウザはダウンロード）
  const s = getState();
  const name   = filename ?? `toniq_${s.genre}_${s.key}.mid`;
  const bytes  = midi.toArray();
  const blob   = new Blob([new Uint8Array(bytes)], { type: "audio/midi" });
  await saveOutput("midi", blob, name);

  console.log("MIDIエクスポート完了:", name);
}

// 今の曲の MIDI（曲がなければ null）
function buildMidi(): Midi | null {
  const s = getState();
  const progression = songProgression();  // 曲全体の並び（再生と同じ）
  if (!progression) return null;

  const midi = new Midi();
  midi.header.setTempo(s.bpm);
  // 各パートの位置はマスの数（4/4・3/4 は16分音符、3連符は8分3連符）。拍子（1小節の拍の数）とあわせて Meter.ts
  const BEATS = beatsPerBar();   // 1小節の拍の数
  const BAR   = unitsPerBar();   // 1小節のマスの数
  const UNIT  = unitsPerBeat();  // 1拍のマスの数
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [BEATS, 4] });
  midi.header.name = `Toniq ${s.genre} ${s.key}`;

  const ppq         = midi.header.ppq;  // デフォルト 480
  const totalBeats  = s.bars * BEATS;
  const loopBeats   = progression.length_bars * BEATS;
  const arrangement = getArrangement();
  // Tone.js の swing と同じずらし方（Groove.ts の swungBeats。シャッフルなら8分音符の裏）
  const swung = swungBeats;
  const toTicks = (beats: number) => Math.round(beats * ppq);

  // アレンジ上、その拍（曲の頭から）でパートが鳴るか
  const arranged = (part: LayerName, beats: number) =>
    s.parts[part] && findBlock(arrangement[part], Math.floor(beats / BEATS + 1e-6)) !== undefined;

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
    addLooped(melTrack, "melody", songMelody()
      .filter((n): n is MelodyNote & { note: string } => !!n.note)
      .map(n => {
        const beats = timeToBeats(n.time);
        // 強拍ほど強く（MelodyPlayer と同じ：小節頭 > 拍頭 > それ以外）
        const velocity = beats % BEATS === 0 ? 0.95 : beats % 1 === 0 ? 0.85 : 0.72;
        return { beats, length: durationToBeats(n.duration), midi: noteToMidi(n.note), velocity };
      }));
  }

  // ===== コード（コードのリズムとボイシングは ChordPlayer と共通） =====
  const chordTrack = addTrack("chord");
  if (chordTrack) {
    addLooped(chordTrack, "chord", chordEvents(progression, key).flatMap(h =>
      h.notes.map(note => ({ beats: h.sixteenth / UNIT, length: h.length / UNIT, midi: noteToMidi(note), velocity: h.velocity }))));
  }

  // ===== パッド（開離配置。PadPlayer と共通） =====
  const padTrack = addTrack("pad");
  if (padTrack) {
    addLooped(padTrack, "pad", padEvents(progression, key).flatMap(h =>
      h.notes.map(note => ({ beats: h.sixteenth / UNIT, length: h.length / UNIT, midi: noteToMidi(note), velocity: 0.7 }))));
  }

  // ===== アルペジオ（ジャンル別の刻み・パターン・音の長さ。ArpPlayer と共通） =====
  const arpTrack = addTrack("arp");
  if (arpTrack) {
    const param  = arpParam();
    const length = durationToBeats(param.step) * param.gate;
    addLooped(arpTrack, "arp", arpNotes(progression, key, param).map(n =>
      ({ beats: n.sixteenth / UNIT, length, midi: noteToMidi(n.note), velocity: n.velocity })));
  }

  // ===== ベース（ジャンル別のパターン。BassPlayer と共通。基準オクターブは再生と同じ 2） =====
  const bassTrack = addTrack("bass");
  if (bassTrack) {
    addLooped(bassTrack, "bass", bassNotes(progression, key, 2).map(n =>
      ({ beats: n.sixteenth / UNIT, length: n.length / UNIT, midi: noteToMidi(n.note),
         velocity: 0.8 * bassVelocity(Math.floor(n.sixteenth / BAR), n.sixteenth % BAR) })));
  }

  // ===== ドラム（1マスごとに、その小節のブロックのパターンで鳴らす。フィル・エンディングも DrumEngine と共通） =====
  const drumTrack = addTrack("drum");
  if (drumTrack) {
    for (let step = 0; step < s.bars * BAR; step++) {
      const bar   = Math.floor(step / BAR);
      const block = findBlock(arrangement.drum, bar);
      if (!block) continue;
      const pattern = blockDrumPattern(block);
      if (!pattern) continue;
      for (const { name, velocity } of drumStepHits(pattern, bar, step % BAR)) {
        if (GM_DRUMS[name] === undefined) continue;
        drumTrack.addNote({
          midi:          GM_DRUMS[name],
          ticks:         toTicks(swung(step / UNIT)),
          durationTicks: toTicks(0.25),
          velocity,
        });
      }
    }
  }

  // ===== カウンターメロディ（メロディとコード進行から作る。CounterPlayer と共通） =====
  const counterTrack = addTrack("counter");
  if (counterTrack) {
    addLooped(counterTrack, "counter", counterNotes(progression, songMelody(), key).map(n =>
      ({ beats: n.sixteenth / UNIT, length: n.length / UNIT, midi: n.midi, velocity: n.velocity })));
  }

  // ===== パーカッション（ドラムと同じチャンネル 10。PercPlayer と共通） =====
  const percTrack = addTrack("perc");
  if (percTrack) {
    for (let step = 0; step < s.bars * BAR; step++) {
      if (!arranged("perc", step / UNIT)) continue;
      for (const { name, velocity } of percStepHits(Math.floor(step / BAR), step % BAR)) {
        percTrack.addNote({
          midi:          GM_DRUMS[name],
          ticks:         toTicks(swung(step / UNIT)),
          durationTicks: toTicks(0.25),
          velocity,
        });
      }
    }
  }

  return midi;
}
