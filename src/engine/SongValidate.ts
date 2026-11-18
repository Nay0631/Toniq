import { defaultState, SongFields } from "./AppState";
import type { ArrangeEdit, Section } from "./AppState";
import type { ChordDegree, ChordProgression, DrumPattern, DrumTrack } from "../data/types";
import type { MelodyNote } from "./MelodyGenerator";
import { NOTE_INDEX, resolveChord } from "../data/degree_resolver";
import { ARRANGE_PRESETS, LAYERS } from "./LoopArranger";
import { METERS } from "./Meter";

// 曲ファイル（.toniq.json）から読み込んだ曲の中身を確かめる。
// ファイルは手で書き換えられたり壊れていたりするので、鳴らすときに例外になる値（知らないキー・ディグリー・スケール、
// 形の違うメロディ・ドラムなど）をここで落とす。鳴らせない曲は null（読み込まない）、
// 直せる項目（音量の範囲・知らない選択肢など）は初期値や範囲の中の値にして読み込む

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount  = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
const strings  = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const text     = (v: unknown, fallback: string): string => typeof v === "string" ? v : fallback;
const clamp    = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const oneOf    = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? v as T : fallback;

const MAX_LOOP_BARS  = 64;   // コード進行1周の長さの上限（小節）
const MAX_DRUM_STEPS = 64;   // ドラムパターンの長さの上限（ステップ。4小節）

// コード進行：すべてのコードが、そのキー・スケールで実音にできるか（できなければ null）
function chordPattern(v: unknown, key: string): ChordProgression | null {
  if (!isObject(v) || typeof v.base_scale !== "string" || !isCount(v.length_bars, MAX_LOOP_BARS)) return null;
  if (!Array.isArray(v.progression) || v.progression.length === 0) return null;
  const progression: ChordDegree[] = [];
  for (const c of v.progression as unknown[]) {
    if (!isObject(c) || typeof c.degree !== "string" || typeof c.type !== "string") return null;
    if (!isCount(c.bar, v.length_bars) || !isCount(c.duration_bars, v.length_bars)) return null;
    const inversion = clamp(c.inversion, 0, 3, 0);
    try {
      resolveChord(c.degree, c.type, inversion, key, v.base_scale, 4);
    } catch {
      return null;
    }
    // 曲全体の並びでだけ付く印（ending / section / keyShift）は保存しないので写さない
    progression.push({ bar: c.bar, degree: c.degree, type: c.type, inversion, duration_bars: c.duration_bars });
  }
  const rhythm = isObject(v.chord_rhythm) ? v.chord_rhythm : {};
  const range  = isObject(v.bpm_range) ? v.bpm_range : {};
  return {
    id:          text(v.id, "imported"),
    name:        text(v.name, "読み込んだ進行"),
    mood:        strings(v.mood),
    genre:       strings(v.genre),
    bpm_range:   { min: clamp(range.min, 20, 240, 60), max: clamp(range.max, 20, 240, 180) },
    base_scale:  v.base_scale,
    length_bars: v.length_bars,
    progression,
    chord_rhythm: { pattern: text(rhythm.pattern, "whole"), description: text(rhythm.description, "") },
    ...(typeof v.notes === "string" ? { notes: v.notes } : {}),
  };
}

// ドラムパターン：トラックごとの on/off と強さを、ステップ数ちょうどの数の列にそろえる（形の違うトラックは落とす）
function drumPattern(v: unknown): DrumPattern | null {
  if (!isObject(v) || !isCount(v.steps, MAX_DRUM_STEPS) || !isObject(v.tracks)) return null;
  const steps = v.steps;
  const tracks: Record<string, DrumTrack> = {};
  for (const [name, t] of Object.entries(v.tracks)) {
    if (!isObject(t) || !Array.isArray(t.pattern)) continue;
    const velocity = Array.isArray(t.velocity) ? t.velocity as unknown[] : [];
    const pattern  = Array.from({ length: steps }, (_, i) => (t.pattern as unknown[])[i] ? 1 : 0);
    tracks[name] = {
      pattern,
      velocity: pattern.map((on, i) => on ? clamp(velocity[i], 0, 1, 0.8) : 0),
      note:     text(t.note, "C1"),
    };
  }
  const range = isObject(v.bpm_range) ? v.bpm_range : {};
  return {
    id:        text(v.id, "imported"),
    name:      text(v.name, "読み込んだパターン"),
    genre:     strings(v.genre),
    mood:      strings(v.mood),
    bpm_range: { min: clamp(range.min, 20, 240, 60), max: clamp(range.max, 20, 240, 180) },
    steps,
    step_unit: text(v.step_unit, "16n"),
    tracks,
    ...(typeof v.notes === "string" ? { notes: v.notes } : {}),
    // 3/4・3連符の拍子で作ったオリジナルのパターン（なし = 4/4 の 16 ステップ）
    ...(v.meter === "3/4" || v.meter === "4/4t" ? { meter: v.meter } : {}),
  };
}

// メロディの音：音名（シャープ表記・オクターブ 0〜8。null = 休符）、位置（小節:拍:16分）、長さ（音価か 小節:拍:16分）
const NOTE_NAME = /^[A-G]#?[0-8]$/;
const POSITION  = /^\d{1,4}:\d{1,2}:\d{1,2}(\.\d{1,4})?$/;
const DURATION  = /^(1n|2n\.?|4n\.?|8n\.?|16n|4t|8t)$/;  // 4t / 8t は3連符の拍子で作った音

function melodyNotes(v: unknown): MelodyNote[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is MelodyNote =>
    isObject(n)
    && (n.note === null || (typeof n.note === "string" && NOTE_NAME.test(n.note)))
    && typeof n.time === "string" && POSITION.test(n.time)
    && typeof n.duration === "string" && (DURATION.test(n.duration) || POSITION.test(n.duration)),
  ).map(n => ({ note: n.note, duration: n.duration, time: n.time }));
}

const SECTIONS: readonly Section[] = ["A", "B"];

function arrangeEdits(v: unknown): ArrangeEdit[] {
  if (!Array.isArray(v)) return [];
  const bars = (x: unknown) => Array.isArray(x)
    ? x.filter((b): b is number => typeof b === "number" && Number.isInteger(b) && b >= 0 && b < 1024)
    : undefined;
  const edits: ArrangeEdit[] = [];
  for (const e of v as unknown[]) {
    if (!isObject(e) || !SECTIONS.includes(e.section as Section) || !LAYERS.includes(e.part as ArrangeEdit["part"])) continue;
    if (typeof e.nth !== "number" || !Number.isInteger(e.nth) || e.nth < 0) continue;
    const edit: ArrangeEdit = { section: e.section as Section, nth: e.nth, part: e.part as ArrangeEdit["part"] };
    if (typeof e.on === "boolean") edit.on = e.on;
    const b = bars(e.bars), s = bars(e.splits);
    if (b) edit.bars = b;
    if (s) edit.splits = s;
    if (typeof e.drum === "string") edit.drum = e.drum;
    if (typeof e.fx === "string") edit.fx = oneOf(e.fx, FX_TYPES, "auto");
    edits.push(edit);
  }
  return edits;
}

// grow の音作りで変えた値（パラメーターの ID → 数）
function growParams(v: unknown): Record<string, number> | null {
  if (!isObject(v)) return null;
  const entries = Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

const TEMPO_PRESETS = ["ゆっくり", "普通", "速い", "custom"] as const;
const MELODY_INSTRUMENTS = ["grow"] as const;
const CHORD_RHYTHMS = ["whole", "half", "quarter", "eighth"] as const;
const FX_TYPES = ["auto", "riser", "build", "impact", "downlifter", "reverse", "chip"] as const;

// 曲ファイルから読んだ曲（songFields で初期値を補ったあと）を確かめる。鳴らせない曲は null
export function validateImportedSong(song: SongFields): SongFields | null {
  const d = defaultState;
  if (typeof song.key !== "string" || NOTE_INDEX[song.key] === undefined) return null;
  const chord = chordPattern(song.chordPattern, song.key);
  const drum  = drumPattern(song.drumPattern);
  if (!chord || !drum) return null;

  // サビの進行は Aメロと同じ長さ・スケールのものだけ使える。形が違えば「なし」にする
  const chorus = song.chorusPattern === null ? null : chordPattern(song.chorusPattern, song.key);
  const record = <T>(v: unknown, fallback: Record<string, T>, fix: (x: unknown, f: T) => T) =>
    Object.fromEntries(Object.entries(fallback).map(([k, f]) => [k, fix(isObject(v) ? v[k] : undefined, f)]));
  const percent = (v: unknown) => v === null ? null : clamp(v, 0, 100, 0);
  const sounds  = isObject(song.growSounds) ? song.growSounds as Record<string, unknown> : {};

  return {
    ...song,
    genre:        text(song.genre, d.genre),
    mood:         text(song.mood, d.mood),
    tempoPreset:  oneOf(song.tempoPreset, TEMPO_PRESETS, "custom"),
    meter:        oneOf(song.meter, METERS, d.meter),
    chordPattern: chord,
    drumPattern:  drum,
    chorusPattern: chorus && chorus.length_bars === chord.length_bars && chorus.base_scale === chord.base_scale ? chorus : null,
    melodyNotes:       melodyNotes(song.melodyNotes),
    chorusMelodyNotes: melodyNotes(song.chorusMelodyNotes),
    sections: Array.isArray(song.sections) && song.sections.length > 0 && song.sections.every(x => SECTIONS.includes(x))
      ? song.sections : null,
    modulation:      Math.round(clamp(song.modulation, -12, 12, 0)),
    modulationScope: oneOf(song.modulationScope, ["last", "chorus"] as const, d.modulationScope),
    melodyMethod:    oneOf(song.melodyMethod, ["auto", "manual"] as const, "manual"),
    melodyVersion:   Math.round(clamp(song.melodyVersion, 0, 9999, 0)),
    melodyInstrument: oneOf(song.melodyInstrument, MELODY_INSTRUMENTS, d.melodyInstrument),
    chordRhythm:     oneOf(song.chordRhythm, CHORD_RHYTHMS, d.chordRhythm),
    fxType:          oneOf(song.fxType, FX_TYPES, d.fxType),
    swing:           percent(song.swing),
    swingUnit:       oneOf(song.swingUnit, ["16n", "8n"] as const, d.swingUnit),
    sidechain:       percent(song.sidechain),
    scaleLock:       typeof song.scaleLock === "boolean" ? song.scaleLock : d.scaleLock,
    drumCategory:    text(song.drumCategory, d.drumCategory),
    growPreset:      typeof song.growPreset === "string" ? song.growPreset : null,
    growParams:      growParams(song.growParams),
    growChordPreset: typeof song.growChordPreset === "string" ? song.growChordPreset : null,
    growChordParams: growParams(song.growChordParams),
    growSounds: Object.fromEntries(Object.keys(d.growSounds).map(part => {
      const s = isObject(sounds[part]) ? sounds[part] : {};
      return [part, { preset: typeof s.preset === "string" ? s.preset : null, params: growParams(s.params) }];
    })) as SongFields["growSounds"],
    bassSub:       typeof song.bassSub === "boolean" ? song.bassSub : null,
    arrangePreset: oneOf(song.arrangePreset, ARRANGE_PRESETS.map(p => p.id), d.arrangePreset),
    arrangeEdits:  arrangeEdits(song.arrangeEdits),
    parts:   record(song.parts, d.parts, (x, f) => typeof x === "boolean" ? x : f) as SongFields["parts"],
    volumes: record(song.volumes, d.volumes, (x, f) => Math.round(clamp(x, 0, 100, f))) as SongFields["volumes"],
    pans:    record(song.pans, d.pans, (x, f) => Math.round(clamp(x, -100, 100, f))) as SongFields["pans"],
  };
}
