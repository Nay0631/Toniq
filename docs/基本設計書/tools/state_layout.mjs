// 画面遷移図（PlantUML のステートマシン図）の SVG を後処理する。
//   node docs/基本設計書/tools/state_layout.mjs [<SVG> …] [--png <フォルダ> [--scale 1.5]]   （SVG の省略時は 図/画面遷移図/ の SVG すべて）
// 1. 線の折れ目を減らす：PlantUML（linetype polyline）の線は遠回りして何度も折れるので、
//    画面の箱・ほかの線にぶつからない範囲で、折れ目を飛ばしてまっすぐにつなぐ。矢じりは最後の向きに合わせて描き直す。
// 2. 線の文（ラベル）を自分の線に沿わせて置き直す（斜めの線は線と平行に傾けて線のすぐ上、縦に近い線は横書きで線のすぐ横。線から GAP）。線の中ほどから順に、
//    画面の箱・ほかの線・ほかの文と重ならない位置を選ぶ。文の頭の全角の空白（PlantUML 用のすき間）は外す。
// 処理済みの SVG には印（<!-- state_layout -->）を付け、もう一度動かしても変えない。手で直さない。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARK = '<!-- state_layout -->';
const GAP = 4;          // 線と文の間
const BOX_PAD = 8;      // 線が画面の箱から離れる幅
const LINE_PAD = 8;     // 線どうしが平行に近づいてよい幅
const TEXT_PAD = 3;     // 文と線・箱・文の間
const LABEL_SEP = 30;   // 文どうしをこれだけ離したい（狭いと点数を下げる）

let files = process.argv.slice(2);
// --png <フォルダ>：処理したあと、同じ名前の PNG をそのフォルダに作る（目で確かめる用。Edge か Chrome のヘッドレス）
let pngDir = null;
const pi = files.indexOf('--png');
if (pi >= 0) { pngDir = files[pi + 1]; files.splice(pi, 2); }
// --scale 1.5：PNG の倍率（96dpi に対する。build_docx.ps1 は 1.5 = 144dpi）
let scale = 1;
const si = files.indexOf('--scale');
if (si >= 0) { scale = +files[si + 1]; files.splice(si, 2); }
if (!files.length) {
  const dir = join(HERE, '..', '図', '画面遷移図');
  files = readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => join(dir, f));
}

const num = (t, k) => { const m = t.match(new RegExp(' ' + k + '="([^"]+)"')); return m ? +m[1] : NaN; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const inRect = (p, r, pad) => p[0] > r.x0 - pad && p[0] < r.x1 + pad && p[1] > r.y0 - pad && p[1] < r.y1 + pad;
function segDist(p, a, b) {
  const ab = sub(b, a), l2 = ab[0] ** 2 + ab[1] ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
  return len(sub(p, lerp(a, b, t)));
}
const samples = (a, b, step = 2) => { const n = Math.max(2, Math.ceil(len(sub(b, a)) / step)); return Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n)); };

let totalBad = 0;
for (const file of files) {
  let svg = readFileSync(file, 'utf8');
  if (svg.includes(MARK)) { console.log(`${file}: 処理済み（変えない）`); continue; }

  // 画面の箱（と開始の黒丸）
  const boxes = {};
  for (const m of svg.matchAll(/<g class="(?:entity|start_entity)"[^>]*id="(ent\d+)"[^>]*>(.*?)<\/g>/g)) {
    const r = m[2].match(/<rect[^>]*>/), e = m[2].match(/<ellipse[^>]*>/);
    if (r) { const x = num(r[0], 'x'), y = num(r[0], 'y'); boxes[m[1]] = { x0: x, y0: y, x1: x + num(r[0], 'width'), y1: y + num(r[0], 'height') }; }
    else if (e) { const cx = num(e[0], 'cx'), cy = num(e[0], 'cy'), rx = num(e[0], 'rx'), ry = num(e[0], 'ry'); boxes[m[1]] = { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry }; }
  }
  const W = num(svg.match(/<svg[^>]*>/)[0], 'width') || parseFloat(svg.match(/width:([0-9.]+)px/)[1]);
  const H = parseFloat(svg.match(/height:([0-9.]+)px/)[1]);

  // 線
  const links = [];
  for (const m of svg.matchAll(/<g class="link" data-entity-1="(ent\d+)" data-entity-2="(ent\d+)"[^>]*>(.*?)<\/g>/g)) {
    const body = m[3];
    const pm = body.match(/<path d="([^"]+)"[^>]*\/>/), gm = body.match(/<polygon points="([^"]+)"[^>]*\/>/);
    const nums = pm[1].match(/-?[0-9.]+/g).map(Number);
    const pts = []; for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const verts = [pts[0]]; for (let i = 3; i < pts.length; i += 3) verts.push(pts[i]);   // M p0 C c c p1 C c c p2 …
    const poly = gm[1].split(',').map(Number), tip = [poly[0], poly[1]];
    // 上向き（-up->）の線は、線の始まりの側に矢じりがある（reverse link）。矢じりの先を最後にそろえる
    if (len(sub(tip, verts[0])) < len(sub(tip, verts[verts.length - 1]))) verts.reverse();
    verts[verts.length - 1] = tip;
    const texts = [...body.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map(t => ({ attrs: t[1], t: t[2] }));
    links.push({ full: m[0], from: m[1], to: m[2], pathTag: pm[0], polyTag: gm[0], verts, texts });
  }

  // 1. 折れ目を減らす
  const otherSegs = self => links.filter(l => l !== self).flatMap(l => l.verts.slice(1).map((v, i) => [l.verts[i], v]));
  function ok(link, a, b) {
    const start = link.verts[0], end = link.verts[link.verts.length - 1];
    const segs = otherSegs(link);
    for (const p of samples(a, b)) {
      const nearEnds = len(sub(p, start)) < 4 || len(sub(p, end)) < 4;
      for (const [id, r] of Object.entries(boxes)) {
        if (id === link.from || id === link.to) { if (!nearEnds && inRect(p, r, -1)) return false; }
        else if (inRect(p, r, BOX_PAD)) return false;
      }
      if (len(sub(p, start)) < 25 || len(sub(p, end)) < 25) continue;   // 箱の縁の近くは線が集まってよい
      if (segs.some(([c, d]) => segDist(p, c, d) < LINE_PAD)) return false;
    }
    return true;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const l of links) {
      const v = l.verts, out = [v[0]];
      let i = 0;
      while (i < v.length - 1) {
        let j = v.length - 1;
        while (j > i + 1 && !ok(l, v[i], v[j])) j--;
        out.push(v[j]); i = j;
      }
      l.verts = out;
    }
  }

  // 2. 文を自分の線に沿わせて置く（2026-11-24 ユーザーの指示。斜めの線の横に横書きの文を置くと、線から離れて見え、どの線の文か分かりにくかったため）
  //    ・線の傾きが 60 度以内：文を線と平行に傾け、線のすぐ上（入らなければ下）に置く（ロバストネス図と同じ）
  //    ・それより急な線（縦に近い線）：傾けると読みにくいので、横書きのまま線のすぐ横に置く
  //    文は「中心 c・傾き th・半分の幅 hw・半分の高さ hh」の傾いた四角として扱う
  const allSegs = links.flatMap(l => l.verts.slice(1).map((v, i) => [l.verts[i], v]));
  const toLocal = (r, q) => { const dx = q[0] - r.c[0], dy = q[1] - r.c[1], cs = Math.cos(r.th), sn = Math.sin(r.th); return [dx * cs + dy * sn, -dx * sn + dy * cs]; };
  const toWorld = (r, u, w) => { const cs = Math.cos(r.th), sn = Math.sin(r.th); return [r.c[0] + u * cs - w * sn, r.c[1] + u * sn + w * cs]; };
  const inLabel = (r, q, pad) => { const [u, w] = toLocal(r, q); return Math.abs(u) < r.hw + pad && Math.abs(w) < r.hh + pad; };
  const distLabel = (r, q) => { const [u, w] = toLocal(r, q); return Math.hypot(Math.max(Math.abs(u) - r.hw, 0), Math.max(Math.abs(w) - r.hh, 0)); };
  const gridOf = r => { const pts = []; for (let u = -r.hw; u <= r.hw + 0.01; u += Math.max(r.hw / 6, 1)) for (let w = -r.hh; w <= r.hh + 0.01; w += Math.max(r.hh / 2, 1)) pts.push(toWorld(r, u, w)); return pts; };
  const boxPts = b => { const pts = []; for (let x = b.x0; x <= b.x1; x += 6) pts.push([x, b.y0], [x, b.y1]); for (let y = b.y0; y <= b.y1; y += 6) pts.push([b.x0, y], [b.x1, y]); return pts; };
  const hitsBox = (r, b) => r.grid.some(q => inRect(q, b, TEXT_PAD)) || boxPts(b).some(q => inLabel(r, q, TEXT_PAD));
  const overlapL = (a, b) => a.grid.some(q => inLabel(b, q, TEXT_PAD)) || b.grid.some(q => inLabel(a, q, TEXT_PAD));
  const gapL = (a, b) => Math.min(...a.grid.map(q => distLabel(b, q)));
  const segPts = allSegs.map(([a, b]) => samples(a, b, 2));
  const items = links.filter(l => l.texts.length).map(l => {
    const lines = l.texts.map(t => {
      const fs = num(t.attrs, 'font-size'), sp = t.t.startsWith('　');
      return { fs, x: num(t.attrs, 'x') + (sp ? fs : 0), y: num(t.attrs, 'y'), w: num(t.attrs, 'textLength') - (sp ? fs : 0), t: t.t.replace(/^　/, ''), attrs: t.attrs };
    });
    const bx0 = Math.min(...lines.map(o => o.x)), bx1 = Math.max(...lines.map(o => o.x + o.w));
    const by0 = Math.min(...lines.map(o => o.y - o.fs)), by1 = Math.max(...lines.map(o => o.y + 3));
    const oc = [(bx0 + bx1) / 2, (by0 + by1) / 2];
    // 文の形：書いたとおりの行（横書き・傾けるとき）と、1行にまとめたもの（傾けるときだけ。線に沿う細い帯になる）
    const multi = { hw: (bx1 - bx0) / 2, hh: (by1 - by0) / 2, rows: lines.map(o => ({ ...o, rx: o.x - oc[0], ry: o.y - oc[1] })) };
    // 文の続きはそのままつなぎ、条件（[…]）の前にだけ全角の空白を入れる
    const fs0 = lines[0].fs, joinSp = lines.slice(1).filter(o => o.t.startsWith('[')).length;
    const sumW = lines.reduce((a, o) => a + o.w, 0) + fs0 * joinSp;
    const oneLine = lines.map((o, i) => (i && o.t.startsWith('[') ? '　' : '') + o.t).join('');
    const single = { hw: sumW / 2, hh: (fs0 + 3) / 2, rows: [{ ...lines[0], t: oneLine, w: sumW, rx: -sumW / 2, ry: fs0 / 2 - 1.5 }] };
    const v = l.verts, segLen = v.slice(1).map((p, i) => len(sub(p, v[i]))), total = segLen.reduce((a, b) => a + b, 0);
    const at = f => { let d = f * total; for (let i = 0; i < segLen.length; i++) { if (d <= segLen[i] || i === segLen.length - 1) return { p: lerp(v[i], v[i + 1], Math.min(1, d / segLen[i])), dir: sub(v[i + 1], v[i]) }; d -= segLen[i]; } };
    const others = links.filter(o => o !== l).flatMap(o => o.verts.slice(1).map((q, i) => [o.verts[i], q]));
    const othersPts = others.map(([a, b]) => samples(a, b, 4));
    const cands = [];
    const tryCand = (c, th, gap, f, extra, vr) => {
      const r = { c, th, hw: vr.hw, hh: vr.hh, vr };
      r.grid = gridOf(r);
      if (r.grid.some(q => q[0] < 40 || q[1] < 40 || q[0] > W - 15 || q[1] > H - 15)) return;
      if (Object.values(boxes).some(b => hitsBox(r, b))) return;
      if (segPts.some(ps => ps.some(q => inLabel(r, q, TEXT_PAD - 0.5)))) return;
      // 点数（小さいほど良い）：自分の線に近い・線の中ほど・ほかの線から遠い（どの線の文か迷わない）
      const far = Math.min(50, ...othersPts.map(ps => Math.min(...ps.map(q => distLabel(r, q)))));
      r.score = gap * 3 + Math.abs(f - 0.5) * 40 + Math.max(0, gap * 3 + 15 - far) * 6 - far * 0.5 + extra;
      cands.push(r);
    };
    for (const gap of [GAP, GAP + 6, GAP + 14, GAP + 26]) {
      for (let f = 0.15; f <= 0.8501; f += 0.025) {
        const { p, dir } = at(f), dl = len(dir) || 1;
        // 線の傾き（文が逆さにならないよう −90〜90 度にそろえる）
        let th = Math.atan2(dir[1], dir[0]);
        if (th > Math.PI / 2) th -= Math.PI; else if (th <= -Math.PI / 2) th += Math.PI;
        const steep = Math.abs(th) > Math.PI / 3;
        if (!steep) {
          // 線と平行に傾けて、線の上（文の上向き）か下に置く
          const up = [Math.sin(th), -Math.cos(th)];
          // 1行にまとめた形を先に試す（線の長さの 7 割に収まるとき）
          const vrs = lines.length > 1 && single.hw * 2 < total * 0.7 ? [[single, 0], [multi, 6]] : [[multi, 0]];
          for (const [vr, ve] of vrs) for (const [sgn, extra] of [[1, 0], [-1, 4]]) {
            const d = vr.hh + gap;
            tryCand([p[0] + up[0] * d * sgn, p[1] + up[1] * d * sgn], th, gap, f, extra + ve, vr);
          }
        } else {
          // 横書きのまま線の左右に置く
          const n = [-dir[1] / dl, dir[0] / dl];
          for (const sgn of [1, -1]) {
            const nn = [n[0] * sgn, n[1] * sgn];
            const d = multi.hw * Math.abs(nn[0]) + multi.hh * Math.abs(nn[1]) + gap;
            tryCand([p[0] + nn[0] * d, p[1] + nn[1] * d], 0, gap, f, 0, multi);
          }
        }
      }
    }
    cands.sort((a, b) => a.score - b.score);
    return { l, lines, oc, cands, cur: null };
  });
  // はじめは候補の少ない文から順に置き、そのあとほかの文を固定して1つずつ選び直す
  // ほかの文との間が LABEL_SEP より狭い位置は点数を下げる（文どうしが近いと、どれがどの線の文か分かりにくい。2026-11-24 ユーザーの指示）
  const pick = it => {
    let best = null, bestScore = Infinity;
    for (const c of it.cands) {
      if (c.score >= bestScore) break;   // 候補は点数の順に並んでいる
      let s = c.score, ok = true;
      for (const o of items) {
        if (o === it || !o.cur || !o.cur.grid) continue;
        if (overlapL(c, o.cur)) { ok = false; break; }
        s += Math.max(0, LABEL_SEP - gapL(c, o.cur)) * 8;
      }
      if (ok && s < bestScore) { best = c; bestScore = s; }
    }
    return best;
  };
  for (const it of [...items].sort((a, b) => a.cands.length - b.cands.length)) it.cur = pick(it);
  for (let round = 0; round < 5; round++) for (const it of items) { const c = pick(it); if (c) it.cur = c; }
  let bad = 0;
  for (const it of items) {
    if (!it.cur) {
      console.log(`  置けない文: ${it.lines.map(o => o.t).join(' ')}`); bad++;
      it.cur = { c: it.oc, th: 0, vr: { rows: it.lines.map(o => ({ ...o, rx: o.x - it.oc[0], ry: o.y - it.oc[1] })) } };
    }
    const texts = it.cur.vr.rows.map(o => {
      const a = o.attrs.replace(/ x="[^"]+"/, ` x="${(it.cur.c[0] + o.rx).toFixed(3)}"`).replace(/ y="[^"]+"/, ` y="${(it.cur.c[1] + o.ry).toFixed(3)}"`).replace(/ textLength="[^"]+"/, ` textLength="${o.w.toFixed(3)}"`);
      return `<text${a}>${o.t}</text>`;
    });
    const deg = it.cur.th * 180 / Math.PI;
    it.l.newTexts = Math.abs(deg) < 0.5 ? texts
      : [`<g transform="rotate(${deg.toFixed(2)} ${it.cur.c[0].toFixed(3)} ${it.cur.c[1].toFixed(3)})">`, ...texts, '</g>'];
  }

  // 書き出し
  for (const l of links) {
    const v = l.verts, tip = v[v.length - 1], prev = v[v.length - 2];
    const d = sub(tip, prev), dl = len(d), u = [d[0] / dl, d[1] / dl], n = [-u[1], u[0]];
    const notch = [tip[0] - u[0] * 5, tip[1] - u[1] * 5], base = [tip[0] - u[0] * 10, tip[1] - u[1] * 10];
    const w1 = [base[0] + n[0] * 4.6, base[1] + n[1] * 4.6], w2 = [base[0] - n[0] * 4.6, base[1] - n[1] * 4.6];
    const f = p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    const dAttr = 'M' + f(v[0]) + v.slice(1, -1).map(p => ' L' + f(p)).join('') + ' L' + f(notch);
    let g = l.full.replace(l.pathTag, l.pathTag.replace(/ d="[^"]+"/, ` d="${dAttr}"`))
      .replace(l.polyTag, l.polyTag.replace(/points="[^"]+"/, `points="${[tip, w1, notch, w2, tip].map(f).join(',')}"`));
    if (l.newTexts) {
      const firstText = g.indexOf('<text');
      g = g.slice(0, firstText) + l.newTexts.join('') + '</g>';
    }
    svg = svg.replace(l.full, g);
  }
  svg = svg.replace(/(<svg[^>]*>)/, `$1${MARK}`);
  writeFileSync(file, svg);
  console.log(`${file}: 折れ目 ${links.reduce((a, l) => a + l.verts.length - 2, 0)} か所に減らした。置けない文 ${bad} 件`);
  totalBad += bad;
}

if (pngDir) {
  const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
  if (!browser) console.log('Edge・Chrome が見つからないので PNG は作らない');
  else for (const file of files) {
    const s = readFileSync(file, 'utf8');
    const w = Math.ceil(parseFloat(s.match(/width:([0-9.]+)px/)[1])), h = Math.ceil(parseFloat(s.match(/height:([0-9.]+)px/)[1]));
    const out = join(pngDir, basename(file).replace(/\.svg$/, '.png'));
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=' + scale, '--window-size=' + w + ',' + h, '--screenshot=' + out, pathToFileURL(file).href], { stdio: 'ignore', timeout: 120000 });
    console.log('PNG: ' + out);
  }
}
process.exit(totalBad ? 1 : 0);
