// テスト用の Tone.js の代わり（vitest.config.ts で "tone" をこれに差し替える）。
// テストで使うのは Transport の時刻 → tick の変換だけ（LoopArranger.ts の arrangementGate など）。
// BPM 120・PPQ 192 として、1 秒 = 2 拍 = 384 tick
export const transport = {
  PPQ: 192,
  bpm: 120,
  getTicksAtTime(time: number): number {
    return time * (this.bpm / 60) * this.PPQ;
  },
};

export function getTransport() {
  return transport;
}
