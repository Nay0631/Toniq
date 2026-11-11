#include "GrowParams.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace grow
{
namespace
{
const char* const waveNames[]      = { "サイン", "三角", "ノコギリ", "矩形" };
const char* const filterNames[]    = { "ローパス 12", "ローパス 24", "ハイパス", "バンドパス" };
const char* const lfoWaveNames[]   = { "サイン", "三角", "ノコギリ", "矩形", "ランダム" };
const char* const voiceModeNames[] = { "ポリ", "モノ", "レガート" };
const char* const toggleNames[]    = { "オフ", "オン" };

// LFO のテンポ同期（1周の長さを拍で表す。0 = 同期しない＝「速さ」の Hz で揺らす）
const char* const lfoSyncNames[] = { "オフ（Hz）", "1/1", "1/2", "1/4", "1/8", "1/16",
                                     "1/4 付点", "1/8 付点", "1/4 3連", "1/8 3連" };
const float lfoSyncBeats[]       = { 0.0f, 4.0f, 2.0f, 1.0f, 0.5f, 0.25f,
                                     1.5f, 0.75f, 2.0f / 3.0f, 1.0f / 3.0f };

// ディレイの長さ（拍。常にテンポに合わせる）
const char* const delayTimeNames[] = { "1/16", "1/8", "1/8 付点", "1/4", "1/4 付点", "1/2" };
const float delayTimeBeats[]       = { 0.25f, 0.5f, 0.75f, 1.0f, 1.5f, 2.0f };

template <typename T, std::size_t N>
constexpr int countOf (const T (&)[N]) { return (int) N; }

using K = ParamKind;
using U = ParamUnit;

#define GROW_CHOICES(list) list, countOf (list)
#define GROW_NO_CHOICES nullptr, 0

#define GROW_OSC(n, levelDefault)                                                                                       \
    { "osc" #n "_wave",   "OSC " #n, "波形",       K::choice,     0, 3, 2, 0, U::none, GROW_CHOICES (waveNames) },      \
    { "osc" #n "_octave", "OSC " #n, "オクターブ", K::integer,   -3, 3, 0, 0, U::signedInteger, GROW_NO_CHOICES },      \
    { "osc" #n "_semi",   "OSC " #n, "半音",       K::integer,  -12, 12, 0, 0, U::signedInteger, GROW_NO_CHOICES },     \
    { "osc" #n "_fine",   "OSC " #n, "微調整",     K::continuous, -100, 100, 0, 0, U::cents, GROW_NO_CHOICES },         \
    { "osc" #n "_level",  "OSC " #n, "音量",       K::continuous, 0, 1, levelDefault, 0, U::percent, GROW_NO_CHOICES }, \
    { "osc" #n "_unison", "OSC " #n, "ユニゾン",   K::integer,    1, maxUnison, 1, 0, U::none, GROW_NO_CHOICES },       \
    { "osc" #n "_detune", "OSC " #n, "デチューン", K::continuous, 0, 100, 20, 0, U::cents, GROW_NO_CHOICES },           \
    { "osc" #n "_width",  "OSC " #n, "ステレオ幅", K::continuous, 0, 1, 0.5f, 0, U::percent, GROW_NO_CHOICES }

// 並びは Param と同じにする
const ParamInfo table[] = {
    GROW_OSC (1, 0.8f),
    GROW_OSC (2, 0.0f),
    { "sub_level",   "サブ・ノイズ", "サブ",   K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },
    { "noise_level", "サブ・ノイズ", "ノイズ", K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },

    { "filter_type",     "フィルター", "タイプ",     K::choice,     0, 3, 1, 0, U::none, GROW_CHOICES (filterNames) },
    { "filter_cutoff",   "フィルター", "カットオフ", K::continuous, 20, 20000, 6000, 1000, U::hertz, GROW_NO_CHOICES },
    { "filter_reso",     "フィルター", "レゾナンス", K::continuous, 0, 1, 0.15f, 0, U::percent, GROW_NO_CHOICES },
    { "filter_env",      "フィルター", "EG の量",    K::continuous, -48, 48, 0, 0, U::semitones, GROW_NO_CHOICES },
    { "filter_keytrack", "フィルター", "キー追従",   K::continuous, 0, 1, 0.5f, 0, U::percent, GROW_NO_CHOICES },
    { "filter_drive",    "フィルター", "ドライブ",   K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },
    { "filter_velocity", "フィルター", "ベロシティ", K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },

    { "fenv_attack",  "フィルター EG", "A", K::continuous, 0.001f, 10, 0.005f, 0.5f, U::seconds, GROW_NO_CHOICES },
    { "fenv_decay",   "フィルター EG", "D", K::continuous, 0.001f, 10, 0.3f, 0.5f, U::seconds, GROW_NO_CHOICES },
    { "fenv_sustain", "フィルター EG", "S", K::continuous, 0, 1, 0.5f, 0, U::percent, GROW_NO_CHOICES },
    { "fenv_release", "フィルター EG", "R", K::continuous, 0.001f, 15, 0.3f, 0.5f, U::seconds, GROW_NO_CHOICES },

    { "aenv_attack",  "アンプ EG", "A", K::continuous, 0.001f, 10, 0.005f, 0.5f, U::seconds, GROW_NO_CHOICES },
    { "aenv_decay",   "アンプ EG", "D", K::continuous, 0.001f, 10, 0.3f, 0.5f, U::seconds, GROW_NO_CHOICES },
    { "aenv_sustain", "アンプ EG", "S", K::continuous, 0, 1, 0.8f, 0, U::percent, GROW_NO_CHOICES },
    { "aenv_release", "アンプ EG", "R", K::continuous, 0.001f, 15, 0.3f, 0.5f, U::seconds, GROW_NO_CHOICES },

    { "lfo_wave",      "LFO", "波形",         K::choice,     0, 4, 0, 0, U::none, GROW_CHOICES (lfoWaveNames) },
    { "lfo_sync",      "LFO", "テンポ同期",   K::choice,     0, 9, 0, 0, U::none, GROW_CHOICES (lfoSyncNames) },
    { "lfo_rate",      "LFO", "速さ",         K::continuous, 0.05f, 20, 5, 3, U::hertz, GROW_NO_CHOICES },
    { "lfo_retrigger", "LFO", "リトリガー",   K::toggle,     0, 1, 0, 0, U::none, GROW_CHOICES (toggleNames) },
    { "lfo_pitch",     "LFO", "→ 高さ",       K::continuous, 0, 12, 0, 1, U::semitones, GROW_NO_CHOICES },
    { "lfo_filter",    "LFO", "→ フィルター", K::continuous, 0, 48, 0, 0, U::semitones, GROW_NO_CHOICES },
    { "lfo_amp",       "LFO", "→ 音量",       K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },

    { "penv_amount", "ピッチ EG", "量",   K::continuous, -36, 36, 0, 0, U::semitones, GROW_NO_CHOICES },
    { "penv_time",   "ピッチ EG", "時間", K::continuous, 0.001f, 2, 0.08f, 0.5f, U::seconds, GROW_NO_CHOICES },

    { "voice_mode", "ボイス", "モード",     K::choice,     0, 2, 0, 0, U::none, GROW_CHOICES (voiceModeNames) },
    { "glide",      "ボイス", "グライド",   K::continuous, 0, 2, 0, 0.3f, U::seconds, GROW_NO_CHOICES },
    { "velocity",   "ボイス", "ベロシティ", K::continuous, 0, 1, 0.5f, 0, U::percent, GROW_NO_CHOICES },
    { "drift",      "ボイス", "ドリフト",   K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },

    { "fx_drive",     "ドライブ", "ドライブ", K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },
    { "chorus_mix",   "コーラス", "量",       K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },
    { "chorus_rate",  "コーラス", "速さ",     K::continuous, 0.05f, 5, 0.8f, 1, U::hertz, GROW_NO_CHOICES },
    { "chorus_depth", "コーラス", "深さ",     K::continuous, 0, 1, 0.3f, 0, U::percent, GROW_NO_CHOICES },

    { "delay_mix",      "ディレイ", "量",           K::continuous, 0, 1, 0, 0, U::percent, GROW_NO_CHOICES },
    { "delay_time",     "ディレイ", "長さ",         K::choice,     0, 5, 2, 0, U::none, GROW_CHOICES (delayTimeNames) },
    { "delay_feedback", "ディレイ", "くり返し",     K::continuous, 0, 1, 0.3f, 0, U::percent, GROW_NO_CHOICES },
    { "delay_pingpong", "ディレイ", "左右に跳ねる", K::toggle,     0, 1, 1, 0, U::none, GROW_CHOICES (toggleNames) },

    { "reverb_mix",  "リバーブ", "量",   K::continuous, 0, 1, 0.15f, 0, U::percent, GROW_NO_CHOICES },
    { "reverb_size", "リバーブ", "広さ", K::continuous, 0, 1, 0.5f, 0, U::percent, GROW_NO_CHOICES },

    { "master", "出力", "マスター", K::continuous, -36, 6, -6, 0, U::decibels, GROW_NO_CHOICES },
};

#undef GROW_OSC
#undef GROW_NO_CHOICES
#undef GROW_CHOICES

static_assert (sizeof (table) / sizeof (table[0]) == numParams, "table の並びを Param とそろえる");

// 0〜1 の位置にかける指数（JUCE の NormalisableRange と同じ求め方）
float skewOf (const ParamInfo& info)
{
    if (info.skewCentre <= info.min || info.skewCentre >= info.max) return 1.0f;
    return std::log (0.5f) / std::log ((info.skewCentre - info.min) / (info.max - info.min));
}

float value (const float* values, Param p) { return values[p]; }
int   intValue (const float* values, Param p) { return (int) std::lround (values[p]); }

EnvParams envelope (const float* values, Param a)
{
    return { values[a], values[a + 1], values[a + 2], values[a + 3] };
}
} // namespace

const ParamInfo& paramInfo (int index)
{
    return table[std::clamp (index, 0, numParams - 1)];
}

int findParam (const char* id)
{
    for (int i = 0; i < numParams; ++i)
        if (std::strcmp (table[i].id, id) == 0) return i;
    return -1;
}

void defaultValues (float* values)
{
    for (int i = 0; i < numParams; ++i) values[i] = table[i].defaultValue;
}

float clampParam (int index, float v)
{
    const auto& info = paramInfo (index);
    if (std::isnan (v)) return info.defaultValue;
    v = std::clamp (v, info.min, info.max);
    if (info.kind != ParamKind::continuous) v = std::round (v);
    return v;
}

float paramToNormalised (int index, float v)
{
    const auto& info = paramInfo (index);
    const auto proportion = (clampParam (index, v) - info.min) / (info.max - info.min);
    return std::pow (proportion, skewOf (info));
}

float normalisedToParam (int index, float normalised)
{
    const auto& info = paramInfo (index);
    auto proportion = std::clamp (normalised, 0.0f, 1.0f);
    const auto skew = skewOf (info);
    if (skew != 1.0f && proportion > 0.0f) proportion = std::exp (std::log (proportion) / skew);
    return clampParam (index, info.min + (info.max - info.min) * proportion);
}

int formatParam (int index, float v, char* out, int size)
{
    if (out == nullptr || size <= 0) return 0;
    const auto& info = paramInfo (index);
    v = clampParam (index, v);

    if (info.choices != nullptr)
    {
        const auto choice = std::clamp ((int) v - (int) info.min, 0, info.numChoices - 1);
        return std::snprintf (out, (size_t) size, "%s", info.choices[choice]);
    }

    switch (info.unit)
    {
        case ParamUnit::percent:   return std::snprintf (out, (size_t) size, "%d%%", (int) std::lround (v * 100.0f));
        case ParamUnit::cents:     return std::snprintf (out, (size_t) size, "%d ct", (int) std::lround (v));
        case ParamUnit::decibels:  return std::snprintf (out, (size_t) size, "%.1f dB", v);
        case ParamUnit::semitones: return std::snprintf (out, (size_t) size, "%s%.1f 半音", v > 0.0f ? "+" : "", v);
        case ParamUnit::signedInteger:
            return std::snprintf (out, (size_t) size, "%s%d", v > 0.0f ? "+" : "", (int) std::lround (v));
        case ParamUnit::hertz:
            if (v >= 1000.0f) return std::snprintf (out, (size_t) size, "%.2f kHz", v / 1000.0f);
            return std::snprintf (out, (size_t) size, v < 10.0f ? "%.2f Hz" : "%.0f Hz", v);
        case ParamUnit::seconds:
            if (v < 1.0f) return std::snprintf (out, (size_t) size, "%d ms", (int) std::lround (v * 1000.0f));
            return std::snprintf (out, (size_t) size, "%.2f s", v);
        case ParamUnit::none:
            break;
    }
    if (info.kind != ParamKind::continuous) return std::snprintf (out, (size_t) size, "%d", (int) std::lround (v));
    return std::snprintf (out, (size_t) size, "%.2f", v);
}

GrowParams makeParams (const float* values, double bpm)
{
    GrowParams p;
    const auto beatSeconds = 60.0f / (float) std::max (20.0, bpm);

    for (int o = 0; o < 2; ++o)
    {
        const auto base = (Param) (o == 0 ? osc1Wave : osc2Wave);
        auto& osc       = p.osc[o];
        osc.wave        = (Wave) intValue (values, base);
        osc.octave      = intValue (values, (Param) (base + 1));
        osc.semitone    = intValue (values, (Param) (base + 2));
        osc.fineCents   = value (values, (Param) (base + 3));
        osc.level       = value (values, (Param) (base + 4));
        osc.unison      = std::clamp (intValue (values, (Param) (base + 5)), 1, maxUnison);
        osc.detuneCents = value (values, (Param) (base + 6));
        osc.width       = value (values, (Param) (base + 7));
    }
    p.subLevel   = value (values, subLevel);
    p.noiseLevel = value (values, noiseLevel);

    p.filterType     = (FilterType) intValue (values, filterType);
    p.cutoffHz       = value (values, filterCutoff);
    p.resonance      = value (values, filterResonance);
    p.filterEnvSemis = value (values, filterEnvAmount);
    p.keyTrack       = value (values, filterKeyTrack);
    p.filterDrive    = value (values, filterDrive);
    p.velocitySemis  = value (values, filterVelocity) * 24.0f;  // 最大 2 オクターブ
    p.filterEnv      = envelope (values, fenvAttack);
    p.ampEnv         = envelope (values, aenvAttack);

    p.lfoWave = (LfoWave) intValue (values, lfoWave);
    const auto sync = std::clamp (intValue (values, lfoSync), 0, countOf (lfoSyncBeats) - 1);
    p.lfoHz          = sync == 0 ? value (values, lfoRate) : 1.0f / (lfoSyncBeats[sync] * beatSeconds);
    p.lfoRetrigger   = value (values, lfoRetrigger) > 0.5f;
    p.lfoPitchSemis  = value (values, lfoPitch);
    p.lfoFilterSemis = value (values, lfoFilter);
    p.lfoAmp         = value (values, lfoAmp);

    p.pitchEnvSemis = value (values, pitchEnvAmount);
    p.pitchEnvTime  = value (values, pitchEnvTime);

    p.voiceMode    = (VoiceMode) intValue (values, voiceMode);
    p.glideTime    = value (values, glide);
    p.velocitySens = value (values, velocity);
    p.drift        = value (values, drift);

    p.drive         = value (values, drive);
    p.chorusMix     = value (values, chorusMix);
    p.chorusRate    = value (values, chorusRate);
    p.chorusDepth   = value (values, chorusDepth);
    p.delayMix      = value (values, delayMix);
    const auto delayIndex = std::clamp (intValue (values, delayTime), 0, countOf (delayTimeBeats) - 1);
    p.delaySeconds  = delayTimeBeats[delayIndex] * beatSeconds;
    p.delayFeedback = value (values, delayFeedback);
    p.delayPingPong = value (values, delayPingPong) > 0.5f;
    p.reverbMix     = value (values, reverbMix);
    p.reverbSize    = value (values, reverbSize);
    p.masterDb      = value (values, master);
    return p;
}
} // namespace grow
