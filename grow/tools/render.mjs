// grow の wasm を Node で直接鳴らし、プリセットごとの音を測る・WAV に書き出す（npm run grow:render）。
// ブラウザ・Toniq を使わずに、コアを変えたあとの確認（無音・NaN・直流・余韻・音量）ができる。
//
//   npm run grow:render                       全プリセットを測って表を出す
//   npm run grow:render -- --wav              WAV も書き出す（output/grow/<ID>.wav）
//   npm run grow:render -- --preset lead,acid 指定したプリセットだけ（ID。カンマ区切り）
//   npm run grow:render -- --suggest          聞こえる大きさを目標（TARGET。FX はそれぞれの目標 TARGETS）にそろえる master の値を出す
//                                             （ドラムはピークを DRUM_PEAK にそろえる値）
//   npm run grow:render -- --json             結果を JSON で出す
//   npm run grow:render -- --analyze a.wav …  WAV（Toniq で書き出した曲など）のピーク・統合ラウドネス・聞こえる大きさの最大を測る
//
// 鳴らすフレーズはプリセットの使われ方（ROLES）で変える。音量は「聞こえる大きさ」＝ モーメンタリーラウドネスの最大
// （ITU-R BS.1770 の K 特性で重み付けした 400ms の窓の大きさ。LUFS）で比べる。耳に近い重み付けなので、
// 低音だけ大きく・高いノイズだけ小さく出ることがなく、短く切れる音も鳴っている所の大きさで比べられる。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const WASM = join(root, "public", "grow", "grow.wasm");
const OUT  = join(root, "output", "grow");

const SR  = 48000;
const BPM = 120;
// そろえる聞こえる大きさ（LUFS）。Toniq の各パートの Volume の手前に入る大きさ
const TARGET = -18;
// 目標を変える音。FX は組み合わせて鳴らすので、Tone.js 版（FxPlayer.ts の FX_DEFS）の音どうしの差を残す
// （ライザーの音程はノイズより 6dB 小さく、インパクトのノイズはブームより 8dB 小さく、ダウンリフターの音程はノイズより 1dB 小さく）
const TARGETS = {
  fx_riser_noise: -18, fx_riser_pitch: -24,
  fx_boom: -18, fx_burst: -26,
  fx_down_noise: -18, fx_down_tone: -19,
};

// ===== 引数 =====
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = value("--preset")?.split(",").map(s => s.trim()).filter(Boolean);

// ===== プリセットの使われ方と鳴らすフレーズ =====
// lead = 単音の旋律、chord = 和音、bass = 低い音の刻み、pluck = 速い刻み、fx = 長い1音、noise = ノイズ（ずっと押す）、
// drum = 8分音符で8回打つ（高さは DRUM_NOTES）。
// fixed = 音量をそろえない（わざと小さい・大きい音。--suggest の対象外）
const ROLES = {
  init: "lead", lead: "lead", supersaw: "chord", pluck: "pluck", acid: "bass", wide_pad: "chord",
  sub_bass: "bass", chip_lead: "lead", noise_sweep: "fx", soft_pad: "chord", keys: "chord", bell: "pluck",
  blip: "pluck", stab: "chord", gate_saw: "chord", vinyl_hiss: "noise", vinyl_crackle: "noise", wind: "noise",
  epiano: "chord", organ: "chord", strings: "chord", square: "chord",
  fx_riser_noise: "fx", fx_riser_pitch: "fx", fx_boom: "fx", fx_burst: "fx", fx_down_noise: "fx",
  fx_down_tone: "fx", fx_reverse: "fx", fx_chip: "pluck",
  saw_bass: "bass", square_bass: "bass", rolling_bass: "bass", chip_bass: "bass", soft_bass: "bass", brass: "lead", sync_lead: "lead",
  hard_pad: "chord", gate_pad: "chord", fat_bass: "bass", pulse_bass: "bass", wobble_bass: "bass", trance_lead: "lead", accel_se: "fx",
  drum_kick: "drum", drum_snare: "drum", drum_hat_closed: "drum", drum_hat_open: "drum", drum_clap: "drum", drum_rim: "drum",
  drum_shaker: "drum", drum_tambourine: "drum", drum_conga: "drum", drum_ride: "drum",
};
// ドラムを鳴らす高さ（Toniq の標準のキット（src/engine/SynthFactory.ts の DEFAULT_KIT）と同じくらい）
const DRUM_NOTES = { drum_kick: 24, drum_snare: 54, drum_hat_closed: 80, drum_hat_open: 80, drum_clap: 60, drum_rim: 92,
  drum_shaker: 60, drum_tambourine: 84, drum_conga: 57, drum_ride: 76 };
// ドラムは聞こえる大きさではなく、強さ 1 のピークをそろえる（出力段のソフトクリップ（約 -4.4dB）の手前。
// 一瞬で消える音は 400ms の窓のラウドネスでは比べにくく、ピークが上がりすぎるとソフトクリップで歪むため）
const DRUM_PEAK = -6;
// ピークの目標を変えるドラム（ノイズが主の音は、ノイズ・master を最大にしても -6dB に届かない）
const DRUM_PEAKS = { drum_snare: -6.5, drum_clap: -9.5, drum_shaker: -7.5 };
// わざと小さくしている音（ヒス・プチプチは背景の質感）
const FIXED = new Set(["vinyl_hiss", "vinyl_crackle"]);

// フレーズ：[開始（秒）, 長さ（秒）, ノート番号, 強さ] の並び
const beat = 60 / BPM;
function phrase(role, id) {
  const ev = [];
  const add = (t, len, notes, vel = 0.9) => notes.forEach(n => ev.push([t, len, n, vel]));
  switch (role) {
    case "chord":
      [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]].forEach((c, i) => add(i * beat * 2, beat * 2, c));
      break;
    case "bass":
      for (let i = 0; i < 16; i++) add(i * beat / 2, beat / 2 * 0.8, [[36, 36, 43, 48][i % 4]], i % 2 ? 0.8 : 1);
      break;
    case "pluck":
      for (let i = 0; i < 32; i++) add(i * beat / 4, beat / 4 * 0.6, [[60, 64, 67, 72, 67, 64][i % 6]], i % 4 ? 0.7 : 0.9);
      break;
    case "fx":
      add(0, beat * 4, [60], 1);
      break;
    case "noise":
      add(0, beat * 8, [60], 0.8);
      break;
    case "drum":
      for (let i = 0; i < 8; i++) add(i * beat / 2, beat / 2 * 0.9, [DRUM_NOTES[id] ?? 60], i % 2 ? 0.8 : 1);
      break;
    default:  // lead
      [60, 62, 64, 67, 69, 67, 64, 62].forEach((n, i) => add(i * beat, beat * 0.95, [n]));
  }
  return ev;
}
const TAIL = 5;  // 最後の音のあとの余韻（秒。長いリリース＋リバーブでも消えきる長さ）

// ===== wasm =====
const bytes  = readFileSync(WASM);
const module = await WebAssembly.compile(bytes);
const imports = {};
for (const imp of WebAssembly.Module.imports(module)) {
  if (imp.kind === "function") (imports[imp.module] ??= {})[imp.name] = () => 0;
}
const decoder = new TextDecoder();

function newEngine() {
  const ex = new WebAssembly.Instance(module, imports).exports;
  ex._initialize?.();
  ex.grow_init(SR);
  ex.grow_set_bpm(BPM);
  return ex;
}
const readString = (ex, ptr) => {
  const b = new Uint8Array(ex.memory.buffer);
  let end = ptr;
  while (b[end] !== 0) end++;
  return decoder.decode(b.subarray(ptr, end));
};

const info = newEngine();
const paramCount = info.grow_param_count();
const paramIds = Array.from({ length: paramCount }, (_, i) => readString(info, info.grow_param_id(i)));
const masterIndex = paramIds.indexOf("master");
const MASTER_MAX  = info.grow_param_max(masterIndex);
const presets = Array.from({ length: info.grow_preset_count() }, (_, i) => ({
  index: i,
  id:    info.grow_preset_id ? readString(info, info.grow_preset_id(i)) : String(i),
  name:  readString(info, info.grow_preset_name(i)),
}));

// プリセットでフレーズを鳴らす。overrides はパラメーターの番号 → 値
function render(preset, role, overrides = {}) {
  const ex = newEngine();
  for (let i = 0; i < paramCount; i++) ex.grow_set_param(i, overrides[i] ?? ex.grow_preset_value(preset.index, i));
  const block = ex.grow_block_size();
  const Lbuf = new Float32Array(ex.memory.buffer, ex.grow_left(), block);
  const Rbuf = new Float32Array(ex.memory.buffer, ex.grow_right(), block);

  // 発音・消音をサンプル位置の順に並べ、ブロックの途中で区切って当てる
  const events = [];
  phrase(role, preset.id).forEach(([t, len, note, vel]) => {
    events.push({ at: Math.round(t * SR), on: true, note, vel });
    events.push({ at: Math.round((t + len) * SR), on: false, note });
  });
  events.sort((a, b) => a.at - b.at || (a.on ? 1 : -1));  // 同じ位置なら消音が先
  const last = Math.max(...events.map(e => e.at));
  const total = last + Math.round(TAIL * SR);
  const L = new Float32Array(total), R = new Float32Array(total);

  let pos = 0, e = 0;
  while (pos < total) {
    while (e < events.length && events[e].at <= pos) {
      const ev = events[e++];
      if (ev.on) ex.grow_note_on(ev.note, ev.vel); else ex.grow_note_off(ev.note);
    }
    const next = e < events.length ? events[e].at : total;
    const n = Math.min(block, next - pos, total - pos);
    ex.grow_render(n);
    L.set(Lbuf.subarray(0, n), pos);
    R.set(Rbuf.subarray(0, n), pos);
    pos += n;
  }
  return { L, R, lastNoteOff: last };
}

const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity);

// K 特性（ITU-R BS.1770）：高域の持ち上げ（頭の影響）→ 低域のカット（RLB）。
// 係数はサンプリング周波数から求める（48kHz で規格の表の値になる）
function biquad(x, b, a) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Number.isFinite(x[i]) ? x[i] : 0;
    const out = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}
function kWeight(x, sr = SR) {
  // 高域の持ち上げ（ハイシェルフ）
  let K = Math.tan(Math.PI * 1681.974450955533 / sr);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad(x,
    [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]);
  // 低域のカット（ハイパス）
  K = Math.tan(Math.PI * 38.13547087602444 / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  return biquad(shelf, [1, -2, 1], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]);
}

// 400ms の窓（hop 秒ずつずらす）ごとの K 特性の大きさ（左右のパワーの和）
function blockPowers(L, R, sr, hop) {
  const kl = kWeight(L, sr), kr = kWeight(R, sr);
  const win = Math.round(0.4 * sr), step = Math.round(hop * sr);
  const out = [];
  for (let s = 0; s + win <= L.length; s += step) {
    let p = 0;
    for (let i = s; i < s + win; i++) p += kl[i] * kl[i] + kr[i] * kr[i];
    out.push(p / win);
  }
  return out;
}
const lufs = power => -0.691 + 10 * Math.log10(power || 1e-20);

// 統合ラウドネス（BS.1770：400ms の窓を 75% 重ね、-70 LUFS の絶対ゲートと、平均から -10 LU の相対ゲートをかけた平均）
function integratedLoudness(powers) {
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  const absolute = powers.filter(p => lufs(p) > -70);
  if (absolute.length === 0) return -Infinity;
  const gate = lufs(mean(absolute)) - 10;
  const relative = absolute.filter(p => lufs(p) > gate);
  return lufs(mean(relative));
}

function measure({ L, R, lastNoteOff }) {
  let peak = 0, sumL = 0, sumR = 0, nan = false;
  for (let i = 0; i < L.length; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nan = true; continue; }
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumL += l; sumR += r;
  }
  // 聞こえる大きさ：K 特性で重み付けし、400ms の窓（100ms ずつずらす）の大きさの最大（LUFS）
  const loud = Math.max(...blockPowers(L, R, SR, 0.1));
  // 余韻の最後の 50ms
  let tail = 0;
  for (let i = L.length - Math.round(0.05 * SR); i < L.length; i++) tail = Math.max(tail, Math.abs(L[i]), Math.abs(R[i]));
  return {
    peak:  db(peak),
    loud:  lufs(loud),
    dc:    db(Math.max(Math.abs(sumL), Math.abs(sumR)) / L.length),
    tail:  db(tail),
    nan,
    after: (L.length - lastNoteOff) / SR,
  };
}

function writeWav(path, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  const s16 = v => Math.max(-32768, Math.min(32767, Math.round((Number.isFinite(v) ? v : 0) * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(s16(L[i]), 44 + i * 4); buf.writeInt16LE(s16(R[i]), 46 + i * 4); }
  writeFileSync(path, buf);
}

// WAV を読む（PCM 16 / 24 / 32 ビットと 32 ビット浮動小数。左右以外のチャンネルは使わない。モノラルは左右に同じ音）
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("WAV ではありません");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4), size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10),
              sr: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
      // WAVE_FORMAT_EXTENSIBLE は、サブフォーマットの先頭2バイトが本当の形式（1 = PCM、3 = 浮動小数）
      if (fmt.format === 0xfffe && size >= 26) fmt.format = buf.readUInt16LE(pos + 8 + 24);
    }
    if (id === "data") data = { start: pos + 8, size: Math.min(size, buf.length - pos - 8) };
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("fmt / data チャンクがありません");
  const bytes = fmt.bits / 8, frame = bytes * fmt.channels, n = Math.floor(data.size / frame);
  if (fmt.format !== 1 && fmt.format !== 3) throw new Error(`対応していない形式です（${fmt.format}）`);
  const float = fmt.format === 3;
  const read = off => float ? buf.readFloatLE(off)
    : fmt.bits === 16 ? buf.readInt16LE(off) / 32768
    : fmt.bits === 24 ? buf.readIntLE(off, 3) / 8388608
    : buf.readInt32LE(off) / 2147483648;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = data.start + i * frame;
    L[i] = read(off);
    R[i] = fmt.channels > 1 ? read(off + bytes) : L[i];
  }
  return { L, R, sr: fmt.sr };
}

// ファイル名の * / ? を展開する（フォルダの部分は展開しない）。一致するものがなければ空
function expandWildcard(path) {
  if (!/[*?]/.test(path)) return [path];
  const dir = dirname(path), name = path.slice(dir.length).replace(/^[\\/]/, "");
  const pattern = new RegExp("^" + name.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  try {
    return readdirSync(dir).filter(f => pattern.test(f)).sort().map(f => join(dir, f));
  } catch {
    return [];
  }
}

// ===== 実行 =====
// --analyze <WAV …>：Toniq で書き出した曲などの WAV を測る（ピーク・統合ラウドネス・聞こえる大きさの最大）。
// mix_presets.json の gain の確認（ピーク -1dB 以下）に使う
const analyzeAt = args.indexOf("--analyze");
if (analyzeAt >= 0) {
  // PowerShell・cmd はワイルドカード（*.wav など）を展開せずに渡すので、ここで展開する
  const files = args.slice(analyzeAt + 1).filter(a => !a.startsWith("--")).flatMap(expandWildcard);
  if (files.length === 0) console.error("--analyze のあとに WAV のパスを指定してください（見つかりませんでした）");
  for (const file of files) {
    const { L, R, sr } = readWav(file);
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const integrated = integratedLoudness(blockPowers(L, R, sr, 0.1));
    const momentary  = lufs(Math.max(...blockPowers(L, R, sr, 0.1)));
    const f = v => (v === -Infinity ? "-inf" : v.toFixed(1));
    console.log(`${file}\n  ${sr} Hz・${(L.length / sr).toFixed(1)} 秒  ピーク ${f(db(peak))} dBFS${db(peak) > -1 ? "（-1dB 超）" : ""}`
      + `  統合 ${f(integrated)} LUFS  最大 ${f(momentary)} LUFS`);
  }
  process.exit(0);
}

const targets = only ? presets.filter(p => only.includes(p.id)) : presets;
if (only && targets.length < only.length) {
  console.error(`見つからない ID：${only.filter(id => !presets.some(p => p.id === id)).join(", ")}`);
}
if (flag("--wav")) mkdirSync(OUT, { recursive: true });

const results = targets.map(p => {
  const role = ROLES[p.id] ?? "lead";
  const audio = render(p, role);
  const m = measure(audio);
  if (flag("--wav")) writeWav(join(OUT, `${p.id}.wav`), audio.L, audio.R);
  const master = info.grow_preset_value(p.index, masterIndex);
  // 聞こえる大きさを TARGET にそろえる master（出力段のリミッター・ソフトクリップの手前なのでほぼ比例する）
  const target = TARGETS[p.id] ?? TARGET;
  const gap = role === "drum" ? (DRUM_PEAKS[p.id] ?? DRUM_PEAK) - m.peak : target - m.loud;
  const suggest = FIXED.has(p.id) ? null : Math.round((master + gap) * 10) / 10;
  const problems = [
    m.nan && "NaN",
    m.peak === -Infinity && "無音",
    m.dc > -50 && "直流",
    m.tail > -70 && "余韻が消えない",
    m.peak > -1 && "ピーク -1dB 超",
  ].filter(Boolean);
  if (suggest !== null && suggest > MASTER_MAX) problems.push(`master が上限（+${MASTER_MAX}dB）を超える`);
  return { ...p, role, master, ...m, target, suggest, problems };
});

if (flag("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const f = v => (v === -Infinity ? "-inf" : v.toFixed(1)).padStart(6);
  console.log(`grow ${presets.length} プリセット・${paramCount} パラメーター（${SR} Hz・${BPM} BPM）。聞こえる大きさの目標 ${TARGET} LUFS`);
  console.log("ID                 役割   peak    LUFS   master  " + (flag("--suggest") ? "→ 提案  " : "") + "問題");
  results.forEach(r => {
    const sug = flag("--suggest") ? (r.suggest === null ? "  固定  " : `→${f(r.suggest)} `) : "";
    console.log(`${r.id.padEnd(18)} ${r.role.padEnd(5)} ${f(r.peak)} ${f(r.loud)}  ${f(r.master)}  ${sug}${r.problems.join("・")}  ${r.name}`);
  });
  if (flag("--wav")) console.log(`WAV：${OUT}`);
}
// 壊れている音（NaN・無音・直流・余韻が消えない）があれば終了コード 1
const bad = results.filter(r => r.nan || r.peak === -Infinity || r.dc > -50 || r.tail > -70);
process.exitCode = bad.length ? 1 : 0;
