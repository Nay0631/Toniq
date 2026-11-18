#pragma once

// 工場出荷のプリセット（JUCE 版・WebAssembly 版で共通）。
// 値はすべてのパラメーターを初期値にしてから、プリセットごとに変える値だけを当てたもの
namespace grow
{
// プリセットのカテゴリ（音の役割）。Toniq はパートごとに選べるカテゴリを決め（src/engine/Grow.ts の PART_CATEGORIES）、
// grow/tools/render.mjs は鳴らすフレーズをカテゴリから決める。ID（categoryId）は一度出したら変えない。
// 並びは画面に出す順（JUCE 版のプリセットの見出し）。足すときは後ろに足す
enum class PresetCategory { init, lead, chord, pad, bass, pluck, texture, fx, drum, perc };
inline constexpr int numPresetCategories = 10;

const char* categoryId (int category);    // ASCII。範囲外なら ""
const char* categoryName (int category);  // UTF-8。範囲外なら ""

int numPresets();
const char* presetName (int index);            // UTF-8。範囲外なら ""
const char* presetId (int index);              // 変えない ID（ASCII）。範囲外なら ""
int presetCategory (int index);                // PresetCategory の番号。範囲外なら init
void presetValues (int index, float* values);  // numParams 個。範囲外なら初期値
} // namespace grow
