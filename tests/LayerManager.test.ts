import { describe, it, expect, beforeEach, vi } from "vitest";

// パートの ON/OFF を切り替えたときの、読み込み・破棄（音を出す部分は外す）
const transport = vi.hoisted(() => ({ state: "started" }));
vi.mock("tone", () => ({ getTransport: () => transport }));
vi.mock("../src/engine/DrumEngine",      () => ({ loadDrumPattern: vi.fn(), disposeDrum: vi.fn() }));
vi.mock("../src/engine/ChordPlayer",     () => ({ loadChordProgression: vi.fn(), disposeChord: vi.fn() }));
vi.mock("../src/engine/BassPlayer",      () => ({ loadBassLine: vi.fn(), disposeBass: vi.fn() }));
vi.mock("../src/engine/ArpPlayer",       () => ({ loadArpPattern: vi.fn(), disposeArp: vi.fn() }));
vi.mock("../src/engine/PadPlayer",       () => ({ loadPadPattern: vi.fn(), disposePad: vi.fn() }));
vi.mock("../src/engine/SignaturePlayer", () => ({ loadSignature: vi.fn(), disposeSignature: vi.fn() }));
vi.mock("../src/engine/MelodyPlayer",    () => ({ loadMelody: vi.fn(), disposeMelody: vi.fn() }));
vi.mock("../src/engine/FxPlayer",        () => ({ loadFx: vi.fn(), disposeFx: vi.fn() }));
vi.mock("../src/engine/CounterPlayer",   () => ({ loadCounter: vi.fn(), disposeCounter: vi.fn() }));
vi.mock("../src/engine/PercPlayer",      () => ({ loadPerc: vi.fn(), disposePerc: vi.fn() }));

import { loadLayers, reloadAllLayers, reloadLayer, setLayerEnabled } from "../src/engine/LayerManager";
import { loadBassLine, disposeBass } from "../src/engine/BassPlayer";
import { loadChordProgression, disposeChord } from "../src/engine/ChordPlayer";
import { loadMelody } from "../src/engine/MelodyPlayer";
import { loadCounter } from "../src/engine/CounterPlayer";
import { loadDrumPattern } from "../src/engine/DrumEngine";
import { setArrangementBypass } from "../src/engine/LoopArranger";
import { getState, setState } from "../src/engine/AppState";
import { chords, drums, resetState } from "./helpers";

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  setState({ chordPattern: chords[0], drumPattern: drums[0], parts: { ...getState().parts, bass: false } });
  setArrangementBypass(false);
  transport.state = "started";
});

describe("setLayerEnabled（パートの ON/OFF）", () => {
  it("曲の再生中：ON ですぐ読み込み、OFF で破棄する", () => {
    setLayerEnabled("bass", true);
    expect(getState().parts.bass).toBe(true);
    expect(loadBassLine).toHaveBeenCalledTimes(1);
    setLayerEnabled("bass", false);
    expect(disposeBass).toHaveBeenCalled();
  });

  it("試聴中：ON/OFF は変わるが、試聴していないパートを鳴らさず、試聴しているパートも止めない", () => {
    setArrangementBypass(true);  // コード進行の試聴中
    setLayerEnabled("bass", true);
    expect(getState().parts.bass).toBe(true);
    expect(loadBassLine).not.toHaveBeenCalled();
    setLayerEnabled("chord", false);
    expect(getState().parts.chord).toBe(false);
    expect(disposeChord).not.toHaveBeenCalled();
  });
});

describe("読み込み", () => {
  it("まとめて読み込むとき、ON のパートを1回ずつ読み込む（メロディから決まるコード・カウンターメロディも）", () => {
    reloadAllLayers();
    expect(loadDrumPattern).toHaveBeenCalledTimes(1);
    expect(loadMelody).toHaveBeenCalledTimes(1);
    expect(loadChordProgression).toHaveBeenCalledTimes(1);
    expect(loadCounter).toHaveBeenCalledTimes(1);
    expect(loadBassLine).not.toHaveBeenCalled();  // OFF
  });

  it("メロディを読み込み直すと、ON のカウンターメロディとコードも読み込み直す", () => {
    reloadLayer("melody");
    expect([loadMelody, loadCounter, loadChordProgression].map(f => vi.mocked(f).mock.calls.length)).toEqual([1, 1, 1]);
    vi.clearAllMocks();
    setState({ parts: { ...getState().parts, counter: false } });
    reloadLayer("melody");
    expect([loadMelody, loadCounter, loadChordProgression].map(f => vi.mocked(f).mock.calls.length)).toEqual([1, 0, 1]);
  });

  it("選んだパートだけを読み込む（サンプルで、カウンターメロディを鳴らさない）", () => {
    loadLayers(["chord", "melody"]);
    expect(loadMelody).toHaveBeenCalledTimes(1);
    expect(loadChordProgression).toHaveBeenCalledTimes(1);
    expect(loadCounter).not.toHaveBeenCalled();
  });
});
