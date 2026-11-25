import { describe, it, expect, beforeEach, vi } from "vitest";

// 書き出しの合成中は、Tone.getContext() / getTransport() が再生用のものに戻っている。
// 各パートのコールバックで使うもの（沈めるゲイン・BPM）が、読み込んだ時点のコンテキスト（書き出し用）のままかを確かめる

const env = vi.hoisted(() => {
  const gain = () => ({
    gain: { cancelAndHoldAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  });
  const make = (bpm: number) => ({
    transport: { bpm: { value: bpm } },
    ducks:  { bass: gain(), pad: gain() } as Record<string, ReturnType<typeof gain>>,
    reverb: gain(),
  });
  return { gain, make, current: make(120) };
});

vi.mock("tone", () => ({
  getTransport: () => env.current.transport,
  getContext:   () => env.current,
  // 長さの換算（"16n"・"1m" だけ扱う）：渡したコンテキストの BPM で秒にする
  TimeClass: class {
    private readonly bpm: () => number;
    private readonly value: string;
    constructor(context: { transport: { bpm: { value: number } } }, value: string) {
      this.bpm   = () => context.transport.bpm.value;
      this.value = value;
    }
    toSeconds(): number {
      const beats = this.value.endsWith("m") ? 4 * parseFloat(this.value) : 4 / parseFloat(this.value);
      return beats * 60 / this.bpm();
    }
  },
}));
vi.mock("../src/engine/VolumeManager", () => ({ duckGains: () => env.current.ducks }));
vi.mock("../src/engine/MixerEngine", () => ({ reverbDuckGain: () => env.current.reverb, REVERB_DUCK_WEIGHT: 0.5 }));

import { createSidechain } from "../src/engine/Groove";
import { secondsOf } from "../src/engine/LoopArranger";
import { setState } from "../src/engine/AppState";
import { resetState } from "./helpers";

// ゲインが沈んで戻る予定（戻りの値・時刻）
const hits = (g: ReturnType<typeof env.gain>) => g.gain.exponentialRampToValueAtTime.mock.calls;

beforeEach(() => {
  resetState();
  setState({ sidechain: 100 });
});

describe("書き出しの合成中（コンテキストが再生用に戻ったあと）", () => {
  it("サイドチェインは、読み込んだ時点のコンテキストのゲインだけを沈める", () => {
    const live = env.make(120), offline = env.make(80);
    env.current = offline;
    const sidechain = createSidechain();  // 書き出し用のコンテキストで読み込む
    env.current = live;                   // 合成が始まると再生用に戻る
    sidechain(2, 1);

    expect(hits(offline.ducks.bass)).toHaveLength(1);
    expect(hits(offline.ducks.pad)).toHaveLength(1);
    expect(hits(offline.reverb)).toHaveLength(1);
    expect(hits(live.ducks.bass)).toHaveLength(0);
    expect(hits(live.reverb)).toHaveLength(0);

    // 戻る時刻も書き出す曲の BPM（80）で決まる：沈むまで 4ms ＋ 拍の6割
    const [value, time] = hits(offline.ducks.bass)[0];
    expect(value).toBe(1);
    expect(time).toBeCloseTo(2 + 0.004 + (60 / 80) * 0.6);
  });

  it("ドラムより後に鳴らし始めたパートも沈める", () => {
    env.current = env.make(120);
    const sidechain = createSidechain();
    env.current.ducks.chord = env.gain();
    sidechain(1, 1);
    expect(hits(env.current.ducks.chord)).toHaveLength(1);
  });

  it("量が 0 なら沈めない。量は鳴らすたびに読む", () => {
    env.current = env.make(120);
    const sidechain = createSidechain();
    setState({ sidechain: 0 });
    sidechain(1, 1);
    expect(hits(env.current.ducks.bass)).toHaveLength(0);
    setState({ sidechain: 50 });
    sidechain(2, 1);
    expect(hits(env.current.ducks.bass)).toHaveLength(1);
  });

  it("長さの換算は、読み込んだ時点のコンテキストの BPM（アルペジオの音の長さ・FX の盛り上げの長さ）", () => {
    const live = env.make(120), offline = env.make(80);
    env.current = offline;
    const seconds = secondsOf();
    env.current = live;
    expect(seconds("1m")).toBeCloseTo(3);      // BPM 80 の1小節（120 なら 2 秒）
    expect(seconds("16n")).toBeCloseTo(0.1875);
    // 再生中に BPM を変えたら、次に鳴らすときから変わる
    offline.transport.bpm.value = 160;
    expect(seconds("1m")).toBeCloseTo(1.5);
  });
});
