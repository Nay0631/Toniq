import * as Tone from "tone";
import { ChordProgression } from "../data/types";
import { resolveChord, chordKey } from "../data/degree_resolver";
import { createVolumeNode } from "./VolumeManager";
import { arrangementGate, positionAt } from "./LoopArranger";
import { kickAt } from "./DrumEngine";
import { getState } from "./AppState";
import bassParams from "../data/bass_params.json";
import { GrowInstrument, growValues, isGrowReady, findGrowPreset, growPresetValuesWith } from "./Grow";

// ジャンル別のベース設定（bass_params.json）
// パターンは16ステップ表記：R = ルート、F = 5度、O = 1オクターブ上、- = 伸ばす、. = 休符
interface BassParam {
  patterns:    string[];  // 小節ごとに順に使う
  fill:        string;    // コード進行1周の最後の小節で使う
  octaveShift: number;    // 呼び出し側の基準オクターブからのずらし
  sub?:        boolean;   // サブベースを重ねるのが標準か（AppState.bassSub が null のとき）
  synth: {
    oscillator:     "sine" | "triangle" | "sawtooth" | "square";
    envelope:       { attack: number; decay: number; sustain: number; release: number };
    filterQ:        number;
    filterEnvelope: { attack: number; decay: number; sustain: number; release: number; baseFrequency: number; octaves: number };
    volume:         number;
  };
}

let bassPart: Tone.Part | null = null;
let bassSynth: Tone.MonoSynth | GrowInstrument | null = null;
let bassVol: Tone.Volume | null = null;
// サブベース（bassSubOn() のとき）。本体のベースは bassLowCut で低域を削り、いちばん下の帯域はサブに任せる
let subSynth:  Tone.MonoSynth | GrowInstrument | null = null;
let subNodes:  Tone.ToneAudioNode[] = [];
let bassLowCut: Tone.Filter | null = null;

// サブベース：ベースの音を E1〜D#2 にたたんだサイン（grow の「サブベース」）。本体の低域は SUB_CROSSOVER から下を削る
const SUB_LOW       = 28;   // E1
const SUB_LEVEL_DB  = -6;   // 本体に対するサブの大きさ（-3 ではトランスの曲全体のピークが -1.0dB まで上がった。2026-11-12 に測定）
const SUB_CROSSOVER = 90;   // 本体のベースの低域を削る周波数（Hz）

function bassParam(): BassParam {
  const params = bassParams as unknown as Record<string, BassParam>;
  return params[getState().genre] ?? params["ローファイ"];
}

// grow（AppState.growSounds.bass。標準はジャンルに合わせたプリセット。Grow.ts の BASS_STANDARD）で鳴らし、そのまま Volume へ。
// grow の準備ができていない（wasm がない）ときは、AppState.genre の bass_params.json の synth で Tone.js の MonoSynth を作る。
// 変更は次に Synth を作り直したとき（再生開始時）に反映される
export function initBassSynth() {
  disposeSynths();
  bassVol = createVolumeNode("bass");  // 現在のオーディオコンテキスト用のノード
  // サブを重ねるときは、本体のベースの低域を削ってからつなぐ
  let dest: Tone.InputNode = bassVol;
  if (bassSubOn()) {
    bassLowCut = new Tone.Filter({ type: "highpass", frequency: SUB_CROSSOVER, rolloff: -12 }).connect(bassVol);
    dest = bassLowCut;
    initSubSynth(bassVol);
  }
  if (isGrowReady()) {
    bassSynth = new GrowInstrument(growValues("bass")).connect(dest);
    return;
  }
  const { synth } = bassParam();
  bassSynth = new Tone.MonoSynth({
    oscillator:     { type: synth.oscillator },
    envelope:       synth.envelope,
    filter:         { type: "lowpass", Q: synth.filterQ, rolloff: -24 },
    filterEnvelope: synth.filterEnvelope,
    volume:         synth.volume,
  }).connect(dest);
}

// サブベースを重ねるか（AppState.bassSub。null = ジャンルの標準 bass_params.json の sub）
export function bassSubOn(): boolean {
  return getState().bassSub ?? bassSubStandard();
}

export function bassSubStandard(genre: string = getState().genre): boolean {
  const params = bassParams as unknown as Record<string, BassParam>;
  return (params[genre] ?? params["ローファイ"]).sub ?? false;
}

// サブの音色：grow の「サブベース」（ない・準備ができていないときは Tone.js のサイン）
function initSubSynth(dest: Tone.InputNode) {
  const level  = new Tone.Gain(SUB_LEVEL_DB, "decibels").connect(dest);
  subNodes = [level];
  const preset = findGrowPreset("sub_bass");
  if (isGrowReady() && preset >= 0) {
    subSynth = new GrowInstrument(() => growPresetValuesWith(preset, {})).connect(level);
    return;
  }
  subSynth = new Tone.MonoSynth({
    oscillator:     { type: "sine" },
    envelope:       { attack: 0.005, decay: 0.1, sustain: 0.9, release: 0.08 },
    filter:         { type: "lowpass", Q: 0, rolloff: -24 },
    filterEnvelope: { attack: 0, decay: 0, sustain: 1, release: 0, baseFrequency: 200, octaves: 0 },
    volume:         -6,
  }).connect(level);
}

// サブで鳴らす高さ：ベースの音を E1〜D#2 の1オクターブにたたむ（オクターブ上の O もルートになる）
export function subMidi(note: string): number {
  const midi = Tone.Frequency(note).toMidi();
  return SUB_LOW + ((midi - SUB_LOW) % 12 + 12) % 12;
}

// ベースの1音（位置と長さは16分音符の数。ループの頭から）
export interface BassNote {
  sixteenth: number;
  note:      string;
  length:    number;
}

// ベースの音の並び（ジャンル別のパターン。MIDI書き出しも同じものを使う）。
// コード進行1周の最後の小節は fill（曲全体の並びなら section_bars ごと）。エンディングの主和音はルートの全音符1つ
export function bassNotes(progression: ChordProgression, key: string, octave: number = 2): BassNote[] {
  const param = bassParam();
  const notes: BassNote[] = [];
  const loopBars = progression.section_bars ?? progression.length_bars;

  progression.progression.forEach((chord) => {
    const resolved = resolveChord(
      chord.degree,
      chord.type,
      0,
      chordKey(key, chord),  // 転調している所はずらしたキー
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

    if (chord.ending) {
      notes.push({ sixteenth: (chord.bar - 1) * 16, note: roles.R, length: chord.duration_bars * 16 });
      return;
    }

    for (let b = 0; b < chord.duration_bars; b++) {
      const bar = chord.bar - 1 + b;
      const pattern = bar % loopBars === loopBars - 1
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

// ベースの強さ：キックと同時に鳴る音を強く、それ以外は拍の頭 > 裏の順に少し弱くして、低音のアタックをキックにそろえる
export function bassVelocity(bar: number, step: number): number {
  if (kickAt(bar, step)) return 1;
  return step % 4 === 0 ? 0.88 : 0.76;
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
  const position = positionAt();
  const sub = subSynth;
  bassPart = new Tone.Part((time, event: any) => {
    if (!arranged(time)) return;
    const { bar, step } = position(time);
    const velocity = bassVelocity(bar, step);
    bassSynth?.triggerAttackRelease(event.note, event.dur, time, velocity);
    sub?.triggerAttackRelease(Tone.Frequency(subMidi(event.note), "midi").toFrequency(), event.dur, time, velocity);
  }, events);

  bassPart.loop = true;
  bassPart.loopEnd = `${progression.length_bars}m`;
  bassPart.start(0);
}

function disposeSynths() {
  bassSynth?.dispose();
  subSynth?.dispose();
  subNodes.forEach(n => n.dispose());
  bassLowCut?.dispose();
  bassSynth  = null;
  subSynth   = null;
  subNodes   = [];
  bassLowCut = null;
}

export function disposeBass() {
  bassPart?.dispose();
  bassPart = null;
  disposeSynths();
}