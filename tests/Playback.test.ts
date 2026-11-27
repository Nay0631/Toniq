import { describe, it, expect, beforeEach, vi } from "vitest";

// 再生の終わり方（自動停止）と、書き出す内容。音を出す部分・画面は外し、Tone.js は時計と予定だけの代わりを使う。
// getDraw（画面の描画に合わせる予定）は、描画が止まっていると捨てられるので使わない（呼んだら失敗させる）

const tone = vi.hoisted(() => {
  let nextId = 1;
  const context = {
    sampleRate: 44100,
    currentTime: 10,
    timers: new Map<number, { fn: () => void; at: number }>(),
    setTimeout(fn: () => void, seconds: number): number {
      const id = nextId++;
      context.timers.set(id, { fn, at: context.currentTime + seconds });
      return id;
    },
    clearTimeout(id: number): void { context.timers.delete(id); },
    // オーディオの時計を進める（描画が止まっていても進む）
    advance(seconds: number): void {
      context.currentTime += seconds;
      for (const [id, t] of [...context.timers]) {
        if (t.at > context.currentTime + 1e-9) continue;
        context.timers.delete(id);
        t.fn();
      }
    },
  };
  const transport = {
    state: "stopped", PPQ: 192, ticks: 0, position: 0 as number | string, bpm: { value: 120 }, timeSignature: 4,
    loop: false, loopStart: 0 as number | string, loopEnd: 0 as number | string,
    once: new Map<number, { fn: (time: number) => void; at: string }>(),
    start(): void { transport.state = "started"; },
    stop():  void { transport.state = "stopped"; },
    scheduleOnce(fn: (time: number) => void, at: string): number {
      const id = nextId++;
      transport.once.set(id, { fn, at });
      return id;
    },
    scheduleRepeat(): number { return nextId++; },
    clear(id: number): void { transport.once.delete(id); },
    getTicksAtTime(): number { return 0; },
    // 終わりの予定を呼ぶ（Tone.js は 0.1 秒前に、その時刻を渡して呼ぶ）
    reachEnd(): void {
      for (const [id, e] of [...transport.once]) {
        transport.once.delete(id);
        e.fn(context.currentTime + 0.1);
      }
    },
  };
  const rendered = { numberOfChannels: 2, length: 128, sampleRate: 44100, getChannelData: () => new Float32Array(128) };
  return { context, transport, rendered, offlineRenders: 0 };
});

vi.mock("tone", () => ({
  start:        async () => {},
  now:          () => tone.context.currentTime + 0.1,
  getContext:   () => tone.context,
  getTransport: () => tone.transport,
  getDraw:      () => { throw new Error("終わりの合図に getDraw を使わない"); },
  // 書き出し：OfflineAudioContext のない Node では、Tone.Offline で描き直す経路になる
  Offline: async (schedule: () => Promise<void>) => {
    tone.offlineRenders++;
    await schedule();
    return { get: () => ({ numberOfChannels: 1, length: 1, getChannelData: () => new Float32Array([0.5]) }) };
  },
  OfflineContext: class {
    currentTime = 0;
    async render() { return { get: () => tone.rendered }; }
  },
  setContext: () => {},
}));
vi.mock("../src/engine/MixerEngine", () => ({
  applyMixPreset: vi.fn(), fadeOutMaster: vi.fn(), holdMasterFade: vi.fn(), resetMasterFade: vi.fn(),
}));
vi.mock("../src/engine/LayerManager", () => ({ disposeAllLayers: vi.fn(), loadLayers: vi.fn(), reloadLayer: vi.fn(), reloadAllLayers: vi.fn() }));
vi.mock("../src/engine/Metronome",    () => ({ stopMetronome: vi.fn() }));
vi.mock("../src/engine/ScalePreview", () => ({ stopScalePreview: vi.fn() }));
vi.mock("../src/engine/GrowPreview",  () => ({ stopGrowPreview: vi.fn() }));
vi.mock("../src/engine/DrumSamples",  () => ({ prepareDrumSamples: async () => {} }));
vi.mock("../src/engine/History",      () => ({ withoutHistory: (fn: () => unknown) => fn() }));
vi.mock("../src/engine/Groove",       () => ({ applySwing: vi.fn() }));
vi.mock("../src/engine/Grow",         () => ({ prepareGrowContext: vi.fn(async () => true), applyGrowBpm: vi.fn() }));
vi.mock("../src/engine/DrumEngine",   () => ({ loadDrumPattern: vi.fn(), blockDrumPattern: vi.fn(() => null) }));
vi.mock("../src/engine/ChordPlayer",  () => ({ initChordSynth: vi.fn(), loadChordProgression: vi.fn() }));
vi.mock("../src/engine/BassPlayer",   () => ({ initBassSynth: vi.fn(), loadBassLine: vi.fn() }));
vi.mock("../src/engine/ArpPlayer",    () => ({ initArpSynth: vi.fn(), loadArpPattern: vi.fn() }));
vi.mock("../src/engine/PadPlayer",    () => ({ initPadSynth: vi.fn(), loadPadPattern: vi.fn() }));
vi.mock("../src/engine/SignaturePlayer", () => ({ initSignatureSynth: vi.fn(), loadSignature: vi.fn() }));
vi.mock("../src/engine/MelodyPlayer", () => ({ initMelodySynth: vi.fn(), loadMelody: vi.fn() }));
vi.mock("../src/engine/CounterPlayer", () => ({ initCounterSynth: vi.fn(), loadCounter: vi.fn() }));
vi.mock("../src/engine/PercPlayer",   () => ({ loadPerc: vi.fn() }));
vi.mock("../src/engine/FxPlayer",     () => ({ initFxSynth: vi.fn(), loadFx: vi.fn(), fxPreviewStartBar: () => 0 }));

import * as Playback from "../src/engine/Playback";
import { loadChordProgression } from "../src/engine/ChordPlayer";
import { isArrangementBypassed } from "../src/engine/LoopArranger";
import { applyMixPreset } from "../src/engine/MixerEngine";
import { prepareGrowContext } from "../src/engine/Grow";
import { reloadAllLayers, reloadLayer } from "../src/engine/LayerManager";
import { getState, setState } from "../src/engine/AppState";
import { blockDrumPattern } from "../src/engine/DrumEngine";
import { chords, drums, resetState } from "./helpers";

const base = chords.find(c => c.length_bars === 4)!;

beforeEach(() => {
  Playback.stop();
  resetState();
  setState({ chordPattern: base, chorusPattern: null, drumPattern: drums[0], bars: 32 });
  tone.transport.once.clear();
  tone.context.timers.clear();
});

describe("自動停止（画面の描画が止まっていても止まる）", () => {
  it("曲：終わりの時刻に止まり、onEnded を1回だけ呼ぶ", async () => {
    const onEnded = vi.fn();
    expect(await Playback.play({ onEnded })).toBe(true);
    expect([...tone.transport.once.values()].map(e => e.at)).toEqual(["33m"]);  // エンディングの余韻で1小節あと

    tone.transport.reachEnd();  // 0.1 秒前に合図が来る。まだ鳴っている
    expect(Playback.isPlaying()).toBe(true);
    tone.context.advance(0.1);
    expect(Playback.isPlaying()).toBe(false);
    expect(onEnded).toHaveBeenCalledTimes(1);
    tone.context.advance(10);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it.each(["chord", "drum", "fx"] as const)("試聴（%s）：終わりの時刻に止まり、アレンジの判定を戻す", async layer => {
    const onEnded = vi.fn();
    expect(await Playback.preview(layer, onEnded)).toBe(true);
    expect(isArrangementBypassed()).toBe(true);
    tone.transport.reachEnd();
    tone.context.advance(0.1);
    expect(Playback.isPlaying()).toBe(false);
    expect(isArrangementBypassed()).toBe(false);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("サンプル：決めた秒数で止まり、差し替えた曲の内容を戻す", async () => {
    const onEnded = vi.fn();
    const other = chords.find(c => c.id !== base.id)!;
    await Playback.playSample({ chordPattern: other, drumPattern: drums[1], meter: "4/4", melody: () => [] }, onEnded);
    expect(getState().chordPattern).toBe(other);
    tone.context.advance(Playback.SAMPLE_SECONDS);
    expect(Playback.isPlaying()).toBe(true);  // 鳴り始めは 0.1 秒あと（先読みぶん）なので、まだフェードの終わり
    tone.context.advance(0.1);
    expect(Playback.isPlaying()).toBe(false);
    expect(getState().chordPattern).toBe(base);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("終わりの合図のあと再生し直したら、前の合図では止まらない", async () => {
    await Playback.play();
    tone.transport.reachEnd();
    await Playback.play();
    tone.context.advance(1);
    expect(Playback.isPlaying()).toBe(true);
  });

  it("終わりの合図のあとでも、ループ再生を ON にすれば続ける", async () => {
    await Playback.play();
    tone.transport.reachEnd();
    setState({ loopPlayback: true });
    Playback.applyLoopPlayback();
    tone.context.advance(1);
    expect(Playback.isPlaying()).toBe(true);
    expect(tone.transport.loop).toBe(true);
  });

  it("終わりの合図のあと終わり方を当て直しても、決めた時刻に止まる", async () => {
    await Playback.play();
    tone.transport.reachEnd();
    Playback.applyLoopPlayback();  // 終わりの小節はもう過ぎているので、予定し直すと止まらなくなる
    tone.context.advance(0.1);
    expect(Playback.isPlaying()).toBe(false);
  });
});

describe("音源の準備を待っている間の変更", () => {
  // 次の準備を、返す関数を呼ぶまで待たせる
  function holdPreparation(): () => void {
    let release = () => {};
    vi.mocked(prepareGrowContext).mockImplementationOnce(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    return () => release();
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => { vi.mocked(applyMixPreset).mockClear(); });

  it("曲：待っている間に変えた BPM・ジャンルで鳴らし始める", async () => {
    setState({ genre: "EDM", bpm: 128 });
    const release = holdPreparation();
    const playing = Playback.play();
    await settle();
    expect(Playback.isStarting()).toBe(true);
    setState({ genre: "ローファイ", bpm: 80 });
    release();
    expect(await playing).toBe(true);
    expect(Playback.isStarting()).toBe(false);
    expect(tone.transport.bpm.value).toBe(80);
    expect(vi.mocked(applyMixPreset).mock.calls.map(c => c[0])).toEqual(["EDM", "ローファイ"]);  // ミックスも新しいジャンル
  });

  it("コード進行の試聴：待っている間に選び直した進行の長さで止める", async () => {
    const eight = chords.find(c => c.length_bars === 8)!;
    const release = holdPreparation();
    const playing = Playback.preview("chord");
    await settle();
    setState({ chordPattern: eight });
    release();
    expect(await playing).toBe(true);
    expect([...tone.transport.once.values()].map(e => e.at)).toEqual(["8m"]);
  });

  it("待っている間に止めたら始めない", async () => {
    const release = holdPreparation();
    const playing = Playback.play();
    await settle();
    Playback.stop();
    expect(Playback.isStarting()).toBe(false);
    release();
    expect(await playing).toBe(false);
    expect(Playback.isPlaying()).toBe(false);
  });

  it("待っている間に別の再生が始まったら、あとのものだけが鳴る", async () => {
    vi.mocked(reloadAllLayers).mockClear();
    const release = holdPreparation();
    const first = Playback.play();
    await settle();
    expect(await Playback.preview("drum")).toBe(true);
    release();
    expect(await first).toBe(false);
    expect(reloadAllLayers).not.toHaveBeenCalled();
    expect(Playback.currentPreview()).toBe("drum");
  });

  it("サンプル：待っている間も「鳴らしている」とみなし、止めれば取りやめる（曲の内容は差し替えない）", async () => {
    const other = chords.find(c => c.id !== base.id)!;
    const release = holdPreparation();
    const playing = Playback.playSample({ chordPattern: other, drumPattern: drums[1], meter: "4/4", melody: () => [] });
    await settle();
    expect(Playback.isSamplePlaying()).toBe(true);
    Playback.stopSample();  // 画面を移った
    release();
    expect(await playing).toBe(false);
    expect(Playback.isSamplePlaying()).toBe(false);
    expect(getState().chordPattern).toBe(base);
  });
});

describe("鳴らしているものの種類", () => {
  it("曲・試聴・サンプルを見分ける", async () => {
    expect([Playback.isSongPlaying(), Playback.currentPreview()]).toEqual([false, null]);
    await Playback.play();
    expect([Playback.isSongPlaying(), Playback.currentPreview()]).toEqual([true, null]);
    await Playback.preview("chord");
    expect([Playback.isSongPlaying(), Playback.currentPreview()]).toEqual([false, "chord"]);
    expect(reloadLayer).toHaveBeenLastCalledWith("chord");
    await Playback.playSample({ chordPattern: base, drumPattern: drums[0], meter: "4/4", melody: () => [] });
    expect([Playback.isSongPlaying(), Playback.currentPreview(), Playback.isSamplePlaying()]).toEqual([false, null, true]);
    Playback.stop();
    expect([Playback.isSongPlaying(), Playback.currentPreview(), Playback.isSamplePlaying()]).toEqual([false, null, false]);
  });
});

describe("書き出す内容", () => {
  it("試聴の途中で書き出しても、曲全体の並び（サビ・エンディング込み）を書き出す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});  // Tone.Offline で描き直す知らせは出さない
    await Playback.preview("chord");
    vi.mocked(loadChordProgression).mockClear();
    await Playback.renderSong();
    warn.mockRestore();

    const song = vi.mocked(loadChordProgression).mock.calls[0][0];
    expect(song.length_bars).toBe(32);
    expect(song.progression.some(c => c.section === "B")).toBe(true);
    expect(song.progression[song.progression.length - 1].ending).toBe(true);
  });
});

describe("書き出した音声が無音のとき", () => {
  // 合成は無音を返す（OfflineAudioContext の代わり）。描き直した回数を数える
  beforeEach(() => {
    vi.stubGlobal("OfflineAudioContext", class { suspend() { return new Promise(() => {}); } });
    tone.offlineRenders = 0;
    vi.mocked(blockDrumPattern).mockReturnValue(drums[0]);
    const parts = { ...getState().parts };
    for (const k of Object.keys(parts) as (keyof typeof parts)[]) parts[k] = false;
    setState({ parts, melodyNotes: [], chorusMelodyNotes: [] });
    return () => vi.unstubAllGlobals();
  });
  const on = (...names: (keyof ReturnType<typeof getState>["parts"])[]) =>
    setState({ parts: { ...getState().parts, ...Object.fromEntries(names.map(n => [n, true])) } });

  it("鳴るはずのパートがあれば、Tone.Offline で描き直す（保険）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    on("chord");
    await Playback.renderSong();
    expect(tone.offlineRenders).toBe(1);
    warn.mockRestore();
  });

  it("もともと無音の曲は描き直さない（FX だけ・メロディが空・音量 0・空のドラム・全部 OFF）", async () => {
    await Playback.renderSong();
    on("fx");
    await Playback.renderSong();
    on("melody", "counter");
    await Playback.renderSong();
    on("bass");
    setState({ volumes: { ...getState().volumes, bass: 0 } });
    await Playback.renderSong();
    on("drum");
    const empty = { ...drums[0], tracks: Object.fromEntries(Object.entries(drums[0].tracks).map(([n, t]) => [n, { ...t, pattern: t.pattern.map(() => 0) }])) };
    vi.mocked(blockDrumPattern).mockReturnValue(empty);
    await Playback.renderSong();
    expect(tone.offlineRenders).toBe(0);
  });
});

describe("WAV への変換", () => {
  it("16bit・左右交互・リトルエンディアンで書き、範囲を超えた音は収める", async () => {
    const left = new Float32Array([0.5, 0, 1, 2]), right = new Float32Array([-0.5, 0, -1, -2]);
    vi.stubGlobal("OfflineAudioContext", class { suspend() { return new Promise(() => {}); } });
    const before = { ...tone.rendered };
    Object.assign(tone.rendered, { length: 4, getChannelData: (ch: number) => (ch === 0 ? left : right) });
    const blob = await Playback.renderWav();
    Object.assign(tone.rendered, before);
    vi.unstubAllGlobals();
    const view = new DataView(await blob.arrayBuffer());
    expect(view.byteLength).toBe(44 + 4 * 2 * 2);
    expect(view.getUint32(40, true)).toBe(16);
    const samples = Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([16383, -16384, 0, 0, 32767, -32768, 32767, -32768]);
  });
});
