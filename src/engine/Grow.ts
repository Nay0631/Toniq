import * as Tone from "tone";
import workletSource from "./growWorklet.js?raw";
import { fetchArrayBuffer } from "./DrumSamples";
import { getState, setState, defaultState, GrowPartName } from "./AppState";
import arpParams from "../data/arp_params.json";

// grow（Toniq の内部シンセ。C++ のコアを WebAssembly にしたもの。ソースは grow/）を Toniq の再生で鳴らす。
//   - wasm（public/grow/grow.wasm。npm run grow:wasm でビルド）を読み込み、画面のスレッドにも1つインスタンスを作って
//     パラメーターの表・プリセット・値の表示に使う（表はコアが決める。ここでは持たない）
//   - 音は AudioWorklet（growWorklet.js）の中の wasm で作る。AudioWorklet はオーディオコンテキストごとに登録する
//     （再生用と、WAV / MP3 書き出し用のオフラインのコンテキスト）
//   - 音符は AudioParam の1サンプルだけの合図で渡す（書き出しでもサンプル単位で合う）
//   - パートごとに別々の音作り（GrowPart）を持つ。和音は同じ時刻の合図を少しずらして渡す
//   - ベース・パッド・アルペジオ・シグネチャーはジャンルの標準のプリセット（GROW_STANDARD）を ID で探す。
//     今の wasm にない ID（コアに足したがビルドし直していない）は、後ろの候補の既存のプリセットで鳴らす
// wasm がないとき（まだビルドしていない）は使えず、各パートは Tone.js の音色で鳴る。

const WASM_URL = "grow/grow.wasm";  // 開発サーバー（http）とビルド後の Electron（file://）の両方で読めるよう相対パス
// 音の終わりの合図を少し遅らせ、すき間なく続く音が重なるようにする（レガートでつながる）。
// 同じ高さの音が続くときは、ワークレットが前の音の終わりを無視する
const OFF_DELAY = 0.002;

// grow を鳴らすパート（音作りの値はパートごとに AppState に持つ）
export type GrowPart = "melody" | "chord" | GrowPartName;

// ジャンルの標準のプリセット（ID。前から順に探し、今の wasm にあるものを使う）。
// アルペジオは arp_params.json の instrument、シグネチャーはジャンル（SignaturePlayer.ts の SIGNATURES）ごと
const ARP_STANDARD: Record<string, string[]> = {
  pluck:  ["pluck"],
  square: ["chip_lead"],
  keys:   ["keys", "pluck"],
  bell:   ["bell", "pluck"],
  blip:   ["blip", "pluck"],
};
const SIGNATURE_STANDARD: Record<string, string[]> = {
  "EDM":       ["stab", "supersaw"],
  "テクノ":     ["acid"],
  "8bit":      ["chip_lead"],
  "ローファイ":  ["vinyl_hiss", "noise_sweep"],
  "ゲームBGM":  ["bell", "pluck"],
  "ハウス":     ["keys", "pluck"],
  "トランス":   ["gate_saw", "supersaw"],
  "アンビエント": ["wind", "noise_sweep"],
};
// ベースは bass_params.json の音色（ジャンル）に合わせる。どれもなければサブベース
const BASS_STANDARD: Record<string, string[]> = {
  "EDM":       ["saw_bass", "sub_bass"],
  "テクノ":     ["square_bass", "sub_bass"],
  "8bit":      ["chip_bass", "sub_bass"],
  "ローファイ":  ["sub_bass"],
  "ゲームBGM":  ["saw_bass", "sub_bass"],
  "ハウス":     ["square_bass", "sub_bass"],
  "トランス":   ["rolling_bass", "sub_bass"],
  "アンビエント": ["soft_bass", "sub_bass"],
};
const GROW_STANDARD: Record<GrowPartName, (genre: string) => string[]> = {
  bass:      genre => BASS_STANDARD[genre] ?? BASS_STANDARD["ローファイ"],
  pad:       () => ["soft_pad", "wide_pad"],
  arp:       genre => {
    const params = arpParams as unknown as Record<string, { instrument: string }>;
    return ARP_STANDARD[(params[genre] ?? params["ローファイ"]).instrument] ?? ARP_STANDARD.pluck;
  },
  signature: genre => SIGNATURE_STANDARD[genre] ?? SIGNATURE_STANDARD["ローファイ"],
};

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
  grow_preset_id?(i: number): number;  // 古い wasm にはない
  grow_preset_value(preset: number, i: number): number;
}

let wasmBytes: ArrayBuffer | null = null;
let ex: GrowExports | null = null;
let params: GrowParamMeta[] = [];
let presetNames: string[] = [];
let presetIds:   string[] = [];
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
      // 古い wasm（grow_preset_id がない）は、番号の並びを LEGACY_PRESET_IDS とみなす
      presetIds = presetNames.map((_, i) => ex!.grow_preset_id ? readString(ex!.grow_preset_id(i)) : LEGACY_PRESET_IDS[i] ?? "");
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

// プリセットの ID（番号順。曲にはこれを保存する）
export function growPresetIds(): string[] {
  return presetIds;
}

// プリセットを番号で保存していた頃の並び（番号 → ID）。古い曲の growPreset などを ID に読み替える（SongLibrary.ts）。
// コアのプリセットの並びを変えてもこの表は変えない
export const LEGACY_PRESET_IDS: readonly string[] = [
  "init",
  "lead",
  "supersaw",
  "pluck",
  "acid",
  "wide_pad",
  "sub_bass",
  "chip_lead",
  "noise_sweep",
  "soft_pad",
  "keys",
  "bell",
  "blip",
  "stab",
  "gate_saw",
  "vinyl_hiss",
  "vinyl_crackle",
  "wind",
  "epiano",
  "organ",
  "strings",
  "square",
  "fx_riser_noise",
  "fx_riser_pitch",
  "fx_boom",
  "fx_burst",
  "fx_down_noise",
  "fx_down_tone",
  "fx_reverse",
  "fx_chip",
  "saw_bass",
  "square_bass",
  "rolling_bass",
  "chip_bass",
  "soft_bass",
];

// 番号で保存していた値を ID にする（文字列ならそのまま。読めなければ fallback）
export function presetIdFromSaved<T extends string | null>(saved: unknown, fallback: T): string | T {
  if (typeof saved === "string") return saved;
  if (typeof saved === "number") return LEGACY_PRESET_IDS[saved] ?? fallback;
  return fallback;
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

// ID の前から順に探し、最初に見つかったプリセットの番号（どれもなければ -1）
export function findGrowPreset(...ids: string[]): number {
  for (const id of ids) {
    const index = presetIds.indexOf(id);
    if (index >= 0) return index;
  }
  return -1;
}

function isPartName(part: GrowPart): part is GrowPartName {
  return part === "bass" || part === "pad" || part === "arp" || part === "signature";
}

// ベース・パッド・アルペジオ・シグネチャーの、今のジャンルの標準のプリセットの番号（見つからなければ 0 = 初期化）
export function standardGrowPreset(part: GrowPartName, genre: string = getState().genre): number {
  return Math.max(0, findGrowPreset(...GROW_STANDARD[part](genre)));
}

// AppState に保存しているパートの音作り（ベース・パッド・アルペジオ・シグネチャーの preset は null = ジャンルの標準）
export function storedGrowSound(part: GrowPart): { preset: string | null; params: Record<string, number> | null } {
  const s = getState();
  if (part === "melody") return { preset: s.growPreset,      params: s.growParams };
  if (part === "chord")  return { preset: s.growChordPreset, params: s.growChordParams };
  return s.growSounds[part];
}

// パートの音作りを書き換える（メロディ・コードは preset に null を渡さない）
export function setGrowSound(part: GrowPart, preset: string | null, params: Record<string, number> | null): void {
  if (part === "melody")     setState({ growPreset: preset ?? defaultState.growPreset, growParams: params });
  else if (part === "chord") setState({ growChordPreset: preset ?? defaultState.growChordPreset, growChordParams: params });
  else setState({ growSounds: { ...getState().growSounds, [part]: { preset, params } } });
}

// パートの grow の音作り（実際に使うプリセットの番号と、そこから変えた値）。
// 保存した ID が今の wasm にないとき（プリセットを消した・古い wasm）は、ジャンルの標準（メロディ・コードは初期値のプリセット）
export function growSettings(part: GrowPart): { preset: number; params: Record<string, number> | null } {
  const { preset, params } = storedGrowSound(part);
  const found = preset === null ? -1 : findGrowPreset(preset);
  if (found >= 0) return { preset: found, params };
  if (isPartName(part)) return { preset: standardGrowPreset(part), params };
  const initial = part === "chord" ? defaultState.growChordPreset : defaultState.growPreset;
  return { preset: Math.max(0, findGrowPreset(initial)), params };
}

// プリセットそのままの値（パラメーターの番号順）
export function growPresetValues(preset: number): number[] | null {
  if (!ex) return null;
  return params.map(p => ex!.grow_preset_value(preset, p.index));
}

// プリセットの値の一部を上書きした値（overrides はパラメーターの ID → 値。FX の EG の長さなど、テンポで変わる値に使う）
export function growPresetValuesWith(preset: number, overrides: Record<string, number>): number[] | null {
  if (!ex) return null;
  return params.map(p => {
    const value = overrides[p.id];
    return typeof value === "number" ? value : ex!.grow_preset_value(preset, p.index);
  });
}

// 今の曲の grow の値（パラメーターの番号順）。プリセットの値に、曲で変えた値（growParams など）を重ねる
export function currentGrowValues(part: GrowPart = "melody"): number[] | null {
  if (!ex) return null;
  const { preset, params: edited } = growSettings(part);
  return params.map(p => {
    const value = edited?.[p.id];
    return typeof value === "number" ? value : ex!.grow_preset_value(preset, p.index);
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

// パートの音作りの値を返す関数（GrowInstrument に渡す）
export function growValues(part: GrowPart): () => number[] | null {
  return () => currentGrowValues(part);
}

// 今鳴らせる状態の GrowInstrument（音作りの値・BPM の変更をすぐ当てるため）
const live = new Set<GrowInstrument>();

// 音作りの値と BPM（テンポ同期の LFO・ディレイ）を、鳴っている grow（全パート）にすぐ当てる（作り直さない）
export function applyGrowLive(): void {
  const bpm = getState().bpm;
  live.forEach(inst => {
    const values = inst.values();
    if (values) inst.setValues(values);
    inst.setBpm(bpm);
  });
}

// 各パートの音色としての grow（ほかの音色の Synth と同じ呼び方で鳴らせる）。isGrowReady() のときだけ作る。
// values は音作りの値を返す関数（作るときと、applyGrowLive で値を当て直すときに呼ぶ）。
// パートの音作りで鳴らすなら growValues(part) を渡す
export class GrowInstrument {
  readonly output: Tone.Gain;
  readonly values: () => number[] | null;
  private node: AudioWorkletNode;
  private onParam: AudioParam;
  private offParam: AudioParam;
  // 合図を入れたサンプルの位置（合図ごと）。同じサンプルに2つ入れると後のものしか届かないので、空いている位置へずらす
  private onFrames  = new Set<number>();
  private offFrames = new Set<number>();

  constructor(values: () => number[] | null, bpm: number = getState().bpm) {
    this.values = values;
    const raw = rawContext();
    const options: AudioWorkletNodeOptions = {
      numberOfInputs:     0,
      numberOfOutputs:    1,
      outputChannelCount: [2],
      processorOptions:   { wasm: wasmBytes!.slice(0), values: values() ?? [], bpm, overlap: OFF_DELAY },
    };
    this.node = isNativeContext(raw)
      ? new AudioWorkletNode(raw, "grow", options)
      : Tone.getContext().createAudioWorkletNode("grow", options) as unknown as AudioWorkletNode;
    this.onParam  = this.node.parameters.get("on")!;
    this.offParam = this.node.parameters.get("off")!;
    this.output   = new Tone.Gain(1);
    Tone.connect(this.node as unknown as Tone.ToneAudioNode, this.output);
    live.add(this);
  }

  connect(destination: Tone.InputNode): this {
    this.output.connect(destination);
    return this;
  }

  triggerAttackRelease(note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 0.8): this {
    const start = time === undefined ? Tone.now() : Tone.Time(time).toSeconds();
    const midi  = Math.round(Tone.Frequency(note).toMidi());
    if (midi < 0 || midi > 127) return this;
    const vel = Math.max(0, Math.min(1, velocity));
    const end = start + Tone.Time(duration).toSeconds() + OFF_DELAY;
    this.signal(this.onParam,  this.onFrames,  midi + 1 + vel * 0.5, start);
    this.signal(this.offParam, this.offFrames, midi + 1, end);
    return this;
  }

  // 1サンプルだけの合図を入れる（値のあとは 0 に戻す）。和音のように同じ時刻に重なるときは2サンプルずつ後ろへずらす
  private signal(param: AudioParam, used: Set<number>, value: number, time: number): void {
    const rate = this.node.context.sampleRate;
    let frame = Math.max(Math.round(time * rate), Math.ceil(this.node.context.currentTime * rate));
    while (used.has(frame) || used.has(frame - 1) || used.has(frame + 1)) frame += 2;
    used.add(frame);
    param.setValueAtTime(value, frame / rate);
    param.setValueAtTime(0, (frame + 1) / rate);
    // 過ぎた位置は忘れる
    if (used.size > 256) {
      const now = Math.floor(this.node.context.currentTime * rate);
      used.forEach(f => { if (f < now) used.delete(f); });
    }
  }

  // 音作りの値（番号順）と BPM を当てる（鳴っている音にもすぐ反映される）
  setValues(values: number[]): void {
    this.node.port.postMessage({ type: "params", values: values.map((v, i) => [i, v]) });
  }

  setBpm(bpm: number): void {
    this.node.port.postMessage({ type: "bpm", bpm });
  }

  dispose(): void {
    live.delete(this);
    this.node.port.postMessage({ type: "dispose" });
    this.node.disconnect();
    this.output.dispose();
  }
}
