#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include "GrowLookAndFeel.h"
#include "PluginProcessor.h"

namespace grow
{
// モジュール1つ分の枠（見出し＋つまみ・セレクト・スイッチの並び）。
// コアのパラメーターの表の group が同じものを並べ、種類で部品を選ぶ（選択肢 → セレクト、ON/OFF → スイッチ、ほか → ノブ）
class ParamSection : public juce::Component
{
public:
    ParamSection (juce::AudioProcessorValueTreeState& state, const char* group);

    int getPreferredWidth() const;
    void paint (juce::Graphics&) override;
    void resized() override;

    static constexpr int cellWidth   = 70;
    static constexpr int cellHeight  = 92;
    static constexpr int titleHeight = 26;

private:
    struct Control
    {
        juce::Label label;
        std::unique_ptr<juce::Slider> slider;
        std::unique_ptr<juce::ComboBox> combo;
        std::unique_ptr<juce::ToggleButton> toggle;
        std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> sliderAttachment;
        std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> comboAttachment;
        std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> toggleAttachment;
    };

    juce::String title;
    std::vector<std::unique_ptr<Control>> controls;
};

class GrowEditor : public juce::AudioProcessorEditor
{
public:
    explicit GrowEditor (GrowProcessor&);
    ~GrowEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void selectPreset (int index);

    GrowLookAndFeel lookAndFeel;  // 部品より先に作り、あとで壊す
    GrowProcessor& growProcessor;  // AudioProcessorEditor::processor と同じもの（型付き）

    juce::Label title;
    juce::ComboBox presets;
    juce::TextButton previousPreset { "<" }, nextPreset { ">" };
    juce::Label hint;

    std::vector<std::vector<std::unique_ptr<ParamSection>>> rows;  // 画面の行ごとのモジュール
    juce::MidiKeyboardComponent keyboard;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GrowEditor)
};
} // namespace grow
