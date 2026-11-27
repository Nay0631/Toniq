import { describe, it, expect, beforeEach, vi } from "vitest";

// 音の並びの予定（Track.ts）。Transport は tick の時計と繰り返しの予定だけの代わりを使う。
// 時刻（秒）は tick をそのまま使い、スウィングなどで後ろへずらした時刻を渡せるようにする
const fake = vi.hoisted(() => {
  let nextId = 1;
  const make = () => {
    const repeats = new Map<number, { fn: (time: number) => void; interval: number; start: number }>();
    return {
      PPQ: 192,
      repeats,
      scheduleRepeat(fn: (time: number) => void, interval: { value: number }, start: { value: number }): number {
        const id = nextId++;
        repeats.set(id, { fn, interval: interval.value, start: start.value });
        return id;
      },
      clear(id: number): void { repeats.delete(id); },
      getTicksAtTime(time: number): number { return time; },
      // from（tick）から to の手前まで鳴らす。shift = 予定の時刻から後ろへずらす量（スウィング）
      run(from: number, to: number, shift: (tick: number) => number = () => 0): void {
        for (let tick = from; tick < to; tick++) {
          for (const r of repeats.values()) {
            const at = Math.floor(r.start);
            if (tick >= at && (tick - at) % r.interval === 0) r.fn(tick + shift(tick));
          }
        }
      },
    };
  };
  return { make, transport: make() };
});
vi.mock("tone", () => ({
  getContext:   () => ({}),
  getTransport: () => fake.transport,
  TicksClass:   class { value: number; constructor(_context: unknown, value: number) { this.value = value; } },
}));

import { createTrack } from "../src/engine/Track";
import { setState } from "../src/engine/AppState";
import { resetState } from "./helpers";

const BAR = 768;  // 4/4 の1小節（tick）
interface Note { time: string; name: string }

beforeEach(() => {
  resetState();
  fake.transport = fake.make();
});

// 鳴った音を「tick:名前」で集める
function play(events: Note[], loopBars: number, from: number, to: number, shift?: (tick: number) => number): string[] {
  const out: string[] = [];
  createTrack(events, loopBars, (time, e) => out.push(`${Math.round(time)}:${e.name}`));
  fake.transport.run(from, to, shift);
  return out;
}

describe("createTrack（曲全体の音の並びを鳴らす）", () => {
  const events: Note[] = [
    { time: "0:0:0", name: "a" }, { time: "0:0:6", name: "b" }, { time: "1:0:0", name: "c" }, { time: "1:2:2", name: "d" },
  ];

  it("書いた位置で鳴らし、loopBars 小節ごとにくり返す", () => {
    expect(play(events, 2, 0, BAR * 4)).toEqual([
      "0:a", "288:b", "768:c", "1248:d", "1536:a", "1824:b", "2304:c", "2784:d",
    ]);
  });

  it("途中から鳴らすと、その小節の音から鳴る", () => {
    expect(play(events, 2, BAR, BAR * 2)).toEqual(["768:c", "1248:d"]);
    expect(play(events, 2, BAR * 3, BAR * 4)).toEqual(["2304:c", "2784:d"]);
  });

  it("同じ位置の音は書いた順に全部鳴らし、ループの終わりより後ろの音は鳴らさない", () => {
    const chord: Note[] = [{ time: "0:0:0", name: "x" }, { time: "0:0:0", name: "y" }, { time: "2:0:0", name: "z" }];
    expect(play(chord, 2, 0, BAR * 2)).toEqual(["0:x", "0:y"]);
  });

  it("スウィングで後ろへずれた時刻でも、小節を間違えない（小節の最後のマスも）", () => {
    const last: Note[] = [{ time: "0:3:3", name: "p" }, { time: "1:3:3", name: "q" }];
    expect(play(last, 2, 0, BAR * 2, () => 43)).toEqual([`${720 + 43}:p`, `${BAR + 720 + 43}:q`]);
  });

  it("32分音符（16分の半分）と、3連符・3/4 の位置でも鳴る", () => {
    expect(play([{ time: "0:0:0.5", name: "t" }], 1, 0, BAR)).toEqual(["24:t"]);
    setState({ meter: "4/4t" });
    expect(play([{ time: `0:0:${4 / 3}`, name: "u" }], 1, 0, BAR)).toContain("64:u");
    setState({ meter: "3/4" });
    expect(play([{ time: "0:0:12", name: "v" }], 2, 0, 576 * 2)).toContain("576:v");  // 1小節 576 tick。2小節目の頭
  });

  it("予定は音の数ではなく小節の中の位置の数だけ作る", () => {
    const many = Array.from({ length: 512 }, (_, i) => ({ time: `0:0:${i}`, name: "n" }));
    createTrack(many, 32, () => {});
    expect(fake.transport.repeats.size).toBe(16);
  });

  it("端数の誤差で1ティック遅れないよう、予定の時刻をわずかに後ろにする", () => {
    createTrack(events, 2, () => {});
    for (const r of fake.transport.repeats.values()) {
      expect(r.start - Math.floor(r.start)).toBeGreaterThan(0);
      expect(r.start - Math.floor(r.start)).toBeLessThan(0.001);
    }
  });

  it("dispose で、作ったときの Transport の予定を消す", () => {
    const created = fake.transport;
    const track = createTrack(events, 2, () => {});
    fake.transport = fake.make();  // 書き出しのあと、再生用に戻っている
    track.dispose();
    expect(created.repeats.size).toBe(0);
  });

  it("isSame：音の並び・長さ・拍子・Transport が同じときだけ同じ", () => {
    const track = createTrack(events, 2, () => {});
    expect(track.isSame(events.map(e => ({ ...e })), 2)).toBe(true);
    expect(track.isSame(events.slice(1), 2)).toBe(false);
    expect(track.isSame(events, 4)).toBe(false);
    setState({ meter: "3/4" });
    expect(track.isSame(events, 2)).toBe(false);
    setState({ meter: "4/4" });
    fake.transport = fake.make();
    expect(track.isSame(events, 2)).toBe(false);
  });
});
