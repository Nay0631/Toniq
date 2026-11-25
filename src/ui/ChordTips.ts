import type { ChordProgression } from "../data/types";
import { resolveChord } from "../data/degree_resolver";
import { CHORD_SUFFIX, SCALE_LABELS, displayNote, toDoremi } from "./format";
import { TERMS } from "./Glossary";

// シンプルモードの生成後の画面に出すコード名・キー（スケール）の説明（用語のツールチップ。Glossary.ts の data-tip）。
// 「Am」「F」などの文字が何を表すかを、初心者向けにその曲のコードごとに組み立てる

// コードの種類ごとの、名前の後ろの記号の意味と響き
const TYPE_TIPS: Record<string, { reading: string; desc: string }> = {
  major: { reading: "メジャー",              desc: "記号の付かないコードはメジャーコードで、明るくはっきりした響きです。" },
  minor: { reading: "マイナー",              desc: "後ろの「m」はマイナーの印で、暗く切ない響きになります。" },
  dim:   { reading: "ディミニッシュ",        desc: "「dim」はディミニッシュの印で、不安定で緊張感のある響きです。" },
  aug:   { reading: "オーギュメント",        desc: "「aug」はオーギュメントの印で、ふわっと浮いた不思議な響きです。" },
  maj7:  { reading: "メジャーセブンス",      desc: "「maj7」はメジャーセブンスの印で、明るい和音に1音足した、おしゃれでやわらかい響きです。" },
  min7:  { reading: "マイナーセブンス",      desc: "「m7」はマイナーセブンスの印で、マイナーに1音足した、落ち着いたおしゃれな響きです。" },
  dom7:  { reading: "セブンス",              desc: "「7」はセブンスの印で、明るい和音に少しにごる音を足した、次のコードへ進みたくなる響きです。" },
  maj9:  { reading: "メジャーナインス",      desc: "「maj9」は、maj7 にさらに高い音（9度）を足した印で、キラッと広がる響きです。" },
  min9:  { reading: "マイナーナインス",      desc: "「m9」は、m7 にさらに高い音（9度）を足した印で、しっとり広がる響きです。" },
  dom9:  { reading: "ナインス",              desc: "「9」は、セブンスにさらに高い音（9度）を足した印で、明るく厚みのある響きです。" },
  add9:  { reading: "アドナインス",          desc: "「add9」は、明るい和音に高い音（9度）を足した印で、すっきり透明な響きです。" },
  sus2:  { reading: "サスツー",              desc: "「sus2」は、明るさ・暗さを決める音の代わりに2番目の音を使った印で、どちらでもない、すっきりした響きです。" },
  sus4:  { reading: "サスフォー",            desc: "「sus4」は、明るさ・暗さを決める音の代わりに4番目の音を使った印で、宙に浮いて先へ進みたくなる響きです。" },
  aug7:  { reading: "オーギュメントセブンス", desc: "「aug7」は、オーギュメントにセブンスの音を足した印で、ふしぎで不安定な響きです。" },
};

// ディグリー（I・IV・V など）の役割。よく使う3つだけ説明する（それ以外は書かない）
function degreeRole(degree: string): string {
  const numeral = degree.replace(/^[b#]+/, "").replace(/m$/, "");
  if (degree.startsWith("b") || degree.startsWith("#")) return "";
  if (numeral === "I")  return "この曲のキーの「家」にあたるコード（主和音）で、鳴ると落ち着いた感じになります。";
  if (numeral === "IV") return "家から一歩離れた、広がりのあるコードです。";
  if (numeral === "V")  return "家（主和音）に戻りたくなる力が強いコードで、区切りの前によく使います。";
  return "";
}

// 音名（"A" など）の読み。ドレミ表記なら「A（ラ）」、CDE 表記ならそのまま
function readNote(note: string): string {
  const doremi = toDoremi(note);
  return doremi !== note ? `${note}（${doremi}）` : note;
}

// コード1つの説明（見出しと本文）
export function chordTip(
  degree: string, type: string, key: string, scale: string,
): { name: string; title: string; desc: string } {
  const chord = resolveChord(degree, type, 0, key, scale);
  const name  = chord.root + (CHORD_SUFFIX[type] ?? "");
  const tip   = TYPE_TIPS[type];
  const notes = chord.notes.map(n => displayNote(n.replace(/-?\d+$/, ""))).join("・");
  const desc = [
    `アルファベットは和音の土台になる音（ルート音）の名前で、${readNote(chord.root)} を土台にして ${notes} を同時に鳴らす和音です。`,
    tip?.desc ?? "",
    degreeRole(degree),
  ].filter(Boolean).join("");
  return { name, title: tip ? `${name}（${chord.root} ${tip.reading}）` : name, desc };
}

function tipSpan(text: string, title: string, desc: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = text;
  span.dataset.tipTitle = title;
  span.dataset.tip = desc;
  span.tabIndex = 0;  // キーボードでもフォーカスして説明を出せるように
  return span;
}

// コード進行のコード名を、1つずつ説明の付いた span にして並べる（例：F - G - Em - Am）
export function chordNameSpans(pattern: ChordProgression, key: string): Node[] {
  const nodes: Node[] = [];
  pattern.progression.forEach((c, i) => {
    if (i > 0) nodes.push(document.createTextNode(" - "));
    const tip = chordTip(c.degree, c.type, key, pattern.base_scale);
    nodes.push(tipSpan(tip.name, tip.title, tip.desc));
  });
  return nodes;
}

// キーとスケール（例：A ナチュラルマイナー）を、説明の付いた span にする
export function keyScaleSpan(key: string, scale: string): HTMLSpanElement {
  const label = SCALE_LABELS[scale] ?? scale;
  const term  = TERMS[`scale.${scale}`];
  const desc = [
    `${readNote(key)} の音を中心（主音）にした「${label}」のスケールで、この曲のメロディやコードはこのスケールの音で作られています。`,
    term?.desc ?? "",
  ].filter(Boolean).join("");
  return tipSpan(`${key} ${label}`, `${key} ${label}`, desc);
}
