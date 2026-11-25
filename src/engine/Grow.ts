import * as Tone from "tone";
import workletSource from "./growWorklet.js?raw";
import { fetchArrayBuffer } from "./DrumSamples";
import { getState, setState, GrowPartName } from "./AppState";
import arpParams from "../data/arp_params.json";

// grow（Toniq の内部シンセ。C++ のコアを WebAssembly にしたもの。ソースは grow/）を Toniq の再生で鳴らす。
//   - wasm（public/grow/grow.wasm。npm run grow:wasm でビルド）を読み込み、画面のスレッドにも1つインスタンスを作って
//     パラメーターの表・プリセット・値の表示に使う（表はコアが決める。ここでは持たない）
//   - 音は AudioWorklet（growWorklet.js）の中の wasm で作る。AudioWorklet はオーディオコンテキストごとに登録する
//     （再生用と、WAV / MP3 書き出し用のオフラインのコンテキスト）
//   - 音符は AudioParam の1サンプルだけの合図で渡す（書き出しでもサンプル単位で合う）
//   - パートごとに別々の音作り（GrowPart）を持つ。和音は同じ時刻の合図を少しずらして渡す
//   - プリセットを選んでいないパートはジャンルの標準のプリセット（GROW_STANDARD）を ID で探す。
//     今の wasm にない ID（コアに足したがビルドし直していない）は、後ろの候補の既存のプリセットで鳴らす
// wasm がないとき（まだビルドしていない）は使えず、各パートは Tone.js の音色で鳴る。

const WASM_URL = "grow/grow.wasm";  // 開発サーバー（http）とビルド後の Electron（file://）の両方で読めるよう相対パス
// 音の終わりの合図を少し遅らせ、すき間なく続く音が重なるようにする（レガートでつながる）。
// 同じ高さの音が続くときは、ワークレットが前の音の終わりを無視する
const OFF_DELAY = 0.002;
// 合図（AudioParam）の時刻を、狙うサンプルの位置よりこの分（サンプル）だけ前にする
const SIGNAL_LEAD = 0.25;

// grow を鳴らすパート（音作りの値はパートごとに AppState に持つ）
export type GrowPart = "melody" | "chord" | GrowPartName;

// ジャンルの標準のプリセット（ID。前から順に探し、今の wasm にあるものを使う）。
// アルペジオは arp_params.json の instrument、シグネチャーはジャンル（SignaturePlayer.ts の SIGNATURES）ごと。
// 同じジャンルの中では、パート（メロディ・コード・ベース・パッド・アルペジオ・シグネチャー・カウンターメロディ）どうしで同じプリセットを使わない
// （8bit のコードとアルペジオのスクエアだけは、ほかに 8bit らしい音がないので同じ）
const ARP_STANDARD: Record<string, string[]> = {
  pluck:  ["pluck"],
  square: ["square", "chip_lead"],
  keys:   ["keys", "pluck"],
  bell:   ["bell", "pluck"],
  blip:   ["blip", "pluck"],
};
// アルペジオの標準をジャンルで上書きする（instrument の音色がメロディなどと重なるジャンル）
const ARP_GENRE_STANDARD: Record<string, string[]> = {
  "ローファイ": ["lofi_keys", "keys"],   // キーズはメロディの標準なので、こもったローファイキーズ
  "ワルツ":     ["music_box", "kalimba"],  // オルゴールのアルペジオ
};
const SIGNATURE_STANDARD: Record<string, string[]> = {
  "EDM":       ["stab", "supersaw"],
  "テクノ":     ["acid"],
  "8bit":      ["blip", "chip_lead"],
  "ローファイ":  ["vinyl_hiss", "noise_sweep"],
  "ゲームBGM":  ["brass", "bell"],
  "ハウス":     ["epiano", "keys"],      // ピアノスタブ（オルガンはコードの標準なので使わない）
  "トランス":   ["gate_saw", "supersaw"],
  "アンビエント": ["wind", "noise_sweep"],
  "ワルツ":     ["pluck", "keys"],       // 後打ちの和音（弦をはじいたような短い音）
  "6/8バラード": ["epiano", "keys"],     // 3連符で刻むピアノ（メロディはキーズなので、エレピ）
  "シャッフル":  ["keys", "epiano"],     // 裏から入るピアノのキメ
};
// メロディはジャンルの雰囲気に合うリード（コード・シグネチャーの標準と重ならないもの）。どれもなければシンセリード
const MELODY_STANDARD: Record<string, string[]> = {
  "EDM":       ["lead"],
  "8bit":      ["chip_lead", "lead"],
  "ローファイ":  ["keys", "lead"],          // エレピはコードの標準なので、FM のキーズ
  "ゲームBGM":  ["bell", "lead"],
  "テクノ":     ["sync_lead", "lead"],     // アシッドはシグネチャーの標準なので、鋭いシンクリード
  "ハウス":     ["pluck", "lead"],
  "トランス":   ["trance_lead", "lead"],
  "アンビエント": ["soft_pad", "lead"],
  "ワルツ":     ["flute", "lead"],
  "6/8バラード": ["keys", "lead"],
  "シャッフル":  ["brass", "lead"],      // ジャンプ・ブルースのホーンのように歌わせる
};
// パッドはジャンルに合わせる（コードの標準と重ならないもの）。どれもなければソフトパッド
const PAD_STANDARD: Record<string, string[]> = {
  "EDM":       ["wide_pad", "soft_pad"],
  "8bit":      ["soft_pad"],
  "ローファイ":  ["soft_pad"],
  "ゲームBGM":  ["soft_pad"],
  "テクノ":     ["gate_pad", "soft_pad"],
  "ハウス":     ["soft_pad"],
  "トランス":   ["wide_pad", "soft_pad"],
  "アンビエント": ["wide_pad", "soft_pad"],  // メロディがソフトパッドなので、ワイドパッド
  "ワルツ":     ["warm_pad", "soft_pad"],
  "6/8バラード": ["warm_pad", "soft_pad"],
  "シャッフル":  ["warm_pad", "soft_pad"],
};
// コードはジャンルに合った和音の音（パッドのパートのパッド系の音と重ならないもの）。どれもなければワイドパッド
const CHORD_STANDARD: Record<string, string[]> = {
  "EDM":       ["supersaw", "wide_pad"],
  "8bit":      ["square", "wide_pad"],
  "ローファイ":  ["epiano", "wide_pad"],
  "ゲームBGM":  ["strings", "wide_pad"],
  "テクノ":     ["organ", "wide_pad"],
  "ハウス":     ["organ", "wide_pad"],
  "トランス":   ["supersaw", "wide_pad"],
  "アンビエント": ["strings", "wide_pad"],
  "ワルツ":     ["strings", "wide_pad"],
  "6/8バラード": ["strings", "wide_pad"],
  "シャッフル":  ["organ", "wide_pad"],   // ブルースのオルガン
};
// プリセットのカテゴリ（コアの GrowPresets.h の PresetCategory の ID）
export type GrowCategory = "init" | "lead" | "chord" | "pad" | "bass" | "pluck" | "texture" | "fx" | "drum" | "perc";
export const GROW_CATEGORIES: readonly GrowCategory[] = ["init", "lead", "chord", "pad", "bass", "pluck", "texture", "fx", "drum", "perc"];

// パートごとに選べるカテゴリ（並びは選択肢に出す順）。コードの音色の選択肢・grow の音作りのパネルのプリセットはここから作る。
// ジャンルの標準（GROW_STANDARD）もこのカテゴリのプリセットから選ぶ（tests/GrowPresets.test.ts で確かめる）
export const PART_CATEGORIES: Record<GrowPart, readonly GrowCategory[]> = {
  melody:    ["lead", "chord", "pluck", "pad"],
  chord:     ["chord", "pad"],
  bass:      ["bass"],
  pad:       ["pad"],
  arp:       ["pluck", "chord", "lead"],
  counter:   ["lead", "pluck", "chord"],
  signature: ["lead", "chord", "pad", "bass", "pluck", "texture", "fx"],
};

// カテゴリを持たない古い wasm（grow_preset_category がない）のときの、ID → カテゴリと表示名。
// カテゴリを持つ wasm の値と同じか tests/GrowPresets.test.ts で確かめる。新しいプリセットはここに足さなくてよい
export const FALLBACK_CATEGORIES: Readonly<Record<string, GrowCategory>> = {
  init: "init",
  lead: "lead", chip_lead: "lead", brass: "lead", sync_lead: "lead", trance_lead: "lead",
  supersaw: "chord", keys: "chord", epiano: "chord", organ: "chord", square: "chord", stab: "chord", gate_saw: "chord", lofi_keys: "chord",
  wide_pad: "pad", soft_pad: "pad", hard_pad: "pad", gate_pad: "pad", strings: "pad",
  sub_bass: "bass", saw_bass: "bass", square_bass: "bass", rolling_bass: "bass", chip_bass: "bass", soft_bass: "bass",
  fat_bass: "bass", pulse_bass: "bass", wobble_bass: "bass", acid: "bass",
  pluck: "pluck", bell: "pluck", blip: "pluck", house_pluck: "pluck",
  vinyl_hiss: "texture", vinyl_crackle: "texture", wind: "texture",
  noise_sweep: "fx", fx_riser_noise: "fx", fx_riser_pitch: "fx", fx_boom: "fx", fx_burst: "fx", fx_down_noise: "fx",
  fx_down_tone: "fx", fx_reverse: "fx", fx_chip: "fx", accel_se: "fx",
  drum_kick: "drum", drum_snare: "drum", drum_hat_closed: "drum", drum_hat_open: "drum", drum_clap: "drum", drum_rim: "drum",
  drum_shaker: "perc", drum_tambourine: "perc", drum_conga: "perc", drum_ride: "perc",
};
const FALLBACK_CATEGORY_NAMES: Record<GrowCategory, string> = {
  init: "初期化", lead: "リード", chord: "和音", pad: "パッド", bass: "ベース", pluck: "プラック",
  texture: "質感（ノイズ）", fx: "FX", drum: "ドラム", perc: "パーカッション",
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
  "ワルツ":     ["sub_bass"],
  "6/8バラード": ["soft_bass", "sub_bass"],
  "シャッフル":  ["saw_bass", "sub_bass"], // ブギウギの動くベースの音の高さが聞き取れるよう、輪郭のある音
};
// カウンターメロディ（ハモり・合いの手）はメロディと聞き分けられる、粒の立った音（ほかのパートの標準と重ならないもの）。
// どれもなければシンセリード
const COUNTER_STANDARD: Record<string, string[]> = {
  "EDM":       ["keys", "bell"],
  "8bit":      ["pluck", "bell"],          // チップリード・スクエア・ブリップはほかのパートで使っている
  "ローファイ":  ["pluck", "lead"],
  "ゲームBGM":  ["pluck", "lead"],
  "テクノ":     ["pluck", "bell"],
  "ハウス":     ["house_pluck", "bell"],   // プラックはメロディの標準なので、柔らかいハウスプラック
  "トランス":   ["keys", "bell"],
  "アンビエント": ["keys", "lead"],
  "ワルツ":     ["marimba", "bell"],
  "6/8バラード": ["flute", "pluck"],
  "シャッフル":  ["clav", "pluck"],
};
// どのパートもジャンルの標準を持つ（プリセットの null = ジャンルの標準）
const GROW_STANDARD: Record<GrowPart, (genre: string) => string[]> = {
  melody:    genre => MELODY_STANDARD[genre] ?? MELODY_STANDARD["ローファイ"],
  chord:     genre => CHORD_STANDARD[genre] ?? CHORD_STANDARD["ローファイ"],
  bass:      genre => BASS_STANDARD[genre] ?? BASS_STANDARD["ローファイ"],
  pad:       genre => PAD_STANDARD[genre] ?? PAD_STANDARD["ローファイ"],
  arp:       genre => {
    if (ARP_GENRE_STANDARD[genre]) return ARP_GENRE_STANDARD[genre];
    const params = arpParams as unknown as Record<string, { instrument: string }>;
    return ARP_STANDARD[(params[genre] ?? params["ローファイ"]).instrument] ?? ARP_STANDARD.pluck;
  },
  signature: genre => SIGNATURE_STANDARD[genre] ?? SIGNATURE_STANDARD["ローファイ"],
  counter:   genre => [...(COUNTER_STANDARD[genre] ?? COUNTER_STANDARD["ローファイ"]), "lead"],
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
  // カテゴリ（古い wasm にはない）
  grow_preset_category?(i: number): number;
  grow_category_count?(): number;
  grow_category_id?(c: number): number;
  grow_category_name?(c: number): number;
}

let wasmBytes: ArrayBuffer | null = null;
let ex: GrowExports | null = null;
let params: GrowParamMeta[] = [];
let presetNames: string[] = [];
let presetIds:   string[] = [];
// プリセットごとのカテゴリ（コアにない ID のカテゴリは "init" として扱う）と、カテゴリの表示名
let presetCategories: GrowCategory[] = [];
const categoryNames: Record<GrowCategory, string> = { ...FALLBACK_CATEGORY_NAMES };
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
      readCategories(ex);
      return true;
    } catch (e) {
      console.warn("grow の wasm を読み込めませんでした:", e);
      return false;
    }
  })();
  return loading;
}

// プリセットのカテゴリを読む。カテゴリを持たない古い wasm は FALLBACK_CATEGORIES で補う
function readCategories(e: GrowExports): void {
  const known = (id: string): GrowCategory => (GROW_CATEGORIES as readonly string[]).includes(id) ? id as GrowCategory : "init";
  if (!e.grow_preset_category || !e.grow_category_count || !e.grow_category_id || !e.grow_category_name) {
    presetCategories = presetIds.map(id => FALLBACK_CATEGORIES[id] ?? "init");
    return;
  }
  const ids = Array.from({ length: e.grow_category_count() }, (_, c) => readString(e.grow_category_id!(c)));
  ids.forEach((id, c) => {
    if ((GROW_CATEGORIES as readonly string[]).includes(id)) categoryNames[id as GrowCategory] = readString(e.grow_category_name!(c));
  });
  presetCategories = presetIds.map((_, i) => known(ids[e.grow_preset_category!(i)] ?? ""));
}

// プリセットごとのカテゴリ（番号順）
export function growPresetCategories(): GrowCategory[] {
  return presetCategories;
}

export function growCategoryName(category: GrowCategory): string {
  return categoryNames[category];
}

// パートで選べるプリセットを、カテゴリごとにまとめる（並びは PART_CATEGORIES、カテゴリの中はコアの並び）。
// withInit なら最後に「初期化」も入れる（音作りのパネルで一から作るとき）
export function growPresetChoices(part: GrowPart, withInit = false): { category: GrowCategory; presets: number[] }[] {
  const categories = withInit ? [...PART_CATEGORIES[part], "init" as const] : PART_CATEGORIES[part];
  return categories
    .map(category => ({ category, presets: presetCategories.flatMap((c, i) => (c === category ? [i] : [])) }))
    .filter(group => group.presets.length > 0);
}

// パートの、ジャンルの標準の候補（ID。前から順に探す）
export function growStandardCandidates(part: GrowPart, genre: string): string[] {
  return GROW_STANDARD[part](genre);
}

export function isGrowLoaded(): boolean {
  return ex !== null;
}

export function growParamList(): GrowParamMeta[] {
  return params;
}

// パラメーターの ID → 番号（見つからなければ -1）
export function growParamIndex(id: string): number {
  return params.findIndex(p => p.id === id);
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

// パートの、今のジャンルの標準のプリセットの番号（見つからなければ 0 = 初期化）
export function standardGrowPreset(part: GrowPart, genre: string = getState().genre): number {
  return Math.max(0, findGrowPreset(...GROW_STANDARD[part](genre)));
}

// AppState に保存しているパートの音作り（preset の null = ジャンルの標準）
export function storedGrowSound(part: GrowPart): { preset: string | null; params: Record<string, number> | null } {
  const s = getState();
  if (part === "melody") return { preset: s.growPreset,      params: s.growParams };
  if (part === "chord")  return { preset: s.growChordPreset, params: s.growChordParams };
  return s.growSounds[part];
}

// パートの音作りを書き換える（preset の null = ジャンルの標準）
export function setGrowSound(part: GrowPart, preset: string | null, params: Record<string, number> | null): void {
  if (part === "melody")     setState({ growPreset: preset, growParams: params });
  else if (part === "chord") setState({ growChordPreset: preset, growChordParams: params });
  else setState({ growSounds: { ...getState().growSounds, [part]: { preset, params } } });
}

// パートの grow の音作り（実際に使うプリセットの番号と、そこから変えた値）。
// 保存した ID が今の wasm にないとき（プリセットを消した・古い wasm）は、ジャンルの標準
export function growSettings(part: GrowPart): { preset: number; params: Record<string, number> | null } {
  const { preset, params } = storedGrowSound(part);
  const found = preset === null ? -1 : findGrowPreset(preset);
  return { preset: found >= 0 ? found : standardGrowPreset(part), params };
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

// ===== マルチティンバー：1つの AudioWorkletNode（1つの wasm）で複数の GrowInstrument を鳴らす =====
// 同じ処理の流れ（同じタスク）で作った GrowInstrument をマイクロタスクでまとめ、1つのノード（最大 MAX_SLOTS）にする。
// 再生の開始・書き出しでは全パートの grow が1つのノードになる。
//   - 書き出し（オフライン）：毎回ノードを作る。各スロットの最初の値は processorOptions で渡すので確実に間に合う
//   - 再生：ノードを残しておき、空いたスロットを使い回す（hubs）。ノードを作ると、オーディオスレッドの上で wasm とエンジンの準備に
//     数 ms かかり、再生中にパートを足した・ドラムを替えたときに鳴っている音が途切れることがあるため。
//     空きが足りないときだけノードを足す。使い回すスロットは、ワークレットが開き終わった知らせ（opened）を待ってから鳴らす
// ノードができる前・開き終わる前に呼ばれた発音・パラメーターは、ためておいてできたときに当てる
const MAX_SLOTS = 16;  // growWorklet.js の MAX_SLOTS と同じ

// 1つの AudioWorkletNode と、スロットごとの今の GrowInstrument（null = 空き）
interface GrowHub {
  node:  AudioWorkletNode;
  slots: (GrowInstrument | null)[];
}

// 再生用のコンテキストごとの、使い回すノード
const hubs = new WeakMap<object, GrowHub[]>();
let openId = 0;  // スロットを開いた知らせが、今の音色のものか（閉じて別の音色で開き直していないか）を確かめる番号

// まだノードにしていない GrowInstrument（作ったコンテキストごと）
const pendingBatches = new Map<Tone.BaseContext, GrowInstrument[]>();

function enqueue(inst: GrowInstrument, ctx: Tone.BaseContext): void {
  let batch = pendingBatches.get(ctx);
  if (!batch) {
    batch = [];
    pendingBatches.set(ctx, batch);
    queueMicrotask(() => flush(ctx));
  }
  batch.push(inst);
}

function dequeue(inst: GrowInstrument, ctx: Tone.BaseContext): void {
  const batch = pendingBatches.get(ctx);
  const i = batch?.indexOf(inst) ?? -1;
  if (batch && i >= 0) batch.splice(i, 1);
}

// ためた GrowInstrument を、空いているスロットに入れる（足りない分は MAX_SLOTS ずつ新しいノードにする）
function flush(ctx: Tone.BaseContext): void {
  let batch = pendingBatches.get(ctx) ?? [];
  pendingBatches.delete(ctx);
  const raw  = ctx.rawContext as unknown as BaseAudioContext;
  const keep = !ctx.isOffline;
  if (keep) {
    for (const hub of hubs.get(raw) ?? []) {
      for (let slot = 0; slot < hub.slots.length && batch.length > 0; slot++) {
        if (hub.slots[slot]) continue;
        batch[0].reopen(hub, slot, ++openId);
        batch = batch.slice(1);
      }
    }
  }
  for (let i = 0; i < batch.length; i += MAX_SLOTS) {
    const group = batch.slice(i, i + MAX_SLOTS);
    const hub   = createHub(ctx, raw, group, keep);
    group.forEach((inst, slot) => inst.attach(hub, slot));
  }
}

// ノードを作る（最初から group の音色を開いておく）。keep なら、あとで使い回せるようスロットの数だけ出力を持つ
function createHub(ctx: Tone.BaseContext, raw: BaseAudioContext, group: GrowInstrument[], keep: boolean): GrowHub {
  const outputs = keep ? MAX_SLOTS : group.length;
  const options: AudioWorkletNodeOptions = {
    numberOfInputs:     0,
    numberOfOutputs:    outputs,
    outputChannelCount: Array.from({ length: outputs }, () => 2),
    processorOptions:   {
      wasm:    wasmBytes!.slice(0),
      slots:   group.map(inst => ({ values: inst.currentValues(), bpm: inst.bpm })),
      overlap: OFF_DELAY,
      keep,
    },
  };
  const node = isNativeContext(raw)
    ? new AudioWorkletNode(raw, "grow", options)
    : ctx.createAudioWorkletNode("grow", options) as unknown as AudioWorkletNode;
  const hub: GrowHub = { node, slots: Array.from({ length: outputs }, () => null) };
  if (!keep) return hub;

  node.port.onmessage = e => {
    if (e.data?.type === "opened") hub.slots[e.data.slot]?.opened(e.data.id);
  };
  // ワークレットが例外で止まったノードは無音のままになるので、使い回さない（次に作る音色は新しいノードになる）
  node.onprocessorerror = () => {
    console.warn("grow の AudioWorklet が止まりました。次から新しいノードで鳴らします");
    hubs.set(raw, (hubs.get(raw) ?? []).filter(h => h !== hub));
  };
  hubs.set(raw, [...(hubs.get(raw) ?? []), hub]);
  return hub;
}

// 各パートの音色としての grow（ほかの音色の Synth と同じ呼び方で鳴らせる）。isGrowReady() のときだけ作る。
// values は音作りの値を返す関数（作るときと、applyGrowLive で値を当て直すときに呼ぶ）。
// パートの音作りで鳴らすなら growValues(part) を渡す
export class GrowInstrument {
  readonly output: Tone.Gain;
  readonly values: () => number[] | null;
  bpm: number;
  private readonly ctx: Tone.BaseContext;
  private readonly raw: BaseAudioContext;
  private hub: GrowHub | null = null;
  private slot = -1;
  private ready = false;  // 発音の合図を入れてよいか（使い回すスロットは、開き終わるまで false）
  private id = 0;         // 使い回すスロットを開いたときの番号
  private disposed = false;
  private latestValues: number[] | null = null;  // setValues された値（まだノードがないとき・開き直すときに渡す）
  private pending: (() => void)[] = [];          // 鳴らせるようになる前に呼ばれた発音・パラメーター
  private onParam!: AudioParam;
  private offParam!: AudioParam;
  private pidxParam!: AudioParam;
  private pvalParam!: AudioParam;
  // 合図を入れたサンプルの位置（合図ごと）。同じサンプルに2つ入れると後のものしか届かないので、空いている位置へずらす
  private onFrames  = new Set<number>();
  private offFrames = new Set<number>();
  private paramFrames = new Set<number>();

  constructor(values: () => number[] | null, bpm: number = getState().bpm) {
    this.values = values;
    this.bpm    = bpm;
    this.ctx    = Tone.getContext();
    this.raw    = this.ctx.rawContext as unknown as BaseAudioContext;
    this.output = new Tone.Gain(1);
    enqueue(this, this.ctx);
    live.add(this);
  }

  // ノードを作るときに渡す最初の値
  currentValues(): number[] {
    return this.latestValues ?? this.values() ?? [];
  }

  // 新しいノードのスロットにつなぐ（flush から呼ぶ。スロットはノードと一緒に開いている）
  attach(hub: GrowHub, slot: number): void {
    this.occupy(hub, slot);
    this.start();
  }

  // 使い回すノードの空いたスロットを開く（flush から呼ぶ）。発音は、開き終わった知らせ（opened）を待ってから
  reopen(hub: GrowHub, slot: number, id: number): void {
    this.occupy(hub, slot);
    this.id = id;
    hub.node.port.postMessage({ type: "open", slot, id, values: this.currentValues(), bpm: this.bpm });
  }

  opened(id: number): void {
    if (!this.disposed && id === this.id) this.start();
  }

  private occupy(hub: GrowHub, slot: number): void {
    this.hub  = hub;
    this.slot = slot;
    hub.slots[slot] = this;
    const param = (name: string) => hub.node.parameters.get(`${name}${slot}`)!;
    this.onParam   = param("on");
    this.offParam  = param("off");
    this.pidxParam = param("pidx");
    this.pvalParam = param("pval");
    Tone.connect(hub.node as unknown as Tone.ToneAudioNode, this.output, slot, 0);
  }

  // 鳴らせるようになった：ためていた発音・パラメーターを当てる
  private start(): void {
    this.ready = true;
    const pending = this.pending;
    this.pending = [];
    pending.forEach(run => run());
  }

  connect(destination: Tone.InputNode): this {
    this.output.connect(destination);
    return this;
  }

  // 時間・音の高さの換算は、このノードのコンテキスト（とその Transport の BPM）で行う
  // （WAV / MP3 書き出しの合成中は Tone.getContext() が再生用のコンテキストに戻っているため）
  triggerAttackRelease(note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 0.8): this {
    if (this.disposed) return this;
    const ctx   = this.output.context;
    const start = time === undefined ? ctx.now() : new Tone.TimeClass(ctx, time).toSeconds();
    const midi  = Math.round(new Tone.FrequencyClass(ctx, note).toMidi());
    if (midi < 0 || midi > 127) return this;
    const vel = Math.max(0, Math.min(1, velocity));
    const noteEnd = start + new Tone.TimeClass(ctx, duration).toSeconds();
    this.whenReady(() => {
      const rate = this.raw.sampleRate;
      // 呼ばれるのが遅れて（画面の処理などでメインスレッドが詰まった）音の終わりがもう過ぎていれば鳴らさない
      if (noteEnd * rate <= this.earliestFrame()) return;
      const onFrame = this.signal(this.onParam, this.onFrames, midi + 1 + vel * 0.5, start);
      // 消音は発音より必ず十分あとに置く。発音が今の時刻へ繰り下がって消音と近づくと、ワークレットが
      // 「同じ高さの次の音の直後に来た前の音の消音」とみなして無視し、鳴りっぱなしになるため
      this.signal(this.offParam, this.offFrames, midi + 1, noteEnd + OFF_DELAY, onFrame + Math.ceil(OFF_DELAY * rate) + 4);
    });
    return this;
  }

  // 発音だけ（消音の合図を送らない）。サスティン 0 の音（ドラム）は鳴り終わればボイスが空く。
  // 同じ高さを続けて鳴らすと、前の音は余韻（リリース）になる
  triggerAttack(note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity = 0.8): this {
    if (this.disposed) return this;
    const ctx   = this.output.context;
    const start = time === undefined ? ctx.now() : new Tone.TimeClass(ctx, time).toSeconds();
    const midi  = Math.round(new Tone.FrequencyClass(ctx, note).toMidi());
    if (midi < 0 || midi > 127) return this;
    const vel = Math.max(0, Math.min(1, velocity));
    this.whenReady(() => this.signal(this.onParam, this.onFrames, midi + 1 + vel * 0.5, start));
    return this;
  }

  // 消音だけ（オープンハイハットを止める・クラップの短い音など）。遅らせずにその時刻で離す
  triggerRelease(note: Tone.Unit.Frequency, time?: Tone.Unit.Time): this {
    if (this.disposed) return this;
    const ctx  = this.output.context;
    const at   = time === undefined ? ctx.now() : new Tone.TimeClass(ctx, time).toSeconds();
    const midi = Math.round(new Tone.FrequencyClass(ctx, note).toMidi());
    if (midi < 0 || midi > 127) return this;
    this.whenReady(() => this.signal(this.offParam, this.offFrames, midi + 1, at));
    return this;
  }

  // パラメーター（ID）を時刻を決めて当てる（書き出しでもサンプル単位で合う。同じ時刻の発音より先に当たる）。
  // 同じ時刻に複数当てると2サンプルずつ後ろへずれるので、発音に間に合わせたいときは少し前の時刻にする
  setParamAtTime(id: string, value: number, time: Tone.Unit.Time): this {
    const index = growParamIndex(id);
    if (index < 0 || this.disposed) return this;
    const seconds = new Tone.TimeClass(this.output.context, time).toSeconds();
    this.whenReady(() => {
      const frame = this.signal(this.pidxParam, this.paramFrames, index + 1, seconds);
      this.pvalParam.setValueAtTime(value, (frame - SIGNAL_LEAD) / this.raw.sampleRate);
    });
    return this;
  }

  private whenReady(run: () => void): void {
    if (this.ready) run();
    else this.pending.push(run);
  }

  // 合図を入れられるいちばん早いサンプルの位置（過ぎた時刻の合図は値と 0 が同じサンプルに重なって消えるので、今より後ろ）
  private earliestFrame(): number {
    return Math.ceil(this.raw.currentTime * this.raw.sampleRate) + 1;
  }

  // 1サンプルだけの合図を入れる（値のあとは 0 に戻す）。和音のように同じ時刻に重なるときは2サンプルずつ後ろへずらす。
  // minFrame より前には入れない。入れたサンプルの位置を返す
  private signal(param: AudioParam, used: Set<number>, value: number, time: number, minFrame = 0): number {
    const rate = this.raw.sampleRate;
    let frame = Math.max(Math.round(time * rate), this.earliestFrame(), minFrame);
    while (used.has(frame) || used.has(frame - 1) || used.has(frame + 1)) frame += 2;
    used.add(frame);
    // 時刻はサンプルの位置ちょうどにせず少し前にする（時刻 → サンプルの丸めで値と 0 が同じサンプルになると合図が消える）
    param.setValueAtTime(value, (frame - SIGNAL_LEAD) / rate);
    param.setValueAtTime(0, (frame + 1 - SIGNAL_LEAD) / rate);
    // 過ぎた位置は忘れる
    if (used.size > 256) {
      const now = Math.floor(this.raw.currentTime * rate);
      used.forEach(f => { if (f < now) used.delete(f); });
    }
    return frame;
  }

  // 音作りの値（番号順）と BPM を当てる（鳴っている音にもすぐ反映される）
  setValues(values: number[]): void {
    this.latestValues = values;
    this.hub?.node.port.postMessage({ type: "params", slot: this.slot, values: values.map((v, i) => [i, v]) });
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.hub?.node.port.postMessage({ type: "bpm", slot: this.slot, bpm });
  }

  // スロットを閉じて空ける（再生用のノードは残り、ほかの音色がこのスロットを使う）
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    live.delete(this);
    this.pending = [];
    if (this.hub) {
      const hub = this.hub;
      hub.node.port.postMessage({ type: "close", slot: this.slot });
      try { hub.node.disconnect(this.slot); } catch { /* もう外れている */ }
      // これから鳴るはずだった合図を、次にこのスロットを使う音色が受け取らないように消す
      for (const param of [this.onParam, this.offParam, this.pidxParam, this.pvalParam]) {
        param.cancelScheduledValues(0);
        param.setValueAtTime(0, this.raw.currentTime);
      }
      hub.slots[this.slot] = null;
    } else {
      dequeue(this, this.ctx);
    }
    this.output.dispose();
  }
}
