// grow の WebAssembly 版をビルドする（npm run grow:wasm）。
// Emscripten（emcc）が PATH にあること。出力は public/grow/grow.wasm（Toniq がそのまま読む）
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const core = join(here, "..", "core");
const out  = join(root, "public", "grow", "grow.wasm");

// grow_wasm.cpp の GROW_EXPORT の関数（emcc に残す関数）
const exported = [
  "grow_init", "grow_block_size", "grow_left", "grow_right", "grow_render",
  "grow_note_on", "grow_note_off", "grow_all_notes_off", "grow_set_bpm",
  "grow_set_param", "grow_get_param", "grow_load_preset",
  "grow_param_count", "grow_param_id", "grow_param_group", "grow_param_name", "grow_param_kind",
  "grow_param_min", "grow_param_max", "grow_param_default", "grow_param_num_choices", "grow_param_choice",
  "grow_param_to_normalised", "grow_param_from_normalised", "grow_param_format",
  "grow_preset_count", "grow_preset_name", "grow_preset_value",
].map(name => `_${name}`);

const sources = [
  ...readdirSync(core).filter(f => f.endsWith(".cpp")).map(f => join(core, f)),
  join(here, "grow_wasm.cpp"),
];

mkdirSync(dirname(out), { recursive: true });

const args = [
  "-O3", "-std=c++17", "-fno-exceptions", "-fno-rtti",
  // JS の糊なしの wasm 単体（AudioWorklet の中で直接インスタンス化する）
  "-sSTANDALONE_WASM=1", "--no-entry", "-sFILESYSTEM=0",
  // メモリは固定（オーディオスレッドで ArrayBuffer が差し替わらないように）
  "-sINITIAL_MEMORY=16777216", "-sALLOW_MEMORY_GROWTH=0",
  // カンマ区切り（Windows の cmd でも引用符なしで渡せる形）
  `-sEXPORTED_FUNCTIONS=${exported.join(",")}`,
  ...sources.map(s => relative(root, s)),
  "-o", relative(root, out),
];

console.log(`emcc ${args.join(" ")}`);
const result = spawnSync("emcc", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) {
  console.error("emcc を起動できませんでした。Emscripten をインストールし、emsdk_env で PATH を通してください。", result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
