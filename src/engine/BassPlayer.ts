import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate } from "./LoopArranger";
import { getState } from "./AppState";
import bassParams from "../data/bass_params.json";

// ジャンル別のベース設定（bass_params.json）
// パターンは16ステップ表記：R = ルート、F = 5度、O = 1オクターブ上、- = 伸ばす、. = 休符
interface BassParam {
  patterns:    string[];  // 小節ごとに順に使う
  fill:        string;    // コード進行1周の最後の小節で使う
  octaveShift: number;    // 呼び出し側の基準オクターブからのずらし
  synth: {
    oscillator:     "sine" | "triangle" | "sawtooth" | "square";
    envelope:       { attack: number; decay: number; sustain: number; release: number };
    filterQ:        number;
    filterEnvelope: { attack: number; decay: number; sustain: number; release: number; baseFrequency: number; octaves: number };
    volume:         number;
  };
}

let bassPart: Tone.Part | null = null;
let bassSynth: Tone.MonoSynth | null = null;
let bassVol: Tone.Volume | null = null;

function bassParam(): BassParam {
  const params = bassParams as unknown as Record<string, BassParam>;
  return params[getState().genre] ?? params["ローファイ"];
}

// 音色は AppState.genre から決める。変更は次に Synth を作り直したとき（再生開始時）に反映される
export function initBassSynth() {
  bassVol = createVolumeNode("bass");  // 現在のオーディオコンテキスト用のノード
  const { synth } = bassParam();
  bassSynth = new Tone.MonoSynth({
    oscillator:     { type: synth.oscillator },
    envelope:       synth.envelope,
    filter:         { type: "lowpass", Q: synth.filterQ, rolloff: -24 },
    filterEnvelope: synth.filterEnvelope,
    volume:         synth.volume,
  }).connect(bassVol);
}

// ベースの1音（位置と長さは16分音符の数。ループの頭から）
export interface BassNote {
  sixteenth: number;
  note:      string;
  length:    number;
}

// コード進行1周分のベースの音の並び（ジャンル別のパターン。MIDI書き出しも同じものを使う）
export function bassNotes(progression: ChordProgression, key: string, octave: number = 2): BassNote[] {
  const param = bassParam();
  const notes: BassNote[] = [];

  progression.progression.forEach((chord) => {
    const resolved = resolveChord(
      chord.degree,
      chord.type,
      0,
      key,
      progression.base_scale,
      octave + param.octaveShift
    );
    // 5度はコードの構成音から取る（dim なら減5度）。見つからなければ完全5度
    const rootMidi = Tone.Frequency(resolved.notes[0]).toMidi();
    const fifth = resolved.notes
      .map(n => Tone.Frequency(n).toMidi() - rootMidi)
      .find(i => i >= 6 && i <= 8) ?? 7;
    const root = Tone.Frequency(resolved.bass_note);
    const roles: Record<string, string> = {
      R: root.toNote(),
      F: root.transpose(fifth).toNote(),
      O: root.transpose(12).toNote(),
    };

    for (let b = 0; b < chord.duration_bars; b++) {
      const bar = chord.bar - 1 + b;
      const pattern = bar === progression.length_bars - 1
        ? param.fill
        : param.patterns[bar % param.patterns.length];

      for (let step = 0; step < 16; step++) {
        const note = roles[pattern[step]];
        if (!note) continue;
        // 続く "-" の数だけ伸ばす
        let len = 1;
        while (step + len < 16 && pattern[step + len] === "-") len++;
        notes.push({ sixteenth: bar * 16 + step, note, length: len });
      }
    }
  });
  return notes;
}

export function loadBassLine(
  progression: ChordProgression,
  key: string = "A",
  octave: number = 2
) {
  if (bassPart) { bassPart.dispose(); bassPart = null; }
  if (!bassSynth) initBassSynth();

  const events = bassNotes(progression, key, octave).map(n => ({
    time: `0:0:${n.sixteenth}`,
    note: n.note,
    dur:  `0:0:${n.length}`,
  }));

  const arranged = arrangementGate("bass");
  bassPart = new Tone.Part((time, event: any) => {
    if (!arranged(time)) return;
    bassSynth?.triggerAttackRelease(event.note, event.dur, time);
  }, events);

  bassPart.loop = true;
  bassPart.loopEnd = `${progression.length_bars}m`;
  bassPart.start(0);
}

export function disposeBass() {
  bassPart?.dispose();
  bassSynth?.dispose();
  bassPart = null;
  bassSynth = null;
}
