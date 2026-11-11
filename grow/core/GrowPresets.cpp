#include "GrowPresets.h"
#include "GrowParams.h"

#include <cstddef>

namespace grow
{
namespace
{
// 選択肢の番号（GrowParams.cpp の選択肢の並び）
namespace wave   { constexpr float sine = 0, triangle = 1, saw = 2, square = 3; }
namespace filter { constexpr float lp12 = 0, bp = 3; }
namespace lfo    { constexpr float triangle = 1; }
namespace mode   { constexpr float mono = 1, legato = 2; }
namespace delay  { constexpr float d8 = 1, d8dot = 2; }

struct Value
{
    Param param;
    float value;
};

struct Preset
{
    const char* name;
    const Value* values;  // 初期値から変える値
    int count;
};

// ノコギリ波2枚を少しずらし、フィルターを EG で開く。レガートで滑らかにつなぎ、浅いビブラート
const Value lead[] = {
    { osc1Level, 0.7f }, { osc2Wave, wave::saw }, { osc2Level, 0.5f }, { osc2Fine, 8 },
    { filterCutoff, 2200 }, { filterResonance, 0.25f }, { filterEnvAmount, 24 },
    { fenvAttack, 0.005f }, { fenvDecay, 0.35f }, { fenvSustain, 0.4f }, { fenvRelease, 0.3f },
    { aenvDecay, 0.2f }, { aenvSustain, 0.8f }, { aenvRelease, 0.25f },
    { voiceMode, mode::legato }, { glide, 0.06f },
    { lfoRate, 5.5f }, { lfoPitch, 0.15f },
    { delayMix, 0.2f }, { reverbMix, 0.2f },
};

// 7枚重ねたノコギリ波を左右いっぱいに広げ、1オクターブ上も重ねる（EDM・トランス）
const Value supersaw[] = {
    { osc1Unison, 7 }, { osc1Detune, 35 }, { osc1Width, 1 }, { osc1Level, 0.8f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Unison, 7 }, { osc2Detune, 22 }, { osc2Width, 1 }, { osc2Level, 0.35f },
    { filterType, filter::lp12 }, { filterCutoff, 9000 }, { filterResonance, 0.1f },
    { aenvAttack, 0.01f }, { aenvSustain, 0.8f }, { aenvRelease, 0.4f },
    { chorusMix, 0.25f }, { delayMix, 0.2f }, { reverbMix, 0.3f },
};

// フィルターが素早く閉じる、弦をはじいたような音（ハウス）
const Value pluck[] = {
    { osc2Wave, wave::square }, { osc2Octave, 1 }, { osc2Level, 0.3f },
    { filterCutoff, 400 }, { filterResonance, 0.3f }, { filterEnvAmount, 48 },
    { fenvAttack, 0.001f }, { fenvDecay, 0.18f }, { fenvSustain, 0 }, { fenvRelease, 0.2f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.4f }, { aenvSustain, 0 }, { aenvRelease, 0.3f },
    { delayMix, 0.25f }, { reverbMix, 0.2f },
};

// レゾナンスの強いフィルターを短く開閉させ、レガートで滑らせる（テクノ）
const Value acid[] = {
    { osc1Octave, -1 }, { osc1Level, 0.8f },
    { filterCutoff, 300 }, { filterResonance, 0.75f }, { filterEnvAmount, 40 }, { filterKeyTrack, 0.3f },
    { fenvAttack, 0.002f }, { fenvDecay, 0.15f }, { fenvSustain, 0.1f }, { fenvRelease, 0.1f },
    { aenvAttack, 0.002f }, { aenvDecay, 0.2f }, { aenvSustain, 0.6f }, { aenvRelease, 0.08f },
    { voiceMode, mode::legato }, { glide, 0.05f },
    { drive, 0.35f }, { delayMix, 0.15f }, { delayTime, delay::d8dot }, { reverbMix, 0.05f },
};

// こもった厚い本体に、1オクターブ上の三角波を広げて重ねる。フィルターをゆっくり揺らす（アンビエント）
const Value pad[] = {
    { osc1Unison, 5 }, { osc1Detune, 18 }, { osc1Width, 0.9f }, { osc1Level, 0.6f },
    { osc2Wave, wave::triangle }, { osc2Octave, 1 }, { osc2Unison, 3 }, { osc2Detune, 10 }, { osc2Width, 1 },
    { osc2Level, 0.4f },
    { filterType, filter::lp12 }, { filterCutoff, 1800 }, { filterResonance, 0.1f }, { filterEnvAmount, 12 },
    { fenvAttack, 1.5f }, { fenvDecay, 2 }, { fenvSustain, 0.6f }, { fenvRelease, 2 },
    { aenvAttack, 1.2f }, { aenvDecay, 1 }, { aenvSustain, 0.9f }, { aenvRelease, 2.5f },
    { lfoWave, lfo::triangle }, { lfoRate, 0.3f }, { lfoFilter, 6 },
    { chorusMix, 0.4f }, { reverbMix, 0.45f }, { reverbSize, 0.8f },
};

// サイン波とサブで低音を支える。モノで少しだけ滑らせる
const Value subBass[] = {
    { osc1Wave, wave::sine }, { osc1Octave, -1 }, { osc1Level, 0.9f },
    { osc2Wave, wave::triangle }, { osc2Octave, -1 }, { osc2Level, 0.2f },
    { subLevel, 0.5f }, { filterCutoff, 600 }, { filterResonance, 0 },
    { aenvAttack, 0.003f }, { aenvSustain, 0.9f }, { aenvRelease, 0.15f },
    { voiceMode, mode::mono }, { glide, 0.03f }, { reverbMix, 0 },
};

// 矩形波の8bit 風。発音の瞬間に少し上から下ろし、ビブラートをかける
const Value chipLead[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.6f },
    { filterType, filter::lp12 }, { filterCutoff, 12000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.1f }, { aenvSustain, 0.7f }, { aenvRelease, 0.05f },
    { pitchEnvAmount, 3 }, { pitchEnvTime, 0.04f },
    { lfoRate, 6 }, { lfoPitch, 0.3f },
    { voiceMode, mode::mono },
    { delayMix, 0.15f }, { delayTime, delay::d8 }, { reverbMix, 0.05f },
};

// ノイズをバンドパスで細くし、フィルター EG でゆっくり掃き上げる効果音向けの音
const Value noiseSweep[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::bp }, { filterCutoff, 300 }, { filterResonance, 0.5f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 2 }, { fenvDecay, 1 }, { fenvSustain, 1 }, { fenvRelease, 1.5f },
    { aenvAttack, 1.5f }, { aenvSustain, 1 }, { aenvRelease, 1.5f },
    { chorusMix, 0.3f }, { reverbMix, 0.4f }, { reverbSize, 0.8f },
};

template <std::size_t N>
constexpr Preset preset (const char* name, const Value (&values)[N]) { return { name, values, (int) N }; }

const Preset presets[] = {
    { "初期化", nullptr, 0 },
    preset ("シンセリード", lead),
    preset ("スーパーソウ", supersaw),
    preset ("プラック", pluck),
    preset ("アシッド", acid),
    preset ("ワイドパッド", pad),
    preset ("サブベース", subBass),
    preset ("チップリード", chipLead),
    preset ("ノイズスイープ", noiseSweep),
};

constexpr int presetCount = (int) (sizeof (presets) / sizeof (presets[0]));
} // namespace

int numPresets()
{
    return presetCount;
}

const char* presetName (int index)
{
    return index >= 0 && index < presetCount ? presets[index].name : "";
}

void presetValues (int index, float* values)
{
    defaultValues (values);
    if (index < 0 || index >= presetCount) return;
    const auto& p = presets[index];
    for (int i = 0; i < p.count; ++i)
        values[p.values[i].param] = clampParam (p.values[i].param, p.values[i].value);
}
} // namespace grow
