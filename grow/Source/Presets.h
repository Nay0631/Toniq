#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

// 工場出荷のプリセット。すべてのパラメーターを初期値に戻してから、プリセットごとの値を当てる
namespace grow
{
int numPresets();
juce::String presetName (int index);
void applyPreset (juce::AudioProcessorValueTreeState& state, int index);
} // namespace grow
