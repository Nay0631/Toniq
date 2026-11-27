// PlantUML で作った SVG の、文字と線・文字どうしの重なりを数える（画面遷移図・システム図の確認用）。
// SVG は変えない。重なりがあれば文字と位置を出し、終了コード 1 で終わる。
//   node docs/基本設計書/tools/label_overlap.mjs <SVG> [<SVG> …] [--margin 3]
// ・文字の先頭の全角の空白（線と文の間のすき間に入れたもの）は文字の幅に数えない。
// ・線は黒の線（style="stroke:#000"）だけを見る。画面の枠・図の外枠は数えない。
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
let margin = 3;
const mi = args.indexOf('--margin');
if (mi >= 0) { margin = +args[mi + 1]; args.splice(mi, 2); }
if (!args.length) { console.error('使い方: node label_overlap.mjs <SVG> [--margin 3]'); process.exit(2); }

const attr = (t, k) => { const m = t.match(new RegExp(' ' + k + '="([^"]+)"')); return m ? +m[1] : NaN; };

let total = 0;
for (const file of args) {
  const s = readFileSync(file, 'utf8');
  const M = margin;
  // 文字の箱（x・y は文字の左下の基準線、高さはフォントの大きさ）。
  // 線に沿って傾けた文（<g transform="rotate(角度 cx cy)"> の中。state_layout.mjs が作る）は、その傾きも持つ
  const readTexts = (str, rot) => [...str.matchAll(/<text([^>]*)>([^<]*)</g)]
    .map(m => ({ fs: attr(m[1], 'font-size'), w: attr(m[1], 'textLength'), x: attr(m[1], 'x'), y: attr(m[1], 'y'), t: m[2], rot }))
    .filter(o => o.w > 0)
    .map(o => ({ ...o, x0: o.x + (o.t.startsWith('　') ? o.fs : 0) - M, x1: o.x + o.w + M, y0: o.y - o.fs + 1 - M, y1: o.y + 3 + M }));
  const ROT = /<g transform="rotate\(([-0-9.]+) ([-0-9.]+) ([-0-9.]+)\)">(.*?)<\/g>/g;
  const texts = [...readTexts(s.replace(ROT, ''), null),
    ...[...s.matchAll(ROT)].flatMap(m => readTexts(m[4], { a: +m[1] * Math.PI / 180, cx: +m[2], cy: +m[3] }))];
  // 点を文の傾きを戻した座標にする
  const local = (t, [x, y]) => {
    if (!t.rot) return [x, y];
    const { a, cx, cy } = t.rot, dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) + dy * Math.sin(a), cy - dx * Math.sin(a) + dy * Math.cos(a)];
  };
  const world = (t, [x, y]) => {
    if (!t.rot) return [x, y];
    const { a, cx, cy } = t.rot, dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  const inBox = (t, p, shrink = 0) => { const [x, y] = local(t, p); return x > t.x0 + shrink && x < t.x1 - shrink && y > t.y0 + shrink && y < t.y1 - shrink; };
  // 文字の箱（余白 M を除いたもの）の上の点
  const gridOf = t => { const pts = []; for (let k = 0; k <= 8; k++) for (let j = 0; j <= 2; j++) pts.push(world(t, [t.x0 + M + (t.x1 - t.x0 - 2 * M) * k / 8, t.y0 + M + (t.y1 - t.y0 - 2 * M) * j / 2])); return pts; };
  // 線（矢印の線と矢じり）を短い線分に分ける
  const segs = [];
  for (const m of s.matchAll(/<path d="([^"]+)" style="stroke:#000/g)) {
    const pts = [...m[1].matchAll(/(-?[0-9.]+),(-?[0-9.]+)/g)].map(p => [+p[1], +p[2]]);
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  }
  for (const m of s.matchAll(/<line[^>]*x1="([0-9.]+)" x2="([0-9.]+)" y1="([0-9.]+)" y2="([0-9.]+)"[^>]*stroke:#000/g)) {
    segs.push([[+m[1], +m[3]], [+m[2], +m[4]]]);
  }
  const hit = (b, [a, c]) => {
    for (let k = 0; k <= 50; k++) {
      if (inBox(b, [a[0] + (c[0] - a[0]) * k / 50, a[1] + (c[1] - a[1]) * k / 50])) return true;
    }
    return false;
  };
  let n = 0;
  for (const t of texts) {
    if (segs.some(g => hit(t, g))) { console.log(`  線と重なる: ${t.t.trim()}（x=${Math.round(t.x)}, y=${Math.round(t.y)}）`); n++; }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (gridOf(a).some(p => inBox(b, p, M)) || gridOf(b).some(p => inBox(a, p, M))) {
      console.log(`  文字どうし: ${a.t.trim()} ／ ${b.t.trim()}`); n++;
    }
  }
  console.log(`${file}: 重なり ${n} 件`);
  total += n;
}
process.exit(total ? 1 : 0);
