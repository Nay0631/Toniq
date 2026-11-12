// ロバストネス図の SVG の線のラベル（矢印の文）を、その矢印のすぐ上に、矢印と平行に置き直す。
//
// PlantUML（Graphviz）は線のラベルを線から離れた所に置くので、どの矢印の文かが分かりにくい。
// そこで PlantUML が出した SVG を後から書き換える：
//   - 矢印の線の形をたどり、文の幅ぶんがほぼまっすぐな区間を探して、その区間と平行に、線のすぐ上に文を置く
//     （文字が逆さにならないよう、向きは -90°〜90° にそろえる。左向きの矢印でも文は左から右へ読める）
//   - 置き場所の候補を線に沿ってずらしながら、ほかの文・ほかの線・アイコンと名前に重ならない所を選ぶ
//     （線の上のどこにも置けないときだけ、線の下に置く）
//   - 文の後ろに白い四角を敷き、万一ほかの線が近くを通っても文字が読めるようにする
//   - 自己ループ（同じ処理への矢印）の文は PlantUML の位置のまま（ループの上に出ている）
//
// 使い方（リポジトリのルートで）:
//   node docs/基本設計書/tools/robustness_labels.mjs            … ロバストネス図のフォルダの SVG をすべて
//   node docs/基本設計書/tools/robustness_labels.mjs <SVG> …    … 指定した SVG だけ
//   node docs/基本設計書/tools/robustness_labels.mjs --png <フォルダ> [--scale 1.5]
//                                                              … さらに、置き直した SVG から PNG を作る（docx の代わりの画像。build_docx.ps1 が使う。
//                                                                Edge か Chrome のヘッドレスで描く。1.5 倍 = 144dpi）
// 処理済みの SVG には印（<!--robustness-labels-->）を付け、もう一度実行しても書き換えない（.puml から作り直した SVG だけ処理する）。
// 重なりが残った図は「重なり」として件数を出し、終了コード 1 にする。

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const MARK = '<!--robustness-labels-->';
const GAP = 3;          // 線と文（いちばん下の行の下端）のすき間
const LINE_GAP = 1.25;  // 行の高さ（文字の大きさの倍率）
const STEP = 6;         // 候補をずらす間隔（px）

// ---------- 幾何 ----------

// path の d（M / L / C の絶対座標。PlantUML が出す形）を折れ線の点にする
function pathPoints(d) {
  const tok = d.match(/[MLCmlc]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const pts = [];
  let i = 0, cmd = 'M', cur = [0, 0];
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'M' || cmd === 'L') {
      cur = [num(), num()];
      pts.push(cur);
    } else if (cmd === 'C') {
      const p0 = cur, p1 = [num(), num()], p2 = [num(), num()], p3 = [num(), num()];
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        pts.push([
          u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
      cur = p3;
    } else {
      i++;
    }
  }
  return pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 0.01);
}

// 折れ線を間隔 step で細かく区切った点（重なりの判定用）
function densify(pts, step = 3) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let j = 0; j < n; j++) out.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

// 折れ線上の、始点からの長さ s の点
function cumLengths(pts) {
  const c = [0];
  for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return c;
}
function pointAt(pts, cum, s) {
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let k = 1;
  while (k < cum.length - 1 && cum[k] < s) k++;
  const seg = cum[k] - cum[k - 1] || 1, t = (s - cum[k - 1]) / seg;
  return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
}

// 回転した四角（中心 c、向き d、上向き n、u ∈ [u0,u1]、v ∈ [v0,v1]）の4つの角
function quad(c, d, n, u0, u1, v0, v1) {
  const P = (u, v) => [c[0] + d[0] * u + n[0] * v, c[1] + d[1] * u + n[1] * v];
  return [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
}
function inQuad(q, p) {
  // 凸四角形の内側か（辺の向きの外積の符号がそろうか）
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}
// 2つの凸多角形が重なるか（分離軸）
function polysOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      const ax = [q[1] - p[1], p[0] - q[0]];
      const proj = (P) => P.map(v => v[0] * ax[0] + v[1] * ax[1]);
      const pa = proj(a), pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}
const boxPoly = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];

// ---------- SVG の読み取り ----------

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// 要素（ellipse / text / path / polygon）の外接四角
function elementBox(xml) {
  const xs = [], ys = [];
  for (const m of xml.matchAll(/<ellipse[^>]*>/g)) {
    const cx = +attr(m[0], 'cx'), cy = +attr(m[0], 'cy'), rx = +attr(m[0], 'rx'), ry = +attr(m[0], 'ry');
    xs.push(cx - rx, cx + rx); ys.push(cy - ry, cy + ry);
  }
  for (const m of xml.matchAll(/<text[^>]*>/g)) {
    const x = +attr(m[0], 'x'), y = +attr(m[0], 'y'), w = +attr(m[0], 'textLength'), fs = +attr(m[0], 'font-size');
    xs.push(x, x + w); ys.push(y - fs, y + fs * 0.25);
  }
  for (const m of xml.matchAll(/<path[^>]*\sd="([^"]*)"/g)) {
    for (const p of pathPoints(m[1])) { xs.push(p[0]); ys.push(p[1]); }
  }
  for (const m of xml.matchAll(/<polygon[^>]*\spoints="([^"]*)"/g)) {
    const v = m[1].split(/[ ,]+/).map(Number);
    for (let k = 0; k + 1 < v.length; k += 2) { xs.push(v[k]); ys.push(v[k + 1]); }
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function parse(svg) {
  const view = svg.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);
  // 図の枠（mainframe）の内側。2つ目の rect が枠
  const rects = [...svg.matchAll(/<rect[^>]*>/g)].map(m => m[0]);
  const fr = rects[1] || rects[0];
  const frame = { x0: +attr(fr, 'x'), y0: +attr(fr, 'y') + 26, x1: +attr(fr, 'x') + +attr(fr, 'width'), y1: +attr(fr, 'y') + +attr(fr, 'height') };

  const nodes = [];
  for (const m of svg.matchAll(/<g class="entity"[^>]*>([\s\S]*?)<\/g>/g)) {
    const b = elementBox(m[1]);
    if (b) nodes.push({ x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 });
  }

  const links = [];
  for (const m of svg.matchAll(/<g class="link"([^>]*)>([\s\S]*?)<\/g>/g)) {
    const head = m[1], body = m[2];
    const d = body.match(/<path[^>]*\sd="([^"]*)"/)[1];
    const pts = pathPoints(d);
    const arrow = [];
    for (const pm of body.matchAll(/<polygon[^>]*\spoints="([^"]*)"/g)) {
      const v = pm[1].split(/[ ,]+/).map(Number);
      for (let k = 0; k + 1 < v.length; k += 2) arrow.push([v[k], v[k + 1]]);
    }
    const texts = [...body.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)].map(t => ({
      raw: t[0], attrs: t[1], content: t[2],
      x: +attr(t[0], 'x'), y: +attr(t[0], 'y'), fs: +attr(t[0], 'font-size'), w: +attr(t[0], 'textLength'),
    }));
    links.push({
      full: m[0], head, body, pts, dense: densify(pts).concat(arrow),
      self: attr(head, 'data-entity-1') === attr(head, 'data-entity-2'),
      texts,
    });
  }
  return { view, frame, nodes, links };
}

// ---------- 置き場所を決める ----------

function labelBox(texts) {
  const fs = Math.max(...texts.map(t => t.fs));
  const lh = fs * LINE_GAP;
  const w = Math.max(...texts.map(t => t.w));
  const h = (texts.length - 1) * lh + fs * 1.05;
  return { fs, lh, w, h };
}

function candidates(link, size) {
  const { pts } = link;
  const cum = cumLengths(pts);
  const L = cum[cum.length - 1];
  const half = size.w / 2 + 4;
  const out = [];
  // 両端（アイコンの近く）は避け、線に沿って STEP ごとにずらす
  const margin = Math.min(L / 2, 18);
  for (let s = margin; s <= L - margin + 0.01; s += STEP) {
    const a = pointAt(pts, cum, s - half), b = pointAt(pts, cum, s + half);
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    dx /= len; dy /= len;
    if (dx < -1e-6 || (Math.abs(dx) < 1e-6 && dy < 0)) { dx = -dx; dy = -dy; } // 文字が逆さにならない向き
    const d = [dx, dy];
    // 区間の中ほどの線の点（弦の中点でなく線の上の点を基準にする）
    const mid = pointAt(pts, cum, s);
    // 区間のまっすぐさ：区間の中の線の点が、弦からどれだけ離れるか
    let dev = 0;
    for (let t = s - half; t <= s + half; t += 3) {
      const p = pointAt(pts, cum, t);
      const off = (p[0] - mid[0]) * -d[1] + (p[1] - mid[1]) * d[0];
      dev = Math.max(dev, Math.abs(off));
    }
    for (const side of [1, -1]) {
      const n = side === 1 ? [d[1], -d[0]] : [-d[1], d[0]]; // 1 = 上（画面の上側）
      // 線が区間の中で上に膨らんでいても文に触れないよう、膨らみの分だけ離す
      let bulge = 0;
      for (let t = s - half; t <= s + half; t += 3) {
        const p = pointAt(pts, cum, t);
        bulge = Math.max(bulge, (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1]);
      }
      out.push({ c: mid, d, n, side, v0: GAP + bulge, dev, center: Math.abs(s - L / 2) / L });
    }
  }
  return out;
}

function score(cand, size, link, ctx) {
  const q = quad(cand.c, cand.d, cand.n, -size.w / 2 - 2, size.w / 2 + 2, cand.v0 - 1, cand.v0 + size.h + 1);
  let bad = 0;
  for (const p of q) {
    if (p[0] < ctx.frame.x0 + 2 || p[0] > ctx.frame.x1 - 2 || p[1] < ctx.frame.y0 || p[1] > ctx.frame.y1 - 2) bad += 1;
  }
  for (const nb of ctx.nodes) if (polysOverlap(q, boxPoly(nb))) bad += 1;
  for (const pq of ctx.placed) if (polysOverlap(q, pq)) bad += 1;
  for (const pq of ctx.fixed) if (polysOverlap(q, pq)) bad += 1;
  let hits = 0;
  for (const other of ctx.links) {
    for (const p of other.dense) if (inQuad(q, p)) hits++;
  }
  bad += Math.ceil(hits / 3);
  // 重なりがいちばん重い。次に線の下に置くこと、曲がった所に置くこと、真ん中から外れること
  return { bad, q, cost: bad * 1000 + (cand.side === -1 ? 400 : 0) + cand.v0 * 4 + cand.dev * 40 + cand.center * 60 };
}

// ---------- 書き出し ----------

function render(link, cand, size) {
  const deg = Math.atan2(cand.d[1], cand.d[0]) * 180 / Math.PI;
  // 回転前の座標で、中心 c の真上（-y）に積む。いちばん下の行が線にいちばん近い
  const [cx, cy] = cand.c.map(v => +v.toFixed(3));
  const n = link.texts.length;
  const top = cand.v0 + size.h;  // 線からいちばん上までの距離
  const desc = size.fs * 0.2;
  let out = `<g transform="rotate(${deg.toFixed(3)} ${cx} ${cy})">`;
  out += `<rect x="${(cx - size.w / 2 - 2).toFixed(3)}" y="${(cy - top - 1).toFixed(3)}" width="${(size.w + 4).toFixed(3)}" height="${(size.h + 2).toFixed(3)}" fill="#FFFFFF" stroke="none"/>`;
  link.texts.forEach((t, k) => {
    // k = 0 が上の行
    const base = cy - cand.v0 - desc - (n - 1 - k) * size.lh;
    let tag = t.raw.replace(/\sx="[^"]*"/, ` x="${cx}"`).replace(/\sy="[^"]*"/, ` y="${base.toFixed(3)}"`);
    tag = tag.replace('<text ', '<text text-anchor="middle" ');
    out += tag;
  });
  out += '</g>';
  return out;
}

export function processSvg(svg) {
  if (svg.includes(MARK)) return { svg, changed: false, overlaps: 0 };
  const { frame, nodes, links } = parse(svg);
  // 自己ループの文は PlantUML の位置（ループの上）を基本に、ほかの線に横切られるときだけループの近くで少しずらす。
  // 決めた位置は、ほかの文が避ける対象にする
  const fixed = [];
  const selfShift = new Map();
  for (const l of links) {
    if (!l.self || !l.texts.length) continue;
    const boxAt = (dx, dy) => l.texts.map(t => boxPoly({ x0: t.x + dx - 2, y0: t.y + dy - t.fs, x1: t.x + t.w + dx + 2, y1: t.y + dy + t.fs * 0.25 }));
    let best = null;
    for (let dy = 0; dy >= -36; dy -= 3) {
      for (let dx = 0; Math.abs(dx) <= 90; dx = dx > 0 ? -dx : -dx + 6) {
        const qs = boxAt(dx, dy);
        let bad = 0;
        for (const q of qs) {
          for (const other of links) if (other !== l) for (const p of other.dense) if (inQuad(q, p)) bad++;
          for (const nb of nodes) if (polysOverlap(q, boxPoly(nb))) bad += 3;
          for (const f of fixed) if (polysOverlap(q, f)) bad += 3;
          for (const p of q) if (p[1] < frame.y0 || p[0] < frame.x0 + 2 || p[0] > frame.x1 - 2) bad += 3;
        }
        const cost = bad * 1000 + Math.abs(dx) + Math.abs(dy) * 2;
        if (!best || cost < best.cost) best = { dx, dy, cost, qs };
      }
    }
    selfShift.set(l, best);
    fixed.push(...best.qs);
  }
  const ctx = { frame, nodes, fixed, placed: [], links: [] };
  // 文の長い（置きにくい）ものから決める
  const order = links.filter(l => !l.self && l.texts.length).sort((a, b) => labelBox(b.texts).w - labelBox(a.texts).w);
  const result = new Map();
  let overlaps = 0;
  for (const link of order) {
    const size = labelBox(link.texts);
    ctx.links = links; // ほかの線（自分の線も、区間の外で文に触れるなら避ける）
    let best = null;
    for (const cand of candidates(link, size)) {
      const sc = score(cand, size, link, ctx);
      if (!best || sc.cost < best.sc.cost) best = { cand, sc };
    }
    if (!best) continue;
    ctx.placed.push(best.sc.q);
    if (best.sc.bad) overlaps++;
    result.set(link, render(link, best.cand, size));
  }
  // 自己ループの文は位置を変えず、白い下地を敷く。ほかの線が横切るなら重なりとして数える
  for (const link of links) {
    if (!link.self || !link.texts.length) continue;
    const { dx, dy } = selfShift.get(link);
    let xml = '';
    let hits = 0;
    for (const t of link.texts) {
      const b = { x0: t.x - 2, y0: t.y - t.fs, x1: t.x + t.w + 2, y1: t.y + t.fs * 0.25 };
      xml += `<rect x="${b.x0.toFixed(3)}" y="${b.y0.toFixed(3)}" width="${(b.x1 - b.x0).toFixed(3)}" height="${(b.y1 - b.y0).toFixed(3)}" fill="#FFFFFF" stroke="none"/>`;
      const q = boxPoly({ x0: t.x + dx, y0: t.y + dy - t.fs * 0.85, x1: t.x + t.w + dx, y1: t.y + dy });
      for (const other of links) if (other !== link) for (const p of other.dense) if (inQuad(q, p)) hits++;
    }
    xml += link.texts.map(t => t.raw).join('');
    if (hits) overlaps++;
    result.set(link, `<g transform="translate(${dx} ${dy})">${xml}</g>`);
  }
  // 文は線より手前に見えるよう、すべての線のあと（図のいちばん最後）にまとめて描く
  let out = svg;
  let labels = '';
  for (const [link, labelXml] of result) {
    let body = link.body;
    for (const t of link.texts) body = body.replace(t.raw, '');
    out = out.replace(link.full, `<g class="link"${link.head}>${body}</g>`);
    labels += labelXml;
  }
  const end = out.lastIndexOf('</g>');
  out = out.slice(0, end) + `<g class="link-labels">${labels}</g>` + out.slice(end);
  out = out.replace(/(<svg[^>]*>)/, `$1${MARK}`);
  return { svg: out, changed: true, overlaps };
}

// ---------- PNG（docx の代わりの画像） ----------

// 手直しした SVG を Edge（なければ Chrome）のヘッドレスで PNG にする。scale は 96dpi に対する倍率（1.5 = 144dpi）
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
  // --png <フォルダ> [--scale 1.5]：置き直したあと、同じ名前の PNG をそのフォルダに作る（build_docx.ps1 が使う）
  let pngDir = null, scale = 1.5;
  const pi = files.indexOf('--png');
  if (pi >= 0) { pngDir = files[pi + 1]; files.splice(pi, 2); }
  const si = files.indexOf('--scale');
  if (si >= 0) { scale = +files[si + 1]; files.splice(si, 2); }
  if (!files.length) {
    const dir = join(here, '..', '図', 'ロバストネス図');
    files = readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => join(dir, f));
  }
  let changed = 0, bad = 0;
  for (const f of files) {
    const r = processSvg(readFileSync(f, 'utf8'));
    if (r.changed) { writeFileSync(f, r.svg); changed++; }
    if (r.overlaps) { bad++; console.log(`重なり ${r.overlaps} 件: ${basename(f)}`); }
  }
  console.log(`ロバストネス図のラベルを置き直した: ${changed} 枚（処理済みで変えなかった: ${files.length - changed} 枚）`);
  if (pngDir) {
    const browser = findBrowser();
    if (!browser) {
      console.log('Edge・Chrome が見つからないので、ロバストネス図の PNG は PlantUML のまま（文の位置は SVG と違う）');
    } else {
      mkdirSync(pngDir, { recursive: true });
      let n = 0;
      for (const f of files) {
        svgToPng(browser, f, join(pngDir, basename(f).replace(/\.svg$/, '.png')), scale);
        n++;
      }
      console.log(`ロバストネス図の PNG を SVG から作った: ${n} 枚`);
    }
  }
  if (bad) process.exitCode = 1;
}
