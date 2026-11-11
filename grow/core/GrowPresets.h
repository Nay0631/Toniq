#pragma once

// 工場出荷のプリセット（JUCE 版・WebAssembly 版で共通）。
// 値はすべてのパラメーターを初期値にしてから、プリセットごとに変える値だけを当てたもの
namespace grow
{
int numPresets();
const char* presetName (int index);            // UTF-8。範囲外なら ""
void presetValues (int index, float* values);  // numParams 個。範囲外なら初期値
} // namespace grow
