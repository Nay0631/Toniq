#include "Parameters.h"
#include "Text.h"

namespace grow
{
namespace
{
using juce::AudioParameterBool;
using juce::AudioParameterChoice;
using juce::AudioParameterFloat;
using juce::AudioParameterFloatAttributes;
using juce::AudioParameterInt;
using juce::AudioParameterIntAttributes;
using juce::NormalisableRange;
using juce::ParameterID;
using juce::String;

// LFO のテンポ同期（1周の長さを拍で表す。0 = 同期しない＝「速さ」の Hz で揺らす）
const char* const lfoSyncNames[] = { "オフ（Hz）", "1/1", "1/2", "1/4", "1/8", "1/16",
                                     "1/4 付点", "1/8 付点", "1/4 3連", "1/8 3連" };
const float lfoSyncBeats[]       = { 0.0f, 4.0f, 2.0f, 1.0f, 0.5f, 0.25f,
                                     1.5f, 0.75f, 2.0f / 3.0f, 1.0f / 3.0f };

// ディレイの長さ（拍。常にテンポに合わせる）
const char* const delayTimeNames[] = { "1/16", "1/8", "1/8 付点", "1/4", "1/4 付点", "1/2" };
const float delayTimeBeats[]       = { 0.25f, 0.5f, 0.75f, 1.0f, 1.5f, 2.0f };

juce::StringArray choices (std::initializer_list<const char*> names)
{
    juce::StringArray result;
    for (auto* n : names) result.add (jp (n));
    return result;
}

template <size_t N>
juce::StringArray choicesOf (const char* const (&names)[N])
{
    juce::StringArray result;
    for (auto* n : names) result.add (jp (n));
    return result;
}

// ===== 値の表示 =====
String percentText (float v)  { return String (juce::roundToInt (v * 100.0f)) + "%"; }
String centText (float v)     { return String (juce::roundToInt (v)) + " ct"; }
String dbText (float v)       { return String (v, 1) + " dB"; }
String semitoneText (float v) { return (v > 0.0f ? "+" : "") + String (v, 1) + jp (" 半音"); }

String hzText (float v)
{
    if (v >= 1000.0f) return String (v / 1000.0f, 2) + " kHz";
    return String (v, v < 10.0f ? 2 : 0) + " Hz";
}

String secondsText (float v)
{
    if (v < 1.0f) return String (juce::roundToInt (v * 1000.0f)) + " ms";
    return String (v, 2) + " s";
}

// ===== パラメーターの作成 =====
NormalisableRange<float> skewed (float start, float end, float centre)
{
    NormalisableRange<float> range (start, end);
    range.setSkewForCentre (centre);
    return range;
}

std::unique_ptr<AudioParameterFloat> floatParam (const String& id, const char* name, NormalisableRange<float> range,
                                                 float defaultValue, String (*toText) (float))
{
    return std::make_unique<AudioParameterFloat> (
        ParameterID { id, 1 }, jp (name), range, defaultValue,
        AudioParameterFloatAttributes().withStringFromValueFunction ([toText] (float v, int) { return toText (v); }));
}

std::unique_ptr<AudioParameterFloat> percentParam (const String& id, const char* name, float defaultValue)
{
    return floatParam (id, name, { 0.0f, 1.0f }, defaultValue, percentText);
}

std::unique_ptr<AudioParameterFloat> timeParam (const String& id, const char* name, float maxSeconds, float defaultValue)
{
    return floatParam (id, name, skewed (0.001f, maxSeconds, 0.5f), defaultValue, secondsText);
}

std::unique_ptr<AudioParameterInt> intParam (const String& id, const char* name, int min, int max, int defaultValue,
                                             bool showSign)
{
    return std::make_unique<AudioParameterInt> (
        ParameterID { id, 1 }, jp (name), min, max, defaultValue,
        AudioParameterIntAttributes().withStringFromValueFunction ([showSign] (int v, int) {
            return (showSign && v > 0 ? "+" : "") + String (v);
        }));
}

std::unique_ptr<AudioParameterChoice> choiceParam (const String& id, const char* name, juce::StringArray list,
                                                   int defaultIndex)
{
    return std::make_unique<AudioParameterChoice> (ParameterID { id, 1 }, jp (name), list, defaultIndex);
}

std::unique_ptr<AudioParameterBool> boolParam (const String& id, const char* name, bool defaultValue)
{
    return std::make_unique<AudioParameterBool> (ParameterID { id, 1 }, jp (name), defaultValue);
}

void addOsc (juce::AudioProcessorValueTreeState::ParameterLayout& layout, int osc)
{
    const auto waves = choices ({ "サイン", "三角", "ノコギリ", "矩形" });
    layout.add (choiceParam (ids::oscId (osc, "wave"), "波形", waves, 2),
                intParam (ids::oscId (osc, "octave"), "オクターブ", -3, 3, 0, true),
                intParam (ids::oscId (osc, "semi"), "半音", -12, 12, 0, true),
                floatParam (ids::oscId (osc, "fine"), "微調整", { -100.0f, 100.0f }, 0.0f, centText),
                percentParam (ids::oscId (osc, "level"), "音量", osc == 0 ? 0.8f : 0.0f),
                intParam (ids::oscId (osc, "unison"), "ユニゾン", 1, maxUnison, 1, false),
                floatParam (ids::oscId (osc, "detune"), "デチューン", { 0.0f, 100.0f }, 20.0f, centText),
                percentParam (ids::oscId (osc, "width"), "ステレオ幅", 0.5f));
}

float raw (const juce::AudioProcessorValueTreeState& state, const String& id)
{
    auto* value = state.getRawParameterValue (id);
    jassert (value != nullptr);  // ID の書き間違い
    return value != nullptr ? value->load() : 0.0f;
}

int rawInt (const juce::AudioProcessorValueTreeState& state, const String& id)
{
    return juce::roundToInt (raw (state, id));
}

juce::ADSR::Parameters adsr (const juce::AudioProcessorValueTreeState& state,
                             const char* a, const char* d, const char* s, const char* r)
{
    return { raw (state, a), raw (state, d), raw (state, s), raw (state, r) };
}
} // namespace

juce::String ids::oscId (int osc, const char* name)
{
    return "osc" + juce::String (osc + 1) + "_" + name;
}

juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    addOsc (layout, 0);
    addOsc (layout, 1);
    layout.add (percentParam (ids::subLevel, "サブ", 0.0f),
                percentParam (ids::noiseLevel, "ノイズ", 0.0f));

    layout.add (choiceParam (ids::filterType, "タイプ",
                             choices ({ "ローパス 12", "ローパス 24", "ハイパス", "バンドパス" }), 1),
                floatParam (ids::cutoff, "カットオフ", skewed (20.0f, 20000.0f, 1000.0f), 6000.0f, hzText),
                percentParam (ids::resonance, "レゾナンス", 0.15f),
                floatParam (ids::filterEnvAmt, "EG の量", { -48.0f, 48.0f }, 0.0f, semitoneText),
                percentParam (ids::keyTrack, "キー追従", 0.5f));

    layout.add (timeParam (ids::fenvA, "A", 10.0f, 0.005f),
                timeParam (ids::fenvD, "D", 10.0f, 0.3f),
                percentParam (ids::fenvS, "S", 0.5f),
                timeParam (ids::fenvR, "R", 15.0f, 0.3f));

    layout.add (timeParam (ids::aenvA, "A", 10.0f, 0.005f),
                timeParam (ids::aenvD, "D", 10.0f, 0.3f),
                percentParam (ids::aenvS, "S", 0.8f),
                timeParam (ids::aenvR, "R", 15.0f, 0.3f));

    layout.add (choiceParam (ids::lfoWave, "波形", choices ({ "サイン", "三角", "ノコギリ", "矩形", "ランダム" }), 0),
                choiceParam (ids::lfoSync, "テンポ同期", choicesOf (lfoSyncNames), 0),
                floatParam (ids::lfoRate, "速さ", skewed (0.05f, 20.0f, 3.0f), 5.0f, hzText),
                boolParam (ids::lfoRetrigger, "リトリガー", false),
                floatParam (ids::lfoPitch, "→ 高さ", skewed (0.0f, 12.0f, 1.0f), 0.0f, semitoneText),
                floatParam (ids::lfoFilter, "→ フィルター", { 0.0f, 48.0f }, 0.0f, semitoneText),
                percentParam (ids::lfoAmp, "→ 音量", 0.0f));

    layout.add (floatParam (ids::pitchEnvAmt, "量", { -36.0f, 36.0f }, 0.0f, semitoneText),
                timeParam (ids::pitchEnvTime, "時間", 2.0f, 0.08f));

    layout.add (choiceParam (ids::voiceMode, "モード", choices ({ "ポリ", "モノ", "レガート" }), 0),
                floatParam (ids::glide, "グライド", skewed (0.0f, 2.0f, 0.3f), 0.0f, secondsText),
                percentParam (ids::velocity, "ベロシティ", 0.5f));

    layout.add (percentParam (ids::drive, "ドライブ", 0.0f),
                percentParam (ids::chorusMix, "量", 0.0f),
                floatParam (ids::chorusRate, "速さ", skewed (0.05f, 5.0f, 1.0f), 0.8f, hzText),
                percentParam (ids::chorusDepth, "深さ", 0.3f),
                percentParam (ids::delayMix, "量", 0.0f),
                choiceParam (ids::delayTime, "長さ", choicesOf (delayTimeNames), 2),
                percentParam (ids::delayFeedback, "くり返し", 0.3f),
                boolParam (ids::delayPingPong, "左右に跳ねる", true),
                percentParam (ids::reverbMix, "量", 0.15f),
                percentParam (ids::reverbSize, "広さ", 0.5f),
                floatParam (ids::master, "マスター", { -36.0f, 6.0f }, -6.0f, dbText));

    return layout;
}

GrowParams readParams (const juce::AudioProcessorValueTreeState& state, double bpm)
{
    GrowParams p;
    const auto beatSeconds = 60.0f / (float) juce::jmax (20.0, bpm);

    for (int o = 0; o < 2; ++o)
    {
        auto& osc       = p.osc[o];
        osc.wave        = (Wave) rawInt (state, ids::oscId (o, "wave"));
        osc.octave      = rawInt (state, ids::oscId (o, "octave"));
        osc.semitone    = rawInt (state, ids::oscId (o, "semi"));
        osc.fineCents   = raw (state, ids::oscId (o, "fine"));
        osc.level       = raw (state, ids::oscId (o, "level"));
        osc.unison      = juce::jlimit (1, maxUnison, rawInt (state, ids::oscId (o, "unison")));
        osc.detuneCents = raw (state, ids::oscId (o, "detune"));
        osc.width       = raw (state, ids::oscId (o, "width"));
    }
    p.subLevel   = raw (state, ids::subLevel);
    p.noiseLevel = raw (state, ids::noiseLevel);

    p.filterType     = (FilterType) rawInt (state, ids::filterType);
    p.cutoffHz       = raw (state, ids::cutoff);
    p.resonance      = raw (state, ids::resonance);
    p.filterEnvSemis = raw (state, ids::filterEnvAmt);
    p.keyTrack       = raw (state, ids::keyTrack);
    p.filterEnv      = adsr (state, ids::fenvA, ids::fenvD, ids::fenvS, ids::fenvR);
    p.ampEnv         = adsr (state, ids::aenvA, ids::aenvD, ids::aenvS, ids::aenvR);

    p.lfoWave      = (LfoWave) rawInt (state, ids::lfoWave);
    const auto syncIndex = juce::jlimit (0, (int) std::size (lfoSyncBeats) - 1, rawInt (state, ids::lfoSync));
    p.lfoHz        = syncIndex == 0 ? raw (state, ids::lfoRate)
                                    : 1.0f / (lfoSyncBeats[syncIndex] * beatSeconds);
    p.lfoRetrigger = raw (state, ids::lfoRetrigger) > 0.5f;
    p.lfoPitchSemis  = raw (state, ids::lfoPitch);
    p.lfoFilterSemis = raw (state, ids::lfoFilter);
    p.lfoAmp         = raw (state, ids::lfoAmp);

    p.pitchEnvSemis = raw (state, ids::pitchEnvAmt);
    p.pitchEnvTime  = raw (state, ids::pitchEnvTime);

    p.voiceMode    = (VoiceMode) rawInt (state, ids::voiceMode);
    p.glideTime    = raw (state, ids::glide);
    p.velocitySens = raw (state, ids::velocity);

    p.drive         = raw (state, ids::drive);
    p.chorusMix     = raw (state, ids::chorusMix);
    p.chorusRate    = raw (state, ids::chorusRate);
    p.chorusDepth   = raw (state, ids::chorusDepth);
    p.delayMix      = raw (state, ids::delayMix);
    const auto delayIndex = juce::jlimit (0, (int) std::size (delayTimeBeats) - 1, rawInt (state, ids::delayTime));
    p.delaySeconds  = delayTimeBeats[delayIndex] * beatSeconds;
    p.delayFeedback = raw (state, ids::delayFeedback);
    p.delayPingPong = raw (state, ids::delayPingPong) > 0.5f;
    p.reverbMix     = raw (state, ids::reverbMix);
    p.reverbSize    = raw (state, ids::reverbSize);
    p.masterDb      = raw (state, ids::master);
    return p;
}
} // namespace grow
