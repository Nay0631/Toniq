import { getState, Section } from "./AppState";
import { ChordDegree, ChordProgression } from "../data/types";
import {
  MelodyNote, generateMelody, noteToMidi, midiToNote,
  timeToUnits, durationToUnits, unitsToTime, unitsToDuration,
} from "./MelodyGenerator";
import { defaultSections, isArrangementBypassed, isArrangedAt, LAYERS } from "./LoopArranger";
import { NOTE_INDEX } from "../data/degree_resolver";

// 曲の構成：セクション（Aメロ／サビ）・エンディング・ドラムのフィルの位置。
// 各パートには、コード進行1周ではなく曲全体の並び（songProgression / songMelody）を渡す。
// 試聴・サンプル中（アレンジの判定を外しているとき）は、今までどおりコード進行1周をそのまま使う

// ===== 周回とセクション =====

// コード進行1周の長さ（小節）
export function loopBars(): number {
  return getState().chordPattern?.length_bars ?? 4;
}

// 曲全体の周回数（最後の周回が途中で終わっても1周と数える）
export function songLoops(): number {
  return Math.max(1, Math.ceil(getState().bars / loopBars()));
}

// サビの進行として使えるか（Aメロの進行と同じ長さ・スケールで、別の進行）
export function chorusFits(chorus: ChordProgression | null, base: ChordProgression | null): boolean {
  return !!chorus && !!base && chorus.id !== base.id
      && chorus.length_bars === base.length_bars && chorus.base_scale === base.base_scale;
}

// サビで鳴らす進行（AppState.chorusPattern が使えなければ null = Aメロと同じ進行）
export function chorusProgression(): ChordProgression | null {
  const s = getState();
  return chorusFits(s.chorusPattern, s.chordPattern) ? s.chorusPattern : null;
}

// 周回ごとのセクション（AppState.sections が null なら、または足りない分はジャンルの標準）
export function getSections(): Section[] {
  const s = getState();
  const loops = songLoops();
  const base  = defaultSections(s.genre, loops);
  return base.map((section, i) => s.sections?.[i] ?? section);
}

// 曲の小節（0 始まり）のセクション
export function sectionAt(bar: number): Section {
  if (isArrangementBypassed()) return "A";
  return getSections()[Math.floor(bar / loopBars())] ?? "A";
}

// ===== エンディング =====

// エンディングの小節（0 始まり。曲の最後の小節）。使わないとき・試聴中は null
export function endingBar(): number | null {
  const s = getState();
  if (!s.endingEnabled || isArrangementBypassed() || s.bars < 2) return null;
  return s.bars - 1;
}

// 主和音（エンディングで鳴らす）。メジャーは I、それ以外は Im
function tonicChord(scale: string): Pick<ChordDegree, "degree" | "type"> {
  return scale === "major" ? { degree: "I", type: "major" } : { degree: "I", type: "minor" };
}

// ===== 曲全体のコード進行 =====

// 曲全体のコードの並び。周回ごとにセクションの進行（Aメロ／サビ）を並べ、
// エンディングを使うなら最後の小節を主和音（全音符1つ）にする。試聴中はコード進行1周のまま
export function songProgression(): ChordProgression | null {
  const s = getState();
  const base = s.chordPattern;
  if (!base) return null;
  if (isArrangementBypassed()) return base;

  const chorus   = chorusProgression() ?? base;
  const L        = base.length_bars;
  const sections = getSections();
  let chords: ChordDegree[] = [];
  sections.forEach((section, i) => {
    const prog = section === "B" ? chorus : base;
    for (const c of prog.progression) chords.push({ ...c, bar: c.bar + i * L, section });
  });

  let length = sections.length * L;
  const end = endingBar();
  if (end !== null) {
    const endBar = end + 1;  // ChordDegree.bar は 1 始まり
    chords = chords
      .filter(c => c.bar < endBar)
      .map(c => c.bar + c.duration_bars > endBar ? { ...c, duration_bars: endBar - c.bar } : c);
    chords.push({
      bar: endBar, ...tonicChord(base.base_scale), inversion: 0, duration_bars: 1,
      ending: true, section: sections[Math.floor(end / L)] ?? "A",
    });
    length = s.bars;
  }

  return { ...base, id: `${base.id}_song`, length_bars: length, progression: chords, section_bars: L };
}

// ===== 曲全体のメロディ =====

interface PlacedNote { midi: number; start: number; units: number }

function toPlaced(notes: MelodyNote[], offset: number, limit: number): PlacedNote[] {
  return notes
    .filter((n): n is MelodyNote & { note: string } => n.note !== null)
    .map(n => ({ midi: noteToMidi(n.note), start: timeToUnits(n.time), units: durationToUnits(n.duration) }))
    .filter(n => n.start < limit)
    .map(n => ({ ...n, start: n.start + offset, units: Math.min(n.units, limit - n.start) }));
}

// 曲全体のメロディ。周回ごとにセクションのメロディ（サビは chorusMelodyNotes。空なら melodyNotes）を並べ、
// エンディングを使うなら最後の小節を主音の全音符にする（直前の音にいちばん近い高さ）。試聴中はコード進行1周のまま
export function songMelody(): MelodyNote[] {
  const s = getState();
  if (!s.chordPattern || isArrangementBypassed()) return s.melodyNotes;

  const loopUnits = loopBars() * 16;
  const chorus    = s.chorusMelodyNotes.length > 0 ? s.chorusMelodyNotes : s.melodyNotes;
  let placed: PlacedNote[] = [];
  getSections().forEach((section, i) => {
    placed.push(...toPlaced(section === "B" ? chorus : s.melodyNotes, i * loopUnits, loopUnits));
  });

  const end = endingBar();
  if (end !== null && placed.length > 0) {
    const endUnit = end * 16;
    placed = placed
      .filter(n => n.start < endUnit)
      .map(n => ({ ...n, units: Math.min(n.units, endUnit - n.start) }));
    const last  = placed[placed.length - 1]?.midi ?? 72;
    const tonic = NOTE_INDEX[s.key] ?? 0;
    // 直前の音の 6 半音下〜5 半音上の 12 音のうち、主音のもの（ちょうど1つある）
    const midi  = Array.from({ length: 12 }, (_, k) => last - 6 + k).find(m => m % 12 === tonic) ?? last;
    placed.push({ midi, start: endUnit, units: 16 });
  }

  return placed.map(n => ({ note: midiToNote(n.midi), duration: unitsToDuration(n.units), time: unitsToTime(n.start) }));
}

// ===== ドラムのフィル =====

// その小節の頭で鳴っているパート（ON のものだけ）
function partsAt(bar: number): string {
  const s = getState();
  return LAYERS.filter(p => s.parts[p] && isArrangedAt(p, bar)).join(",");
}

// フィルを入れる小節か。ドラムが鳴っている周回の最後の小節で、次がセクションの変わり目・編成が変わる所・8小節ごと、
// またはエンディングの直前の小節。使わないとき・試聴中は false
export function isFillBar(bar: number): boolean {
  const s = getState();
  if (!s.drumFill || isArrangementBypassed() || !s.chordPattern) return false;
  if (!isArrangedAt("drum", bar)) return false;
  const end = endingBar();
  if (end !== null && bar === end - 1) return true;
  if (bar >= s.bars - 1) return false;

  const L = loopBars();
  if ((bar + 1) % L !== 0) return false;
  const loop     = Math.floor(bar / L);
  const sections = getSections();
  if (sections[loop] !== sections[loop + 1]) return true;
  if (partsAt(bar + 1) !== partsAt(loop * L)) return true;
  const every = Math.max(1, Math.round(8 / L));
  return (loop + 1) % every === 0;
}

// ===== メロディの自動生成（Aメロとサビ） =====

// 今のコード進行（Aメロ）とサビの進行でメロディを作る。サビは高めの音域で作る
// サビは Aメロの最後の音から大きく跳ばずに始める
export function generateSongMelodies(): { melodyNotes: MelodyNote[]; chorusMelodyNotes: MelodyNote[] } {
  const s = getState();
  if (!s.chordPattern) return { melodyNotes: [], chorusMelodyNotes: [] };
  const melodyNotes = generateMelody(s.chordPattern, s.key, s.genre, { section: "A" });
  return { melodyNotes, chorusMelodyNotes: chorusMelodyAfter(melodyNotes) };
}

// サビのメロディだけ作り直す（サビの進行を変えたとき。Aメロのメロディはそのまま）
export function generateChorusMelody(): MelodyNote[] {
  return chorusMelodyAfter(getState().melodyNotes);
}

function chorusMelodyAfter(verse: MelodyNote[]): MelodyNote[] {
  const s = getState();
  if (!s.chordPattern) return [];
  const last = [...verse].reverse().find(n => n.note !== null)?.note;
  return generateMelody(chorusProgression() ?? s.chordPattern, s.key, s.genre, {
    section: "B", prevNote: last ? noteToMidi(last) : undefined,
  });
}
