import { getState } from "./AppState";
import { ChordProgression } from "../data/types";
import { resolveChord, NOTE_INDEX } from "../data/degree_resolver";
import { noteToMidi, timeToUnits, durationToUnits } from "./MelodyGenerator";
import { getArrangement, findBlock, LAYERS, SECTION_BARS } from "./LoopArranger";
import { chorusProgression, endingBar, getSections, isFillBar, loopBars, songMelody, songProgression } from "./SongForm";
import chordDB from "../data/chord_progressions.json";
import melodyParams from "../data/melody_params.json";

// 自動チェック：今の曲を規則で調べ、作曲のよくある弱点（強拍でコードとぶつかる、言い切らずに終わる、
// 大きく跳ぶ、サビが盛り上がらない、ずっと同じ編成 など）を数字で出す。アレンジャーのテスト中の機能の欄に表示する。
// 数値（songMetrics）と合否の基準（QUALITY_RULES）は、Node でまとめて測るスクリプト（tools/quality-report.mjs）と共通

export interface QualityItem {
  label: string;
  value: string;          // 結果（短い文）
  ok:    boolean | null;  // true = 良い、false = 見直したほうがよい、null = 参考（良し悪しを付けない）
  hint:  string;          // 基準の説明
}

interface SongNote { midi: number; start: number; end: number }

// 曲全体のメロディ（休符を除く。16分音符単位の位置）
function melodyNotes(): SongNote[] {
  return songMelody()
    .filter((n): n is typeof n & { note: string } => n.note !== null)
    .map(n => ({ midi: noteToMidi(n.note), start: timeToUnits(n.time), end: timeToUnits(n.time) + durationToUnits(n.duration) }))
    .sort((a, b) => a.start - b.start);
}

// 16分音符単位の位置で鳴っているコードの構成音（ピッチクラス）
function chordAt(song: ChordProgression, key: string, unit: number): number[] {
  const chord = song.progression.find(c => unit >= (c.bar - 1) * 16 && unit < (c.bar - 1 + c.duration_bars) * 16);
  if (!chord) return [];
  return resolveChord(chord.degree, chord.type, chord.inversion, key, song.base_scale, 4).notes.map(n => noteToMidi(n) % 12);
}

const pct = (a: number, b: number) => `${Math.round((a / Math.max(1, b)) * 100)}%`;

// ===== 数値の結果 =====

export interface MelodyMetrics {
  strongFit:   number;  // 強拍（1・3拍目の頭）の音のうちコード構成音の数
  strongTotal: number;  // 強拍の音の数
  tonicEnds:   number;  // 周回の最後の音が主音の周回
  chordEnds:   number;  // 周回の最後の音が（主音以外の）コード構成音の周回
  phrases:     number;  // メロディのある周回の数
  maxLeap:     number;  // 最大の跳躍（半音。休符をはさまずに続く音どうし）
  stepRatio:   number;  // 順次進行（2 半音以内）の割合（0〜1。休符をはさまずに続く音どうし）
  range:       number;  // 音域（最高音 − 最低音。半音）
  notes:       number;  // 曲全体の音の数
  chorusLift:  number | null;  // サビの平均の高さ − Aメロの平均の高さ（片方しかなければ null）
}

export interface SongMetrics {
  melody:      MelodyMetrics | null;  // null = メロディ未作成
  verseLoops:  number;          // Aメロの周回の数
  chorusLoops: number;          // サビの周回の数
  chorusName:  string | null;   // サビの進行の名前（null = Aメロと同じ進行）
  drops:       number;          // ON のパートが前の小節より減る所の数
  fills:       number;          // ドラムのフィルの回数
  ending:      boolean;         // エンディングがあるか
}

export function songMetrics(): SongMetrics {
  const s = getState();
  const sections = getSections();
  const chorus = chorusProgression();
  const chorusLoops = sections.filter(x => x === "B").length;

  // アレンジの抜き差し：鳴っている（ON の）パートが前の小節より減る所（ブレイク・サビ前の空白）
  const arrangement = getArrangement();
  const partsAt = (bar: number) => LAYERS.filter(p => s.parts[p] && findBlock(arrangement[p], bar));
  let drops = 0;
  for (let bar = 1; bar < s.bars; bar++) {
    const now = partsAt(bar);
    if (partsAt(bar - 1).some(p => !now.includes(p))) drops++;
  }
  let fills = 0;
  for (let bar = 0; bar < s.bars; bar++) if (isFillBar(bar)) fills++;

  return {
    melody: melodyMetrics(sections),
    verseLoops: sections.length - chorusLoops,
    chorusLoops,
    chorusName: chorus ? chorus.name : null,
    drops,
    fills,
    ending: endingBar() !== null,
  };
}

function melodyMetrics(sections: string[]): MelodyMetrics | null {
  const s = getState();
  const song = songProgression();
  const notes = melodyNotes();
  if (!song || notes.length === 0) return null;
  const tonic = NOTE_INDEX[s.key] ?? 0;

  // 強拍（1拍目・3拍目の頭）の音がコード構成音か
  const strong = notes.filter(n => n.start % 8 === 0);
  const strongFit = strong.filter(n => chordAt(song, s.key, n.start).includes(n.midi % 12)).length;

  // 周回（フレーズ）の終わりの音：主音か、そのときのコードの構成音か
  const L = loopBars() * 16;
  let tonicEnds = 0, chordEnds = 0, phrases = 0;
  for (let i = 0; i < sections.length; i++) {
    const inLoop = notes.filter(n => n.start >= i * L && n.start < (i + 1) * L);
    const last = inLoop[inLoop.length - 1];
    if (!last) continue;
    phrases++;
    if (last.midi % 12 === tonic) tonicEnds++;
    else if (chordAt(song, s.key, last.start).includes(last.midi % 12)) chordEnds++;
  }

  // 跳躍・順次進行（休符をはさまずに続く、となりの音との高さの差。1拍以上の休符のあとは息つぎなので数えない）
  let maxLeap = 0, steps = 0, pairs = 0;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].start - notes[i - 1].end >= 4) continue;
    const leap = Math.abs(notes[i].midi - notes[i - 1].midi);
    maxLeap = Math.max(maxLeap, leap);
    pairs++;
    if (leap <= 2) steps++;
  }

  // サビの高さ：サビの平均の高さ − Aメロの平均の高さ
  const sectionOf = (n: SongNote) => sections[Math.floor(n.start / L)] ?? "A";
  const avg = (list: SongNote[]) => list.reduce((sum, n) => sum + n.midi, 0) / Math.max(1, list.length);
  const a = notes.filter(n => sectionOf(n) === "A"), b = notes.filter(n => sectionOf(n) === "B");
  const midis = notes.map(n => n.midi);

  return {
    strongFit,
    strongTotal: strong.length,
    tonicEnds,
    chordEnds,
    phrases,
    maxLeap,
    stepRatio: pairs === 0 ? 0 : steps / pairs,
    range: Math.max(...midis) - Math.min(...midis),
    notes: notes.length,
    chorusLift: a.length === 0 || b.length === 0 ? null : avg(b) - avg(a),
  };
}

// 合否の基準（true = 良い、false = 見直したほうがよい、null = 判定しない）
export const QUALITY_RULES = {
  strongFit:  (m: MelodyMetrics) => m.strongTotal === 0 ? null : m.strongFit / m.strongTotal >= 0.75,
  phraseEnd:  (m: MelodyMetrics) => m.phrases === 0 ? null : m.tonicEnds + m.chordEnds === m.phrases && m.tonicEnds > 0,
  leap:       (m: MelodyMetrics) => m.maxLeap <= 9,
  chorusLift: (m: MelodyMetrics) => m.chorusLift === null ? null : m.chorusLift > 0,
  section:    (x: SongMetrics) => x.chorusLoops > 0 && x.chorusName !== null,
  drops:      (x: SongMetrics) => x.verseLoops + x.chorusLoops < 3 ? null : x.drops > 0,
};

// ===== 表示 =====

function melodyItems(x: SongMetrics): QualityItem[] {
  const m = x.melody;
  if (!m) {
    return [{ label: "メロディ", value: "未作成（自動生成すると調べます）", ok: null, hint: "メロディを作るとチェックします" }];
  }
  return [{
    label: "強拍のコード構成音",
    value: `${pct(m.strongFit, m.strongTotal)}（${m.strongFit} / ${m.strongTotal} 音）`,
    ok: QUALITY_RULES.strongFit(m),
    hint: "1拍目・3拍目の頭の音がコードの音だと、メロディとコードがぶつからずに聞こえます（75% 以上が目安）",
  }, {
    label: "フレーズの終わり",
    value: `主音 ${m.tonicEnds}・構成音 ${m.chordEnds} / ${m.phrases} 周`,
    ok: QUALITY_RULES.phraseEnd(m),
    hint: "コード進行1周の最後の音が主音（またはコードの音）だと「言い切った」感じになります",
  }, {
    label: "最大の跳躍",
    value: `${m.maxLeap} 半音`,
    ok: QUALITY_RULES.leap(m),
    hint: "続けて歌う音の差が大きすぎると歌いにくいメロディになります（9 半音 = 長6度以内が目安。休符のあとは数えない）",
  }, {
    label: "サビの高さ",
    value: m.chorusLift === null ? "Aメロかサビの片方だけです" : `Aメロより ${m.chorusLift >= 0 ? "+" : ""}${m.chorusLift.toFixed(1)} 半音`,
    ok: QUALITY_RULES.chorusLift(m),
    hint: "サビのメロディが Aメロより高いと、サビで盛り上がって聞こえます",
  }];
}

function formItems(x: SongMetrics): QualityItem[] {
  return [{
    label: "セクション",
    value: `Aメロ ${x.verseLoops} 周・サビ ${x.chorusLoops} 周（サビの進行：${x.chorusName ?? "Aメロと同じ"}）`,
    ok: QUALITY_RULES.section(x),
    hint: "サビで別のコード進行に切り替わると、曲に展開が生まれます",
  }, {
    label: "アレンジの抜き差し",
    value: `パートが抜ける所 ${x.drops} か所`,
    ok: QUALITY_RULES.drops(x),
    hint: "足すだけでなく、ブレイクやサビ前の空白でパートを抜く所があると、次の盛り上がりが引き立ちます（OFF のパートは数えない）",
  }, {
    label: "エンディング・フィル",
    value: `エンディング ${x.ending ? "あり" : "なし"}・フィル ${x.fills} 回`,
    ok: null,
    hint: "設定タブのドラムの「もっと調整」（ドラムの演奏）で ON/OFF できます",
  }];
}

// コード進行DBのチェック：すべての進行がディグリーから実音にできるか、サビに使える相方（同じ長さ・スケール）があるか、
// 長さが8小節のセクションに合うか（割り切れない長さだと周回とセクションの区切りがずれる）・コードが長さちょうどを埋めているか
export function chordDBIssues(): { total: number; broken: string[]; alone: string[]; misfit: string[] } {
  const chords = chordDB as unknown as ChordProgression[];
  const broken: string[] = [];
  for (const c of chords) {
    try {
      c.progression.forEach(d => resolveChord(d.degree, d.type, d.inversion, "C", c.base_scale, 4));
    } catch {
      broken.push(c.id);
    }
  }
  const alone = chords
    .filter(c => !chords.some(o => o.id !== c.id && o.length_bars === c.length_bars && o.base_scale === c.base_scale))
    .map(c => c.id);
  const misfit = chords.filter(c => {
    const L = c.length_bars;
    const fitsSection = L > 0 && (SECTION_BARS % L === 0 || L % SECTION_BARS === 0);
    const filled = Math.max(0, ...c.progression.map(p => p.bar - 1 + p.duration_bars));
    return !fitsSection || filled !== L;
  }).map(c => c.id);
  return { total: chords.length, broken, alone, misfit };
}

// メロディのリズムDB（melody_params.json）のチェック：16ステップで x / - / . だけか、最初の音より前に「-」がないか、
// フレーズ形式が英字だけか
export function melodyParamIssues(): string[] {
  const issues: string[] = [];
  for (const [genre, p] of Object.entries(melodyParams as Record<string, { rhythmPatterns: string[]; chorusRhythmPatterns?: string[]; phraseForms: string[] }>)) {
    for (const r of [...p.rhythmPatterns, ...(p.chorusRhythmPatterns ?? [])]) {
      if (!/^[x.\-]{16}$/.test(r) || !r.includes("x") || /^\.*-/.test(r)) issues.push(`${genre} のリズム "${r}"`);
    }
    for (const f of p.phraseForms) if (!/^[A-Za-z]+$/.test(f)) issues.push(`${genre} のフレーズ形式 "${f}"`);
  }
  return issues;
}

function dataItems(): QualityItem[] {
  const { total, broken, alone, misfit } = chordDBIssues();
  const melody = melodyParamIssues();
  const problems = [
    broken.length > 0 ? `変換できない進行：${broken.join(", ")}` : "",
    misfit.length > 0 ? `長さが8小節のセクションに合わない（またはコードが長さを埋めていない）進行：${misfit.join(", ")}` : "",
    melody.length > 0 ? `書式が違うメロディのパラメータ：${melody.join("、")}` : "",
  ].filter(Boolean);
  return [{
    label: "コード進行DB",
    value: `${total} 件・変換できない進行 ${broken.length} 件・サビの相方がない進行 ${alone.length} 件・長さが合わない進行 ${misfit.length} 件`,
    ok: broken.length === 0 && alone.length === 0 && misfit.length === 0,
    hint: problems.length > 0 ? problems.join("／")
      : "全進行がディグリーから実音にでき、同じ長さ・スケールの相方があり、長さが8小節のセクションに合うか（1・2・4・8 小節かその倍数）",
  }, {
    label: "メロディのリズムDB",
    value: melody.length === 0 ? "問題なし" : `書式が違うもの ${melody.length} 件`,
    ok: melody.length === 0,
    hint: melody.length > 0 ? melody.join("、") : "リズムが16ステップ（x = 発音、- = 伸ばす、. = 休符）で、フレーズ形式が英字だけか",
  }];
}

export function analyzeSong(): QualityItem[] {
  if (!getState().chordPattern) return [];
  const x = songMetrics();
  return [...melodyItems(x), ...formItems(x), ...dataItems()];
}
