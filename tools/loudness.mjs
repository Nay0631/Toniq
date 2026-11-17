// 音声のピークと統合ラウドネス（ITU-R BS.1770。LUFS）を測る。Node でもブラウザでも動く（mix-measure.mjs がページの中で読む）。
// 計算は grow/tools/render.mjs の --analyze と同じ（あちらは単体で動かすので、同じ式をここにも持つ）

function biquad(x, b, a) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const out = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

// K 特性（高域の持ち上げ → 低域のカット）
function kWeight(x, sr) {
  let K = Math.tan(Math.PI * 1681.974450955533 / sr);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad(x,
    [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]);
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
const db   = v => 20 * Math.log10(v || 1e-10);

// 統合ラウドネス（-70 LUFS の絶対ゲートと、平均から -10 LU の相対ゲートをかけた平均）
function integratedLoudness(powers) {
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  const absolute = powers.filter(p => lufs(p) > -70);
  if (absolute.length === 0) return -Infinity;
  const gate = lufs(mean(absolute)) - 10;
  return lufs(mean(absolute.filter(p => lufs(p) > gate)));
}

/** 左右の音声（-1〜1）を測る。peak = サンプルのピーク（dBFS）、integrated = 統合ラウドネス、momentary = 400ms の窓の最大（LUFS）、balance = 左右の差（dB） */
export function analyze(L, R, sr) {
  let peak = 0, sumL = 0, sumR = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    sumL += L[i] * L[i];
    sumR += R[i] * R[i];
  }
  const powers = blockPowers(L, R, sr, 0.1);
  return {
    peak:       db(peak),
    balance:    10 * Math.log10((sumR || 1e-20) / (sumL || 1e-20)),  // 左右の大きさの差（dB。＋ = 右が大きい）
    integrated: integratedLoudness(powers),
    momentary:  powers.length > 0 ? lufs(Math.max(...powers)) : -Infinity,
    seconds:    L.length / sr,
  };
}
