// ER図の SVG を IDEF1X（astah の ER図）の見た目に直す。
//
// PlantUML の entity は名前を箱の中の見出しに書き、リレーションの端の丸は白い。そこで PlantUML が出した SVG を後から書き換える：
//   - エンティティの箱の上端を、見出しの下の区切り線まで下げ（区切り線は消す）、名前を箱の外の左上に残す
//     （線は元の箱の上端＝名前の上で止まるので、astah と同じく名前の上に線がつながる）
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

// エンティティ1つ（<g class="entity" …>…</g>）を直す
function fixEntity(g) {
  const rectM = g.match(/<rect\b[^>]*\/>/);
  const lineM = g.match(/<line\b[^>]*\/>/);
  const textM = g.match(/<text\b[^>]*>[^<]*<\/text>/);
  if (!rectM || !lineM || !textM) return g;
  const rect = rectM[0];
  const x = num(rect, 'x'), y = num(rect, 'y'), h = num(rect, 'height');
  const sepY = num(lineM[0], 'y1');
  const delta = sepY - y;
  if (!(delta > 0 && delta < h)) return g;
  let newRect = setAttr(rect, 'y', sepY.toFixed(3));
  newRect = setAttr(newRect, 'height', (h - delta).toFixed(3));
  // 名前は箱の左端にそろえる（高さはそのまま＝新しい上端のすぐ上）
  const newText = setAttr(textM[0], 'x', x.toFixed(3));
  return g.replace(rect, newRect).replace(lineM[0], '').replace(textM[0], newText);
}

export function processSvg(svg) {
  if (svg.includes(MARK)) return { svg, changed: false };
  let out = svg.replace(/<g class="entity"[\s\S]*?<\/g>/g, fixEntity);
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
