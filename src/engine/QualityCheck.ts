import { getState } from "./AppState";
import { ChordProgression } from "../data/types";
import { resolveChord, NOTE_INDEX } from "../data/degree_resolver";
import { noteToMidi, timeToUnits, durationToUnits } from "./MelodyGenerator";
import { getArrangement, findBlock, LAYERS } from "./LoopArranger";
import { chorusProgression, endingBar, getSections, isFillBar, loopBars, songMelody, songProgression } from "./SongForm";
import chordDB from "../data/chord_progressions.json";

// 自動チェック：今の曲を規則で調べ、作曲のよくある弱点（強拍でコードとぶつかる、言い切らずに終わる、
// 大きく跳ぶ、サビが盛り上がらない、ずっと同じ編成 など）を数字で出す。アレンジャーのテスト中の機能の欄に表示する

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

function melodyItems(): QualityItem[] {
  const s = getState();
  const song = songProgression();
  const notes = melodyNotes();
  if (!song || notes.length === 0) {
    return [{ label: "メロディ", value: "未作成（自動生成すると調べます）", ok: null, hint: "メロディを作るとチェックします" }];
  }
  const items: QualityItem[] = [];
  const tonic = NOTE_INDEX[s.key] ?? 0;

  // 強拍（1拍目・3拍目の頭）の音がコード構成音か
  const strong = notes.filter(n => n.start % 8 === 0);
  const fit = strong.filter(n => chordAt(song, s.key, n.start).includes(n.midi % 12)).length;
  items.push({
    label: "強拍のコード構成音",
    value: `${pct(fit, strong.length)}（${fit} / ${strong.length} 音）`,
    ok: strong.length === 0 ? null : fit / strong.length >= 0.75,
    hint: "1拍目・3拍目の頭の音がコードの音だと、メロディとコードがぶつからずに聞こえます（75% 以上が目安）",
  });

  // 周回（フレーズ）の終わりの音：主音か、そのときのコードの構成音か
  const L = loopBars() * 16;
  const loops = getSections().length;
  let tonicEnd = 0, chordEnd = 0, phrases = 0;
  for (let i = 0; i < loops; i++) {
    const inLoop = notes.filter(n => n.start >= i * L && n.start < (i + 1) * L);
    const last = inLoop[inLoop.length - 1];
    if (!last) continue;
    phrases++;
    if (last.midi % 12 === tonic) tonicEnd++;
    else if (chordAt(song, s.key, last.start).includes(last.midi % 12)) chordEnd++;
  }
  items.push({
    label: "フレーズの終わり",
    value: `主音 ${tonicEnd}・構成音 ${chordEnd} / ${phrases} 周`,
    ok: phrases === 0 ? null : tonicEnd + chordEnd === phrases && tonicEnd > 0,
    hint: "コード進行1周の最後の音が主音（またはコードの音）だと「言い切った」感じになります",
  });

  // 最大の跳躍（休符をはさまずに続く、となりの音との高さの差。1拍以上の休符のあとは息つぎなので数えない）
  let maxLeap = 0;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].start - notes[i - 1].end >= 4) continue;
    maxLeap = Math.max(maxLeap, Math.abs(notes[i].midi - notes[i - 1].midi));
  }
  items.push({
    label: "最大の跳躍",
    value: `${maxLeap} 半音`,
    ok: maxLeap <= 9,
    hint: "続けて歌う音の差が大きすぎると歌いにくいメロディになります（9 半音 = 長6度以内が目安。休符のあとは数えない）",
  });

  // サビの高さ：サビの平均の高さが Aメロより高いか
  const sections = getSections();
  const sectionOf = (n: SongNote) => sections[Math.floor(n.start / L)] ?? "A";
  const avg = (list: SongNote[]) => list.reduce((sum, n) => sum + n.midi, 0) / Math.max(1, list.length);
  const a = notes.filter(n => sectionOf(n) === "A"), b = notes.filter(n => sectionOf(n) === "B");
  const diff = avg(b) - avg(a);
  items.push({
    label: "サビの高さ",
    value: a.length === 0 || b.length === 0 ? "Aメロかサビの片方だけです" : `Aメロより ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} 半音`,
    ok: a.length === 0 || b.length === 0 ? null : diff > 0,
    hint: "サビのメロディが Aメロより高いと、サビで盛り上がって聞こえます",
  });
  return items;
}

function formItems(): QualityItem[] {
  const s = getState();
  const items: QualityItem[] = [];
  const sections = getSections();
  const chorus = chorusProgression();
  const bCount = sections.filter(x => x === "B").length;
  items.push({
    label: "セクション",
    value: `Aメロ ${sections.length - bCount} 周・サビ ${bCount} 周（サビの進行：${chorus ? chorus.name : "Aメロと同じ"}）`,
    ok: bCount > 0 && chorus !== null,
    hint: "サビで別のコード進行に切り替わると、曲に展開が生まれます",
  });

  // アレンジの抜き差し：鳴っている（ON の）パートが前の小節より減る所があるか（ブレイク・サビ前の空白）
  const arrangement = getArrangement();
  const partsAt = (bar: number) => LAYERS.filter(p => s.parts[p] && findBlock(arrangement[p], bar));
  let drops = 0;
  for (let bar = 1; bar < s.bars; bar++) {
    const now = partsAt(bar);
    if (partsAt(bar - 1).some(p => !now.includes(p))) drops++;
  }
  items.push({
    label: "アレンジの抜き差し",
    value: `パートが抜ける所 ${drops} か所`,
    ok: sections.length < 3 ? null : drops > 0,
    hint: "足すだけでなく、ブレイクやサビ前の空白でパートを抜く所があると、次の盛り上がりが引き立ちます（OFF のパートは数えない）",
  });

  let fills = 0;
  for (let bar = 0; bar < s.bars; bar++) if (isFillBar(bar)) fills++;
  items.push({
    label: "エンディング・フィル",
    value: `エンディング ${endingBar() !== null ? "あり" : "なし"}・フィル ${fills} 回`,
    ok: null,
    hint: "テスト中の機能の ON/OFF で変わります",
  });
  return items;
}

// コード進行DBのチェック：すべての進行がディグリーから実音にできるか、サビに使える相方（同じ長さ・スケール）があるか
function dataItems(): QualityItem[] {
  const chords = chordDB as unknown as ChordProgression[];
  const broken: string[] = [];
  for (const c of chords) {
    try {
      c.progression.forEach(d => resolveChord(d.degree, d.type, d.inversion, "C", c.base_scale, 4));
    } catch {
      broken.push(c.id);
    }
  }
  const alone = chords.filter(c =>
    !chords.some(o => o.id !== c.id && o.length_bars === c.length_bars && o.base_scale === c.base_scale));
  return [{
    label: "コード進行DB",
    value: `${chords.length} 件・変換できない進行 ${broken.length} 件・サビの相方がない進行 ${alone.length} 件`,
    ok: broken.length === 0 && alone.length === 0,
    hint: broken.length > 0 ? `変換できない進行：${broken.join(", ")}` : "全進行がディグリーから実音にでき、同じ長さ・スケールの相方があるか",
  }];
}

export function analyzeSong(): QualityItem[] {
  if (!getState().chordPattern) return [];
  return [...melodyItems(), ...formItems(), ...dataItems()];
}
