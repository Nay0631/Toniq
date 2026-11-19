// ER図の SVG を IDEF1X（astah の ER図）の見た目に直す。
//
// PlantUML の entity は名前を箱の中の見出しに書き、リレーションの端の丸は白い。そこで PlantUML が出した SVG を後から書き換える：
//   - エンティティの箱の上端を、見出しの下の区切り線まで下げ（区切り線は消す）、名前を箱の外の左上に出す
//   - 箱の上から入る線は、下げた上端まで伸ばす（端の黒丸・ひし形・「1」などの印も一緒に動かす）。
//     横から名前の高さに入る線は、箱の中の高さまで下げる。どちらも、黒丸が箱の縁に付くようにするため（IDEF1X の書き方）
//   - 名前は箱の左上に置き、名前とぶつかる上から入る線は、左から来る線なら箱の左の縁から入れ（空いていて、ほかの箱を通らないとき）、
//     そうでなければ黒丸の近くで直角に曲げて名前の右へずらす
//   - 線の名前・多重度の文字が、ほかの線・印・箱・ほかの文字と重なるなら、自分の線の近くの空いている位置へずらす
//   - リレーションの端の丸（PlantUML の 0）を黒丸にする（IDEF1X の子の側の印）
//
// 使い方（リポジトリのルートで）:
//   node docs/基本設計書/tools/er_layout.mjs                    … ER図のフォルダの SVG をすべて
//   node docs/基本設計書/tools/er_layout.mjs <SVG> …            … 指定した SVG だけ
//   node docs/基本設計書/tools/er_layout.mjs --png <フォルダ> [--scale 1.5]
//                                                              … さらに、直した SVG から PNG を作る（docx の代わりの画像。build_docx.ps1 が使う）
// 処理済みの SVG には印（<!--er-layout-->）を付け、もう一度実行しても書き換えない（.puml から作り直した SVG だけ処理する）。

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const MARK = '<!--er-layout-->';

const num = (s, name) => {
  const m = s.match(new RegExp(`\\s${name}="(-?[\\d.]+)"`));
  return m ? +m[1] : null;
};
const setAttr = (s, name, v) => s.replace(new RegExp(`(\\s${name}=")[^"]*(")`), `$1${v}$2`);
const f3 = v => v.toFixed(3);

// エンティティ1つ（<g class="entity" …>…</g>）の箱を、見出しの下の区切り線まで下げる。名前の位置はあとで決める
function fixEntity(g, boxes) {
  const rectM = g.match(/<rect\b[^>]*\/>/);
  const lineM = g.match(/<line\b[^>]*\/>/);
  const textM = g.match(/<text\b[^>]*>[^<]*<\/text>/);
  if (!rectM || !lineM || !textM) return g;
  const rect = rectM[0];
  const x = num(rect, 'x'), y = num(rect, 'y'), w = num(rect, 'width'), h = num(rect, 'height');
  const sepY = num(lineM[0], 'y1');
  const delta = sepY - y;
  if (!(delta > 0 && delta < h)) return g;
  let newRect = setAttr(rect, 'y', f3(sepY));
  newRect = setAttr(newRect, 'height', f3(h - delta));
  const id = boxes.length;
  boxes.push({ x, w, oldTop: y, top: sepY, bottom: y + h, nameLen: num(textM[0], 'textLength') ?? 0 });
  // 名前の x・箱の幅・区切り線の右端はあとで置き換える（印を付けておく。線をよけて箱を広げることがあるため）
  newRect = setAttr(newRect, 'width', `@W${id}@`);
  const newText = setAttr(textM[0], 'x', `@NAME${id}@`);
  return g.replace(rect, newRect).replace(lineM[0], '').replace(textM[0], newText)
    .replace(/<line\b[^>]*\/>/g, l => setAttr(l, 'x2', `@X2_${id}@`));
}

// path の d の座標の組（"x,y"）
const PAIR = /(-?[\d.]+),(-?[\d.]+)/g;
const pairsOf = d => [...d.matchAll(PAIR)].map(m => ({ x: +m[1], y: +m[2] }));
const pairsTo = (d, pts) => {
  let i = -1;
  return d.replace(PAIR, () => { i++; return `${f3(pts[i].x)},${f3(pts[i].y)}`; });
};

// 線の端 p の近くにある印（丸・ひし形・多重度の文字）を dx, dy だけ動かす
function moveMarksNear(g, p, dx, dy) {
  const near = (x, y, r) => Math.abs(x - p.x) <= r && Math.abs(y - p.y) <= r;
  g = g.replace(/<ellipse\b[^>]*\/>/g, e => {
    const cx = num(e, 'cx'), cy = num(e, 'cy');
    return near(cx, cy, 16) ? setAttr(setAttr(e, 'cx', f3(cx + dx)), 'cy', f3(cy + dy)) : e;
  });
  g = g.replace(/<polygon\b[^>]*\/>/g, e => {
    const v = e.match(/points="([^"]*)"/)[1].split(',').map(Number);
    const n = v.length / 2;
    const cx = v.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / n;
    const cy = v.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / n;
    if (!near(cx, cy, 16)) return e;
    const moved = v.map((t, i) => (i % 2 === 0 ? t + dx : t + dy)).join(',');
    return e.replace(/points="[^"]*"/, `points="${moved}"`);
  });
  // 多重度（「1」「P」など。1〜2文字の短い文字）
  g = g.replace(/<text\b[^>]*>[^<]{1,2}<\/text>/g, e => {
    const x = num(e, 'x'), y = num(e, 'y');
    return near(x, y, 26) ? setAttr(setAttr(e, 'x', f3(x + dx)), 'y', f3(y + dy)) : e;
  });
  return g;
}

// 端 end から続く点のうち、cond に合う点の並びの番号
function runFrom(pts, end, cond) {
  const idx = [end];
  const step = end === 0 ? 1 : -1;
  for (let i = end + step; i >= 0 && i < pts.length && cond(pts[i]); i += step) idx.push(i);
  return idx;
}

// リレーション1本の端を、下げた箱の縁につける（上から入る線は伸ばし、横から名前の高さに入る線は下げる）
function snapLink(link, boxes) {
  const { pts } = link;
  for (const end of [0, pts.length - 1]) {
    const p = { ...pts[end] };
    for (const b of boxes) {
      const delta = b.top - b.oldTop;
      const inX = p.x >= b.x - 1 && p.x <= b.x + b.w + 1;
      // 上から入る線（端は元の上端か、印の長さ 12 だけ上）。縦線なので端の点だけ動かす
      if (inX && p.y >= b.oldTop - 14 && p.y <= b.oldTop + 1) {
        pts[end].y += delta;
        link.g = moveMarksNear(link.g, { x: p.x, y: p.y + (p.y < b.oldTop - 6 ? 6 : 0) }, 0, delta);
        // 多重度の文字は黒丸の右上に置く（左だと名前・曲げた線に重なるため）
        link.g = link.g.replace(/<text\b[^>]*>[^<]{1,2}<\/text>/g, e => {
          const x = num(e, 'x'), y = num(e, 'y');
          return Math.abs(x - p.x) <= 26 && Math.abs(y - b.top) <= 30
            ? setAttr(setAttr(e, 'x', f3(p.x + 9)), 'y', f3(b.top - 10)) : e;
        });
        b.tops.push({ link, end });
        break;
      }
      // 横から入る線
      const left = p.x >= b.x - 14 && p.x <= b.x + 1;
      const right = p.x >= b.x + b.w - 1 && p.x <= b.x + b.w + 14;
      if ((left || right) && p.y >= b.oldTop - 1 && p.y <= b.bottom) {
        if (p.y < b.top + 4) {
          // 名前の高さなら箱の中の高さまで下げる（横線の点をまとめて）
          const ny = Math.min(b.top + 12, (b.top + b.bottom) / 2);
          for (const i of runFrom(pts, end, q => Math.abs(q.y - p.y) < 0.01)) pts[i].y = ny;
          link.g = moveMarksNear(link.g, p, 0, ny - p.y);
        }
        if (right) b.rights.push({ link, end });
        if (left) b.lefts.push(pts[end].y);
        break;
      }
    }
  }
}

// 名前（箱の左上）とぶつかる、上から入る線を名前の右へずらす。場所が足りなければ箱を右へ広げる
function clearName(b) {
  const lo = b.x - 8, hi = b.x + b.nameLen + 8;
  const hit = b.tops.filter(t => { const x = t.link.pts[t.end].x; return x >= lo && x <= hi; })
    .filter(t => !toLeftSide(b, t));
  if (!hit.length) return;
  const others = b.tops.filter(t => !hit.includes(t)).map(t => t.link.pts[t.end].x);
  const slots = [];
  for (let s = hi + 18; slots.length < hit.length; s += 20) {
    if (others.every(x => Math.abs(x - s) > 14)) slots.push(s);
  }
  const need = slots[slots.length - 1] + 14 - b.x;
  if (need > b.w) b.widen = need - b.w;
  hit.sort((a, c) => a.link.pts[a.end].x - c.link.pts[c.end].x).forEach((t, k) => {
    const { pts } = t.link;
    const p = { ...pts[t.end] };
    const dx = slots[k] - p.x;
    // 端の近くで直角に曲げて横へずらす（親の側の端は動かさない）。曲げる高さは縦線の長さの半分まで。
    // 右へ行く線ほど高い所で曲げる（同じ高さだと横の線どうしが重なり、低いと左の線の横の線と交わるため）
    const prev = pts[t.end === 0 ? 1 : pts.length - 2];
    const rise = Math.min(24 + 16 * k, Math.max(6, Math.abs(p.y - prev.y) / 2));
    t.link.jog = { end: t.end, dx, rise };
    t.link.g = moveMarksNear(t.link.g, { x: p.x, y: p.y + 6 }, dx, 0);
  });
}

// 処理中の SVG のすべての箱（toLeftSide が、回した線がほかの箱を通らないか調べるのに使う）
let allBoxes = [];

// 名前とぶつかる、左から来て上から入る線を、箱の左の縁から入れる（曲げた縦の線がほかの線の名前を横切らないように）。
// 左の縁に入るほかの線と高さが近いとき・横の線が短いときは何もしない（false。clearName が右へずらす）
function toLeftSide(b, t) {
  const { pts } = t.link;
  const p = { ...pts[t.end] };
  const step = t.end === 0 ? 1 : -1;
  const run = runFrom(pts, t.end, q => Math.abs(q.x - p.x) < 0.01);
  const corner = pts[run[run.length - 1]];
  const q = pts[run[run.length - 1] + step];
  if (!q || Math.abs(q.y - corner.y) > 0.01 || q.x >= p.x) return false;
  const hrun = runFrom(pts, run[run.length - 1], r => Math.abs(r.y - corner.y) < 0.01);
  const startX = Math.min(...hrun.map(i => pts[i].x));
  const X = b.x - 30;
  const Y = Math.min(b.top + 12, (b.top + b.bottom) / 2);
  if (startX > X - 10 || Y - corner.y < 20 || b.lefts.some(y => Math.abs(y - Y) < 16)) return false;
  // 回した縦の線がほかの箱（上に出す名前も）を通るなら回さない
  const through = o => o !== b && X >= o.x - 4 && X <= o.x + o.w + 4 && corner.y <= o.bottom && Y >= o.top - 18;
  if (allBoxes.some(through)) return false;
  for (const i of run) pts[i].x = X;
  pts[t.end].y = Y;
  t.link.side = { end: t.end, x: b.x - 12, y: Y };
  // 黒丸（と多重度の文字）を左の縁へ
  t.link.g = moveMarksNear(t.link.g, { x: p.x, y: p.y + 6 }, b.x - 6 - p.x, Y - (p.y + 6));
  b.lefts.push(Y);
  return true;
}

// 線の d を作り直す（clearName で横にずらした線は、端の近くに直角の曲がりを足す。左の縁へ回した線は横の線を足す）
function linkPath(l) {
  const { pts, jog, side } = l;
  if (side) {
    const s = `${f3(side.x)},${f3(side.y)}`;
    if (side.end === pts.length - 1) return `${pairsTo(l.d, pts)} L${s}`;
    return `M${s} L${pairsTo(l.d, pts).replace(/^M\s*/, '')}`;
  }
  if (!jog) return pairsTo(l.d, pts);
  const p = pts[jog.end];
  const up = p.y - jog.rise; // 端は箱の上なので、曲がりはその少し上
  const x1 = p.x + jog.dx;
  if (jog.end === pts.length - 1) {
    const moved = pts.map((q, i) => (i === jog.end ? { x: q.x, y: up } : q));
    return `${pairsTo(l.d, moved)} L${f3(p.x)},${f3(up)} L${f3(x1)},${f3(up)} L${f3(x1)},${f3(p.y)}`;
  }
  const moved = pts.map((q, i) => (i === 0 ? { x: q.x, y: up } : q));
  const rest = pairsTo(l.d, moved).replace(/^M\s*/, '');
  return `M${f3(x1)},${f3(p.y)} L${f3(x1)},${f3(up)} L${f3(p.x)},${f3(up)} L${rest}`;
}

// 広げた箱の右の縁に入る線を伸ばす
function followWiden(b) {
  if (!b.widen) return;
  for (const t of b.rights) {
    const p = { ...t.link.pts[t.end] };
    t.link.pts[t.end].x += b.widen;
    t.link.g = moveMarksNear(t.link.g, p, b.widen, 0);
  }
}

// ---------- 線の名前・多重度の文字をほかの線・印・箱と重ならない位置へ ----------

const TEXT_RE = /<text\b[^>]*>([^<]*)<\/text>/g;
// 文字の箱（x は左端、y は下の線）
function textRect(e, label) {
  const x = num(e, 'x'), y = num(e, 'y'), fs = num(e, 'font-size') ?? 13;
  const w = num(e, 'textLength') ?? 0.62 * fs * label.length;
  return { x1: x, y1: y - 0.85 * fs, x2: x + w, y2: y + 0.25 * fs };
}
const overlap = (a, b, pad) => a.x1 - pad < b.x2 && b.x1 - pad < a.x2 && a.y1 - pad < b.y2 && b.y1 - pad < a.y2;
const shift = (r, dx, dy) => ({ x1: r.x1 + dx, y1: r.y1 + dy, x2: r.x2 + dx, y2: r.y2 + dy });
// 点と箱の距離
const distTo = (r, p) => Math.hypot(Math.max(r.x1 - p.x, 0, p.x - r.x2), Math.max(r.y1 - p.y, 0, p.y - r.y2));
// 線（d の点の並び。直交の線なので制御点も線の上にある）を線分の箱に
function segRects(d) {
  const pts = pairsOf(d);
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i];
    if (a.x === c.x && a.y === c.y) continue;
    out.push({ x1: Math.min(a.x, c.x), y1: Math.min(a.y, c.y), x2: Math.max(a.x, c.x), y2: Math.max(a.y, c.y), a, c });
  }
  return out;
}
// 線分の上の、点 p にいちばん近い点との距離
const distSeg = (s, p) => Math.hypot(Math.max(s.x1 - p.x, 0, p.x - s.x2), Math.max(s.y1 - p.y, 0, p.y - s.y2));
const rectToSeg = (r, s) => {
  const dx = Math.max(s.x1 - r.x2, 0, r.x1 - s.x2), dy = Math.max(s.y1 - r.y2, 0, r.y1 - s.y2);
  return Math.hypot(dx, dy);
};

function placeTexts(links, boxes) {
  const all = links.map(l => ({ l, segs: segRects(l.final) }));
  // 印（黒丸・ひし形）
  const marks = [];
  for (const l of links) {
    for (const e of l.g.match(/<ellipse\b[^>]*\/>/g) ?? []) {
      const cx = num(e, 'cx'), cy = num(e, 'cy');
      marks.push({ x1: cx - 6, y1: cy - 6, x2: cx + 6, y2: cy + 6 });
    }
    for (const e of l.g.match(/<polygon\b[^>]*\/>/g) ?? []) {
      const v = e.match(/points="([^"]*)"/)[1].split(',').map(Number);
      const xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2 === 1);
      marks.push({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
    }
  }
  // 箱と、箱の上に出す名前
  const areas = boxes.flatMap(b => [
    { x1: b.x, y1: b.top, x2: b.x + b.w + (b.widen ?? 0), y2: b.bottom },
    { x1: b.x, y1: b.top - 18, x2: b.x + b.nameLen, y2: b.top },
  ]);
  // 置いた文字（あとの文字はこれと重ねない）。先に全部の文字を入れ、動かすときに入れ替える
  const texts = [];
  for (const { l } of all) {
    for (const m of l.g.matchAll(TEXT_RE)) texts.push({ l, e: m[0], r: textRect(m[0], m[1]), mult: m[1].length <= 2 });
  }
  const PAD = 2;
  const blocked = (t, r) =>
    // 線の名前は自分の線に触れてよい（横切らなければよい）
    all.some(({ l, segs }) => segs.some(s => overlap(r, s, t.mult || l !== t.l ? PAD : -0.5))) ||
    marks.some(m => overlap(r, m, t.mult ? 1 : PAD)) ||
    areas.some(a => overlap(r, a, PAD)) ||
    texts.some(o => o !== t && overlap(r, o.r, PAD));
  // 自分の線から離れすぎない（線の名前は線から 12 まで、多重度の文字は線の端から 22 まで）
  const own = t => all.find(a => a.l === t.l).segs;
  const attached = (t, r) => {
    const segs = own(t);
    if (!t.mult) return segs.some(s => rectToSeg(r, s) <= 12);
    const ends = [segs[0].a, segs[segs.length - 1].c];
    return ends.some(p => distTo(r, p) <= 22);
  };
  const cands = [];
  for (let dx = -300; dx <= 300; dx += 2) for (let dy = -40; dy <= 40; dy += 2) cands.push([dx, dy]);
  cands.sort((a, c) => Math.abs(a[0]) + 1.5 * Math.abs(a[1]) - (Math.abs(c[0]) + 1.5 * Math.abs(c[1])));
  for (const t of texts) {
    if (!blocked(t, t.r)) continue;
    const found = cands.find(([dx, dy]) => { const r = shift(t.r, dx, dy); return attached(t, r) && !blocked(t, r); });
    if (!found) continue;
    const [dx, dy] = found;
    const moved = setAttr(setAttr(t.e, 'x', f3(num(t.e, 'x') + dx)), 'y', f3(num(t.e, 'y') + dy));
    t.l.g = t.l.g.replace(t.e, moved);
    t.e = moved;
    t.r = shift(t.r, dx, dy);
  }
}

// 名前を置く x（箱の左端。名前とぶつかる線は clearName で右へずらしてある）
function placeName(b) {
  return b.x;
}

export function processSvg(svg) {
  if (svg.includes(MARK)) return { svg, changed: false };
  const boxes = [];
  let out = svg.replace(/<g class="entity"[\s\S]*?<\/g>/g, g => fixEntity(g, boxes));
  for (const b of boxes) { b.tops = []; b.rights = []; b.lefts = []; }
  allBoxes = boxes;
  const links = [];
  out = out.replace(/<g class="link"[\s\S]*?<\/g>/g, g => {
    const m = g.match(/<path\b[^>]*\sd="([^"]*)"[^>]*\/>/);
    if (!m) return g;
    links.push({ g, d: m[1], pts: pairsOf(m[1]) });
    return `@LINK${links.length - 1}@`;
  });
  for (const l of links) if (l.pts.length >= 2) snapLink(l, boxes);
  for (const b of boxes) { clearName(b); followWiden(b); }
  for (const l of links) l.final = linkPath(l);
  placeTexts(links, boxes);
  links.forEach((l, i) => { out = out.replace(`@LINK${i}@`, l.g.replace(l.d, l.final)); });
  boxes.forEach((b, i) => {
    out = out.replace(`@NAME${i}@`, f3(placeName(b)));
    out = out.replace(`@W${i}@`, f3(b.w + (b.widen ?? 0)));
    out = out.split(`@X2_${i}@`).join(f3(b.x + b.w + (b.widen ?? 0) - 1));
  });
  // 広げた箱が図の右端からはみ出すなら、図を広げる
  const right = Math.max(...boxes.map(b => b.x + b.w + (b.widen ?? 0))) + 10;
  const svgW = +out.match(/<svg\b[^>]*\swidth="([\d.]+)px"/)[1];
  if (right > svgW) {
    const w = Math.ceil(right);
    out = out.replace(/<svg\b[^>]*>/, tag => tag
      .replace(/width="[\d.]+px"/, `width="${w}px"`)
      .replace(/width:[\d.]+px/, `width:${w}px`)
      .replace(/viewBox="0 0 [\d.]+ /, `viewBox="0 0 ${w} `));
  }
  // リレーションの端の丸を黒丸に
  out = out.replace(/<g class="link"[\s\S]*?<\/g>/g, g => g.replace(/(<ellipse\b[^>]*\sfill=")#F+(")/gi, '$1#000000$2'));
  out = out.replace(/(<svg\b[^>]*>)/, `$1${MARK}`);
  return { svg: out, changed: true };
}

// ---------- PNG（docx の代わりの画像。robustness_labels.mjs と同じ作り方） ----------

function findBrowser() {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return cands.find(p => existsSync(p)) || null;
}
function svgToPng(browser, svgPath, pngPath, scale) {
  const s = readFileSync(svgPath, 'utf8');
  const w = Math.ceil(+s.match(/width="([\d.]+)px"/)[1]), h = Math.ceil(+s.match(/height="([\d.]+)px"/)[1]);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`,
    `--window-size=${w},${h}`, `--screenshot=${pngPath}`, pathToFileURL(svgPath).href], { stdio: 'ignore', timeout: 120000 });
  if (!existsSync(pngPath)) throw new Error('PNG ができなかった');
}

// ---------- 実行 ----------

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let files = process.argv.slice(2);
  let pngDir = null, scale = 1.5;
  const pi = files.indexOf('--png');
  if (pi >= 0) { pngDir = files[pi + 1]; files.splice(pi, 2); }
  const si = files.indexOf('--scale');
  if (si >= 0) { scale = +files[si + 1]; files.splice(si, 2); }
  if (!files.length) {
    const dir = join(here, '..', '図', 'ER図');
    files = readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => join(dir, f));
  }
  let changed = 0;
  for (const f of files) {
    const r = processSvg(readFileSync(f, 'utf8'));
    if (r.changed) { writeFileSync(f, r.svg); changed++; }
  }
  console.log(`ER図を直した: ${changed} 枚（処理済みで変えなかった: ${files.length - changed} 枚）`);
  if (pngDir) {
    const browser = findBrowser();
    if (!browser) {
      console.log('Edge・Chrome が見つからないので、ER図の PNG は PlantUML のまま（名前の位置・丸の色が SVG と違う）');
    } else {
      mkdirSync(pngDir, { recursive: true });
      for (const f of files) svgToPng(browser, f, join(pngDir, basename(f).replace(/\.svg$/, '.png')), scale);
      console.log(`ER図の PNG を SVG から作った: ${files.length} 枚`);
    }
  }
}
