#include "Presets.h"
#include "Parameters.h"
#include "Text.h"

namespace grow
{
namespace
{
// 選択肢の番号（Parameters.cpp の choices の並び）
namespace wave   { constexpr float sine = 0, triangle = 1, saw = 2, square = 3; }
namespace filter { constexpr float lp12 = 0, bp = 3; }
namespace lfo    { constexpr float triangle = 1; }
namespace mode   { constexpr float mono = 1, legato = 2; }
namespace delay  { constexpr float d8 = 1, d8dot = 2; }

struct Preset
{
    const char* name;
    std::vector<std::pair<juce::String, float>> values;  // 初期値から変える値（パラメーター ID と実際の値）
};

juce::String osc1 (const char* name) { return ids::oscId (0, name); }
juce::String osc2 (const char* name) { return ids::oscId (1, name); }

const std::vector<Preset>& presets()
{
    static const std::vector<Preset> list {
        { "初期化", {} },

        // ノコギリ波2枚を少しずらし、フィルターを EG で開く。レガートで滑らかにつなぎ、浅いビブラート
        { "シンセリード", {
            { osc1 ("level"), 0.7f }, { osc2 ("wave"), wave::saw }, { osc2 ("level"), 0.5f }, { osc2 ("fine"), 8.0f },
            { ids::cutoff, 2200.0f }, { ids::resonance, 0.25f }, { ids::filterEnvAmt, 24.0f },
            { ids::fenvA, 0.005f }, { ids::fenvD, 0.35f }, { ids::fenvS, 0.4f }, { ids::fenvR, 0.3f },
            { ids::aenvD, 0.2f }, { ids::aenvS, 0.8f }, { ids::aenvR, 0.25f },
            { ids::voiceMode, mode::legato }, { ids::glide, 0.06f },
            { ids::lfoRate, 5.5f }, { ids::lfoPitch, 0.15f },
            { ids::delayMix, 0.2f }, { ids::reverbMix, 0.2f } } },

        // 7枚重ねたノコギリ波を左右いっぱいに広げ、1オクターブ上も重ねる（EDM・トランス）
        { "スーパーソウ", {
            { osc1 ("unison"), 7 }, { osc1 ("detune"), 35.0f }, { osc1 ("width"), 1.0f }, { osc1 ("level"), 0.8f },
            { osc2 ("wave"), wave::saw }, { osc2 ("octave"), 1 }, { osc2 ("unison"), 7 }, { osc2 ("detune"), 22.0f },
            { osc2 ("width"), 1.0f }, { osc2 ("level"), 0.35f },
            { ids::filterType, filter::lp12 }, { ids::cutoff, 9000.0f }, { ids::resonance, 0.1f },
            { ids::aenvA, 0.01f }, { ids::aenvS, 0.8f }, { ids::aenvR, 0.4f },
            { ids::chorusMix, 0.25f }, { ids::delayMix, 0.2f }, { ids::reverbMix, 0.3f } } },

        // フィルターが素早く閉じる、弦をはじいたような音（ハウス）
        { "プラック", {
            { osc2 ("wave"), wave::square }, { osc2 ("octave"), 1 }, { osc2 ("level"), 0.3f },
            { ids::cutoff, 400.0f }, { ids::resonance, 0.3f }, { ids::filterEnvAmt, 48.0f },
            { ids::fenvA, 0.001f }, { ids::fenvD, 0.18f }, { ids::fenvS, 0.0f }, { ids::fenvR, 0.2f },
            { ids::aenvA, 0.001f }, { ids::aenvD, 0.4f }, { ids::aenvS, 0.0f }, { ids::aenvR, 0.3f },
            { ids::delayMix, 0.25f }, { ids::reverbMix, 0.2f } } },

        // レゾナンスの強いフィルターを短く開閉させ、レガートで滑らせる（テクノ）
        { "アシッド", {
            { osc1 ("octave"), -1 }, { osc1 ("level"), 0.8f },
            { ids::cutoff, 300.0f }, { ids::resonance, 0.75f }, { ids::filterEnvAmt, 40.0f }, { ids::keyTrack, 0.3f },
            { ids::fenvA, 0.002f }, { ids::fenvD, 0.15f }, { ids::fenvS, 0.1f }, { ids::fenvR, 0.1f },
            { ids::aenvA, 0.002f }, { ids::aenvD, 0.2f }, { ids::aenvS, 0.6f }, { ids::aenvR, 0.08f },
            { ids::voiceMode, mode::legato }, { ids::glide, 0.05f },
            { ids::drive, 0.35f }, { ids::delayMix, 0.15f }, { ids::delayTime, delay::d8dot }, { ids::reverbMix, 0.05f } } },

        // こもった厚い本体に、1オクターブ上の三角波を広げて重ねる。フィルターをゆっくり揺らす（アンビエント）
        { "ワイドパッド", {
            { osc1 ("unison"), 5 }, { osc1 ("detune"), 18.0f }, { osc1 ("width"), 0.9f }, { osc1 ("level"), 0.6f },
            { osc2 ("wave"), wave::triangle }, { osc2 ("octave"), 1 }, { osc2 ("unison"), 3 }, { osc2 ("detune"), 10.0f },
            { osc2 ("width"), 1.0f }, { osc2 ("level"), 0.4f },
            { ids::filterType, filter::lp12 }, { ids::cutoff, 1800.0f }, { ids::resonance, 0.1f }, { ids::filterEnvAmt, 12.0f },
            { ids::fenvA, 1.5f }, { ids::fenvD, 2.0f }, { ids::fenvS, 0.6f }, { ids::fenvR, 2.0f },
            { ids::aenvA, 1.2f }, { ids::aenvD, 1.0f }, { ids::aenvS, 0.9f }, { ids::aenvR, 2.5f },
            { ids::lfoWave, lfo::triangle }, { ids::lfoRate, 0.3f }, { ids::lfoFilter, 6.0f },
            { ids::chorusMix, 0.4f }, { ids::reverbMix, 0.45f }, { ids::reverbSize, 0.8f } } },

        // サイン波とサブで低音を支える。モノで少しだけ滑らせる
        { "サブベース", {
            { osc1 ("wave"), wave::sine }, { osc1 ("octave"), -1 }, { osc1 ("level"), 0.9f },
            { osc2 ("wave"), wave::triangle }, { osc2 ("octave"), -1 }, { osc2 ("level"), 0.2f },
            { ids::subLevel, 0.5f }, { ids::cutoff, 600.0f }, { ids::resonance, 0.0f },
            { ids::aenvA, 0.003f }, { ids::aenvS, 0.9f }, { ids::aenvR, 0.15f },
            { ids::voiceMode, mode::mono }, { ids::glide, 0.03f }, { ids::reverbMix, 0.0f } } },

        // 矩形波の8bit 風。発音の瞬間に少し上から下ろし、ビブラートをかける
        { "チップリード", {
            { osc1 ("wave"), wave::square }, { osc1 ("level"), 0.6f },
            { ids::filterType, filter::lp12 }, { ids::cutoff, 12000.0f }, { ids::resonance, 0.0f },
            { ids::aenvA, 0.001f }, { ids::aenvD, 0.1f }, { ids::aenvS, 0.7f }, { ids::aenvR, 0.05f },
            { ids::pitchEnvAmt, 3.0f }, { ids::pitchEnvTime, 0.04f },
            { ids::lfoRate, 6.0f }, { ids::lfoPitch, 0.3f },
            { ids::voiceMode, mode::mono },
            { ids::delayMix, 0.15f }, { ids::delayTime, delay::d8 }, { ids::reverbMix, 0.05f } } },

        // ノイズをバンドパスで細くし、フィルター EG でゆっくり掃き上げる効果音向けの音
        { "ノイズスイープ", {
            { osc1 ("level"), 0.0f }, { ids::noiseLevel, 0.8f },
            { ids::filterType, filter::bp }, { ids::cutoff, 300.0f }, { ids::resonance, 0.5f }, { ids::filterEnvAmt, 48.0f },
            { ids::keyTrack, 0.0f },
            { ids::fenvA, 2.0f }, { ids::fenvD, 1.0f }, { ids::fenvS, 1.0f }, { ids::fenvR, 1.5f },
            { ids::aenvA, 1.5f }, { ids::aenvS, 1.0f }, { ids::aenvR, 1.5f },
            { ids::chorusMix, 0.3f }, { ids::reverbMix, 0.4f }, { ids::reverbSize, 0.8f } } },
    };
    return list;
}
} // namespace

int numPresets()
{
    return (int) presets().size();
}

juce::String presetName (int index)
{
    if (! juce::isPositiveAndBelow (index, numPresets())) return {};
    return jp (presets()[(size_t) index].name);
}

void applyPreset (juce::AudioProcessorValueTreeState& state, int index)
{
    if (! juce::isPositiveAndBelow (index, numPresets())) return;

    for (auto* param : state.processor.getParameters())
        if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*> (param))
            ranged->setValueNotifyingHost (ranged->getDefaultValue());

    for (const auto& [id, value] : presets()[(size_t) index].values)
    {
        auto* param = state.getParameter (id);
        jassert (param != nullptr);  // ID の書き間違い
        if (param != nullptr)
            param->setValueNotifyingHost (param->convertTo0to1 (value));
    }
}
} // namespace grow
