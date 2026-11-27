import * as Tone from "tone";
import { beatsPerBar, timeToBeats } from "./Meter";

// 曲全体の音の並び（コード・ベース・メロディなど）を鳴らす予定。
// Tone.Part は音1つごとに Transport の予定を作るので、曲全体（数百音）では読み込みに時間がかかり、再生の開始で画面が止まる。
// ここでは小節の中の位置ごとに予定を1つだけ作り（4/4 の16分音符なら最大 16 個）、その時刻に今の小節の音を鳴らす。
// Transport の繰り返しの予定なので、スウィング・BPM の変更・ループ・途中からの再生は Tone.Part と同じように効く

// 音1つ。time は「小節:拍:16分」（Meter.ts の unitTime / barTime / unitsToTime の形）
export interface TrackEvent {
  time: string;
}

export interface Track {
  // 同じ音の並びを、今のコンテキストで鳴らす予定か（作り直さなくてよいか）
  isSame(events: readonly TrackEvent[], loopBars: number): boolean;
  dispose(): void;
}

// 予定の時刻に足すわずかな量（tick）。Tone.js は tick → 秒 → tick と換算するので、誤差で整数をわずかに下回ることがあり、
// そのときは端数を2回足して1ティック（BPM 140 で約 2ms）遅れて鳴らす。端数が出ても下回らないようにする
const TICK_EPSILON = 1e-4;

// events を loopBars 小節ごとにくり返し鳴らす予定を作る（Transport の先頭から。ループの終わりより後ろの音は鳴らさない）。
// 予定は作った時点のコンテキストの Transport に入れる（書き出しなら書き出し用）
export function createTrack<T extends TrackEvent>(
  events: readonly T[], loopBars: number, callback: (time: number, event: T) => void,
): Track {
  const context   = Tone.getContext();
  const transport = Tone.getTransport();
  const barTicks  = transport.PPQ * beatsPerBar();
  const ticks     = (n: number) => new Tone.TicksClass(context, n);

  // 小節の中の位置（tick）→ ループの中の小節 → その位置で鳴る音
  const slots = new Map<number, Map<number, T[]>>();
  for (const event of events) {
    const tick = Math.round(timeToBeats(event.time) * transport.PPQ);
    const bar  = Math.floor(tick / barTicks);
    if (bar >= loopBars) continue;
    const slot = tick - bar * barTicks;
    const bars = slots.get(slot) ?? new Map<number, T[]>();
    slots.set(slot, bars);
    const list = bars.get(bar);
    if (list) list.push(event);
    else bars.set(bar, [event]);
  }

  const ids = [...slots].map(([slot, bars]) => transport.scheduleRepeat(time => {
    // スウィングで後ろへずれていても、ずれは1小節よりずっと小さいので、丸めればその小節になる
    const bar = Math.round((transport.getTicksAtTime(time) - slot) / barTicks);
    bars.get(bar % loopBars)?.forEach(event => callback(time, event));
  }, ticks(barTicks), ticks(slot + TICK_EPSILON)));

  return {
    isSame: (other, bars) => transport === Tone.getTransport() && barTicks === transport.PPQ * beatsPerBar()
      && bars === loopBars && JSON.stringify(other) === JSON.stringify(events),
    dispose: () => ids.forEach(id => transport.clear(id)),
  };
}
