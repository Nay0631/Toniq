// フェーダーの値（0〜100）と音量（dB）の換算。Tone.js を使わないので、曲の読み込み（SongLibrary.ts）や画面からも読める。
//
// 2乗のカーブ（音量は値の2乗に比例）：75 で 0dB（パートの元の大きさ）、100 で +5dB、50 で −7dB、25 で −19dB、0 で無音。
// 以前は値に比例（100 で 0dB、50 で −6dB）で、上半分を動かしても 6dB しか変わらず、持ち上げることもできなかった

/** 0dB になるフェーダーの値 */
export const VOLUME_UNITY = 75;

/** フェーダーの値（0〜100）→ dB */
export function volumeToDb(value: number): number {
  if (value <= 0) return -Infinity;
  return 40 * Math.log10(value / VOLUME_UNITY);
}

/** dB → フェーダーの値（目盛りの位置に使う。0〜100 に収めない） */
export function dbToVolume(db: number): number {
  return VOLUME_UNITY * Math.pow(10, db / 40);
}

/** 以前のカーブ（20·log10(値/100)）で保存した値を、同じ大きさで鳴る今の値にする */
export function volumeFromLegacy(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return Math.round(VOLUME_UNITY * Math.sqrt(v / 100));
}

/** 定位（−100 = 左いっぱい 〜 0 = 中央 〜 100 = 右いっぱい）の表示（C / L25 / R25） */
export function panLabel(pan: number): string {
  const p = Math.round(pan);
  return p === 0 ? "C" : p < 0 ? `L${-p}` : `R${p}`;
}
