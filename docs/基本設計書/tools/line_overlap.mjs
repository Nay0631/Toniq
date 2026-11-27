// ロバストネス図の SVG で、別々の線が同じ道を通っている所を数える（線どうしの重なりの確認用）。
//
// PlantUML（Graphviz）は線の通り道を自動で決めるので、別々の線が同じ折れ目を通ったり、近くを並んで走ったりして、
// 2本の線がつながって1本に見えることがある（例：A01-4 で「利用者 → 書き出しダイアログ」と
// 「ミュージックリスト画面 → 再生」が同じ折れ目を通り、「利用者 → ミュージックリスト画面」の線に見えた。2026-11-27）。
// robustness_labels.mjs は文どうし・文と線の重なりしか見ないので、この道具で線どうしを確かめる。次の2つを数える：
//   - 並んで走る長さ：ある線のうち、別の線から 6px 以内を通る部分の長さ（両端から 25px は除く）。20 を超える組を出す
//   - 接する所：ある線の折れ目（曲線のつなぎ目）に、別の線が 5px 以内で触れている所（線がつながって見える）
//   同じ部品につながる線どうし（同じ所から出る・同じ所へ入る線）は、分かれ方・集まり方が見て分かるので数えない（接する所だけ）。
// 合格の目安：接する所 0、並んで走る長さはどの組も 50 未満（浅い角度で交わる線は 20〜40 になる。交わるだけなら線を取り違えない）。
// 目安を超えた図があれば終了コード 1 で終わる。SVG は変えない。
//
// 使い方（リポジトリのルートで）:
//   node docs/基本設計書/tools/line_overlap.mjs                … ロバストネス図のフォルダの SVG をすべて
//   node docs/基本設計書/tools/line_overlap.mjs <SVG> …        … 指定した SVG だけ
//   node docs/基本設計書/tools/line_overlap.mjs --suggest <.puml> [--two] [--apply]
//        … 部品の宣言（actor / boundary / control / entity の行）を1つずつ先頭・末尾へ動かした案を PlantUML で描き、
//          重なりの少ない順に出す（--two で2つ動かす案も試す。数百〜千通りになり数分かかる）。線と線の文は変えない。
//          --apply で一番よい案を .puml に書き込む（そのあと SVG に変換し、robustness_labels.mjs を動かす）。
//          案の描画には Java と tools/plantuml.jar を使う。描いた案は OS の一時フォルダに作り、終わったら消す。

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const TOL = 6;          // 並んで走るとみなす線どうしの距離（px）
const SKIP = 25;        // 線の両端から数えない長さ（px。部品のまわりで線が集まるのは普通なので）
const REPORT = 20;      // これを超える組を出す
const LIMIT = 50;       // 並んで走る長さの合格の目安（これ以上なら不合格）
const TOUCH_TOL = 5;    // 折れ目に触れているとみなす距離（px）
const TOUCH_COST = 50;  // 案を比べるとき、接する所1か所を並んで走る長さいくつと数えるか

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function bez(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
              u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]]);
  }
  return out;
}

// SVG から線を読む：{ key: 'A1>B3', ends: ['A1','B3'], pts: 線をたどった点, joints: 折れ目 }
function readLines(svg) {
  const s = readFileSync(svg, 'utf8');
  const lines = []; const seen = {};
  for (const m of s.matchAll(/<!--link (\w+) to (\w+)-->/g)) {
    const seg = s.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    const d = seg.match(/<path[^>]* d="([^"]+)"/);
    if (!d) continue;
    const n = (d[1].match(/-?\d+\.?\d*/g) || []).map(Number);
    let cur = [n[0], n[1]]; const pts = [cur]; const joints = [];
    for (let k = 2; k + 6 <= n.length; k += 6) {
      const e = [n[k + 4], n[k + 5]];
      pts.push(...bez(cur, [n[k], n[k + 1]], [n[k + 2], n[k + 3]], e).slice(1));
      joints.push(e); cur = e;
    }
    joints.pop(); // 最後の点は線の端
    let key = `${m[1]}>${m[2]}`; seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key += "'".repeat(seen[key] - 1);
    lines.push({ key, ends: [m[1], m[2]], pts, joints, bbox: bbox(pts) });
  }
  return lines;
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
const near = (a, b, m) => !(a.x1 + m < b.x0 || b.x1 + m < a.x0 || a.y1 + m < b.y0 || b.y1 + m < a.y0);
const minDist = (p, pts) => { let best = Infinity; for (const q of pts) { const d = dist(p, q); if (d < best) best = d; } return best; };

// a のうち、b から TOL 以内を通る部分の長さ
function nearLen(a, b) {
  if (!near(a.bbox, b.bbox, TOL)) return 0;
  const ends = [a.pts[0], a.pts[a.pts.length - 1]];
  let total = 0;
  for (let i = 1; i < a.pts.length; i++) {
    const p = a.pts[i];
    if (Math.min(dist(p, ends[0]), dist(p, ends[1])) < SKIP) continue;
    if (minDist(p, b.pts) < TOL) total += dist(a.pts[i - 1], p);
  }
  return total;
}

export function measure(svg) {
  const L = readLines(svg);
  const pairs = [], touches = [];
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const v = Math.max(nearLen(L[i], L[j]), nearLen(L[j], L[i]));
      if (v > REPORT) pairs.push({ v, a: L[i].key, b: L[j].key });
    }
  }
  for (const a of L) {
    for (const j of a.joints) {
      for (const b of L) {
        if (b === a || a.ends.some(e => b.ends.includes(e))) continue; // 同じ部品につながる線どうしは数えない
        if (Math.min(dist(j, b.pts[0]), dist(j, b.pts[b.pts.length - 1])) < SKIP) continue;
        if (minDist(j, b.pts) < TOUCH_TOL) touches.push({ a: a.key, b: b.key, at: j });
      }
    }
  }
  pairs.sort((x, y) => y.v - x.v);
  const max = pairs.length ? pairs[0].v : 0;
  return { pairs, touches, max, cost: pairs.reduce((s, p) => s + p.v, 0) + TOUCH_COST * touches.length,
           ok: touches.length === 0 && max < LIMIT };
}

const describe = r =>
  [...r.pairs.map(p => `並んで走る ${p.a} と ${p.b}: ${p.v.toFixed(0)}`),
   ...r.touches.map(t => `接する ${t.a} の折れ目(${t.at[0].toFixed(0)},${t.at[1].toFixed(0)})に ${t.b}`)];

// ---- 部品の宣言の位置を変えた案を作って比べる
const isDecl = l => /^(actor|boundary|control|entity) /.test(l);
const alias = l => l.match(/ as (\w+)/)[1];
function moveDecl(lines, name, where) {
  lines = lines.slice();
  const i = lines.findIndex(l => isDecl(l) && alias(l) === name);
  const [x] = lines.splice(i, 1);
  const d = lines.map((l, k) => isDecl(l) ? k : -1).filter(k => k >= 0);
  const j = where === 'top' ? d[0] : d[d.length - 1] + 1;
  lines.splice(j, 0, x);
  return lines;
}

function suggest(puml, { two, apply }) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const src = readFileSync(puml, 'utf8');
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const L = src.split(/\r?\n/);
  const names = L.filter(isDecl).map(alias);
  const singles = names.flatMap(n => [[n, 'top'], [n, 'end']]);
  const variants = [{ name: '今のまま', lines: L }];
  for (const [n, w] of singles) variants.push({ name: `${n} を${w === 'top' ? '先頭' : '末尾'}へ`, lines: moveDecl(L, n, w) });
  if (two) {
    for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) {
      const [[n1, w1], [n2, w2]] = [singles[i], singles[j]];
      if (n1 === n2) continue;
      variants.push({ name: `${n1} を${w1 === 'top' ? '先頭' : '末尾'}へ・${n2} を${w2 === 'top' ? '先頭' : '末尾'}へ`,
                      lines: moveDecl(moveDecl(L, n1, w1), n2, w2) });
    }
  }
  // 一時フォルダに案を書き、共通設定（../astah-*.puml）も置いてまとめて描く
  const tmp = mkdtempSync(join(tmpdir(), 'line_overlap-'));
  const dir = join(tmp, 'v'); mkdirSync(dir);
  for (const f of readdirSync(join(dirname(puml), '..')).filter(f => /^astah-.*\.puml$/.test(f))) copyFileSync(join(dirname(puml), '..', f), join(tmp, f));
  variants.forEach((v, i) => writeFileSync(join(dir, `v${i}.puml`), v.lines.join('\n')));
  try {
    console.log(`${variants.length} 通りの案を描いています…`);
    execFileSync('java', ['-jar', join(root, 'tools', 'plantuml.jar'), '-tsvg', '-charset', 'UTF-8', join(dir, '*.puml')], { stdio: 'ignore' });
    const rows = variants.map((v, i) => ({ ...v, r: measure(join(dir, `v${i}.svg`)) }))
      .sort((a, b) => a.r.cost - b.r.cost || (a.name === '今のまま' ? -1 : 0));
    const now = rows.find(r => r.name === '今のまま');
    console.log(`今のまま: ${now.r.ok ? '合格' : '不合格'}（合計 ${now.r.cost.toFixed(0)}）`);
    for (const row of rows.slice(0, 8)) {
      console.log(`  ${row.r.ok ? '合格' : '不合格'} 合計 ${row.r.cost.toFixed(0).padStart(4)}  ${row.name}`);
      for (const t of describe(row.r)) console.log(`      ${t}`);
    }
    const best = rows[0];
    if (apply && best.name !== '今のまま' && best.r.cost < now.r.cost) {
      writeFileSync(puml, best.lines.join(nl));
      console.log(`→ 「${best.name}」を ${basename(puml)} に書き込んだ。SVG に変換して robustness_labels.mjs を動かすこと`);
    }
    return best.r.ok;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--suggest');
  if (si >= 0) {
    const ok = suggest(args[si + 1], { two: args.includes('--two'), apply: args.includes('--apply') });
    process.exit(ok ? 0 : 1);
  }
  let files = args;
  if (!files.length) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '図', 'ロバストネス図');
    files = readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => join(dir, f));
  }
  let bad = 0;
  for (const f of files) {
    const r = measure(f);
    if (!r.pairs.length && !r.touches.length) continue;
    if (!r.ok) bad++;
    console.log(`${r.ok ? '合格' : '不合格'} ${basename(f, '.svg')}`);
    for (const t of describe(r)) console.log(`    ${t}`);
  }
  console.log(`線どうしの重なり: ${files.length} 枚を確かめた。不合格 ${bad} 枚`);
  process.exit(bad ? 1 : 0);
}
