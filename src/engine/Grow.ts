import * as Tone from "tone";
import workletSource from "./growWorklet.js?raw";
import { fetchArrayBuffer } from "./DrumSamples";
import { getState } from "./AppState";

// grow（Toniq の内部シンセ。C++ のコアを WebAssembly にしたもの。ソースは grow/）を Toniq の再生で鳴らす。
//   - wasm（public/grow/grow.wasm。npm run grow:wasm でビルド）を読み込み、画面のスレッドにも1つインスタンスを作って
//     パラメーターの表・プリセット・値の表示に使う（表はコアが決める。ここでは持たない）
//   - 音は AudioWorklet（growWorklet.js）の中の wasm で作る。AudioWorklet はオーディオコンテキストごとに登録する
//     （再生用と、WAV / MP3 書き出し用のオフラインのコンテキスト）
//   - 音符は AudioParam の1サンプルだけの合図で渡す（書き出しでもサンプル単位で合う）
// wasm がないとき（まだビルドしていない）は使えず、メロディはジャンルの標準の音色で鳴る。

const WASM_URL = "grow/grow.wasm";  // 開発サーバー（http）とビルド後の Electron（file://）の両方で読めるよう相対パス
// 音の終わりの合図を少し遅らせ、すき間なく続く音が重なるようにする（レガートでつながる）。
// 同じ高さの音が続くときは、ワークレットが前の音の終わりを無視する
const OFF_DELAY = 0.002;

export type GrowParamKind = "continuous" | "integer" | "choice" | "toggle";
const KINDS: GrowParamKind[] = ["continuous", "integer", "choice", "toggle"];

export interface GrowParamMeta {
  index:        number;
  id:           string;
  group:        string;
  name:         string;
  kind:         GrowParamKind;
  min:          number;
  max:          number;
  defaultValue: number;
  choices:      string[];
}

// 画面のスレッドの wasm（表・プリセット・表示用。音は作らない）
interface GrowExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  grow_param_count(): number;
  grow_param_id(i: number): number;
  grow_param_group(i: number): number;
  grow_param_name(i: number): number;
  grow_param_kind(i: number): number;
  grow_param_min(i: number): number;
  grow_param_max(i: number): number;
  grow_param_default(i: number): number;
  grow_param_num_choices(i: number): number;
  grow_param_choice(i: number, c: number): number;
  grow_param_to_normalised(i: number, v: number): number;
  grow_param_from_normalised(i: number, n: number): number;
  grow_param_format(i: number, v: number): number;
  grow_preset_count(): number;
  grow_preset_name(i: number): number;
  grow_preset_value(preset: number, i: number): number;
}

let wasmBytes: ArrayBuffer | null = null;
let ex: GrowExports | null = null;
let params: GrowParamMeta[] = [];
let presetNames: string[] = [];
let loading: Promise<boolean> | null = null;

const decoder = new TextDecoder();

function readString(ptr: number): string {
  const bytes = new Uint8Array(ex!.memory.buffer);
  let end = ptr;
  while (bytes[end] !== 0) end++;
  return decoder.decode(bytes.subarray(ptr, end));
}

// STANDALONE_WASM が求める取り込み（WASI など）は使わないので、何もしない関数で埋める
function stubImports(module: WebAssembly.Module): WebAssembly.Imports {
  const imports: Record<string, Record<string, () => number>> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.kind !== "function") continue;
    (imports[imp.module] ??= {})[imp.name] = () => 0;
  }
  return imports;
}

// wasm を読み込む（1回だけ）。使えるようになれば true
export function loadGrow(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const bytes = await fetchArrayBuffer(WASM_URL);
      if (!bytes) {
        console.warn(`grow の wasm（${WASM_URL}）がありません。npm run grow:wasm でビルドしてください`);
        return false;
      }
      const module   = await WebAssembly.compile(bytes);
      const instance = await WebAssembly.instantiate(module, stubImports(module));
      ex = instance.exports as unknown as GrowExports;
      ex._initialize?.();
      wasmBytes = bytes;

      const count = ex.grow_param_count();
      params = Array.from({ length: count }, (_, i) => ({
        index:        i,
        id:           readString(ex!.grow_param_id(i)),
        group:        readString(ex!.grow_param_group(i)),
        name:         readString(ex!.grow_param_name(i)),
        kind:         KINDS[ex!.grow_param_kind(i)] ?? "continuous",
        min:          ex!.grow_param_min(i),
        max:          ex!.grow_param_max(i),
        defaultValue: ex!.grow_param_default(i),
        choices:      Array.from({ length: ex!.grow_param_num_choices(i) }, (_, c) => readString(ex!.grow_param_choice(i, c))),
      }));
      presetNames = Array.from({ length: ex.grow_preset_count() }, (_, i) => readString(ex!.grow_preset_name(i)));
      return true;
    } catch (e) {
      console.warn("grow の wasm を読み込めませんでした:", e);
      return false;
    }
  })();
  return loading;
}

export function isGrowLoaded(): boolean {
  return ex !== null;
}

export function growParamList(): GrowParamMeta[] {
  return params;
}

export function growPresetNames(): string[] {
  return presetNames;
}

export function formatGrowParam(index: number, value: number): string {
  return ex ? readString(ex.grow_param_format(index, value)) : String(value);
}

// ノブの位置（0〜1）と値の変換（コアと同じ曲がり方）
export function growToNormalised(index: number, value: number): number {
  return ex ? ex.grow_param_to_normalised(index, value) : 0;
}

export function growFromNormalised(index: number, normalised: number): number {
  return ex ? ex.grow_param_from_normalised(index, normalised) : 0;
}

// 今の曲の grow の値（パラメーターの番号順）。プリセットの値に、曲で変えた値（growParams）を重ねる
export function currentGrowValues(): number[] | null {
  if (!ex) return null;
  const { growPreset, growParams } = getState();
  return params.map(p => {
    const edited = growParams?.[p.id];
    return typeof edited === "number" ? edited : ex!.grow_preset_value(growPreset, p.index);
  });
}

// ===== AudioWorklet の登録（オーディオコンテキストごと） =====

const registering = new WeakMap<object, Promise<boolean>>();
const registered  = new WeakSet<object>();

function rawContext(): BaseAudioContext {
  return Tone.getContext().rawContext as unknown as BaseAudioContext;
}

// Tone.js のコンテキストは standardized-audio-context の包みのことと、ブラウザ標準のもの（書き出し）のことがある
function isNativeContext(raw: BaseAudioContext): boolean {
  return typeof BaseAudioContext !== "undefined" && raw instanceof BaseAudioContext;
}

// 今のコンテキストで grow を鳴らせるようにする（wasm の読み込みと AudioWorklet の登録を待つ）。鳴らせれば true
export async function prepareGrowContext(): Promise<boolean> {
  if (!(await loadGrow())) return false;
  const raw = rawContext();
  let p = registering.get(raw);
  if (!p) {
    // file:// でも読めるよう、ワークレットのソースは Blob の URL にして登録する
    const url = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    p = raw.audioWorklet.addModule(url)
      .then(() => { registered.add(raw); return true; })
      .catch(e => { console.warn("grow の AudioWorklet を登録できませんでした:", e); return false; })
      .finally(() => URL.revokeObjectURL(url));
    registering.set(raw, p);
  }
  return p;
}

// 今のコンテキストで、すぐ GrowInstrument を作れるか
export function isGrowReady(): boolean {
  return wasmBytes !== null && registered.has(rawContext());
}

// メロディの音色としての grow（ほかの音色の Synth と同じ呼び方で鳴らせる）。isGrowReady() のときだけ作る
export class GrowInstrument {
  readonly output: Tone.Gain;
  private node: AudioWorkletNode;
  private onParam: AudioParam;
  private offParam: AudioParam;

  constructor(values: number[], bpm: number) {
    const raw = rawContext();
    const options: AudioWorkletNodeOptions = {
      numberOfInputs:     0,
      numberOfOutputs:    1,
      outputChannelCount: [2],
      processorOptions:   { wasm: wasmBytes!.slice(0), values, bpm, overlap: OFF_DELAY },
    };
    this.node = isNativeContext(raw)
      ? new AudioWorkletNode(raw, "grow", options)
      : Tone.getContext().createAudioWorkletNode("grow", options) as unknown as AudioWorkletNode;
    this.onParam  = this.node.parameters.get("on")!;
    this.offParam = this.node.parameters.get("off")!;
    this.output   = new Tone.Gain(1);
    Tone.connect(this.node as unknown as Tone.ToneAudioNode, this.output);
  }

  connect(destination: Tone.InputNode): this {
    this.output.connect(destination);
    return this;
  }

  triggerAttackRelease(note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 0.8): this {
    const start = time === undefined ? Tone.now() : Tone.Time(time).toSeconds();
    const midi  = Math.round(Tone.Frequency(note).toMidi());
    if (midi < 0 || midi > 127) return this;
    const sample = 1 / this.node.context.sampleRate;
    const vel    = Math.max(0, Math.min(1, velocity));

    this.onParam.setValueAtTime(midi + 1 + vel * 0.5, start);
    this.onParam.setValueAtTime(0, start + sample);
    const end = start + Tone.Time(duration).toSeconds() + OFF_DELAY;
    this.offParam.setValueAtTime(midi + 1, end);
    this.offParam.setValueAtTime(0, end + sample);
    return this;
  }

  // 音作りの値（番号順）と BPM を当てる（鳴っている音にもすぐ反映される）
  setValues(values: number[]): void {
    this.node.port.postMessage({ type: "params", values: values.map((v, i) => [i, v]) });
  }

  setBpm(bpm: number): void {
    this.node.port.postMessage({ type: "bpm", bpm });
  }

  dispose(): void {
    this.node.port.postMessage({ type: "dispose" });
    this.node.disconnect();
    this.output.dispose();
  }
}
