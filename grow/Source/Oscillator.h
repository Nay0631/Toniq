#pragma once

#include <cmath>
#include <juce_core/juce_core.h>
#include "Parameters.h"

// オシレーターの波形と音の高さの変換。
// ノコギリ・矩形は PolyBLEP で折り返しノイズ（エイリアシング）を抑える。三角・サインは素のまま
namespace grow
{
// 位相 t（0〜1）・1サンプルで進む位相 dt のときの、不連続な所の補正量
inline float polyBlep (float t, float dt) noexcept
{
    if (t < dt)
    {
        t /= dt;
        return t + t - t * t - 1.0f;
    }
    if (t > 1.0f - dt)
    {
        t = (t - 1.0f) / dt;
        return t * t + t + t + 1.0f;
    }
    return 0.0f;
}

inline float oscillatorSample (Wave wave, float phase, float dt) noexcept
{
    switch (wave)
    {
        case Wave::sine:
            return std::sin (juce::MathConstants<float>::twoPi * phase);
        case Wave::triangle:
            return 1.0f - 4.0f * std::abs (phase - 0.5f);
        case Wave::saw:
            return 2.0f * phase - 1.0f - polyBlep (phase, dt);
        case Wave::square:
        {
            auto value = phase < 0.5f ? 1.0f : -1.0f;
            auto half  = phase + 0.5f;
            if (half >= 1.0f) half -= 1.0f;
            return value + polyBlep (phase, dt) - polyBlep (half, dt);
        }
    }
    return 0.0f;
}

// 位相を dt 進めて 0〜1 に収める
inline void advancePhase (float& phase, float dt) noexcept
{
    phase += dt;
    if (phase >= 1.0f) phase -= std::floor (phase);
}

// MIDI ノート番号（小数可）→ Hz
inline float noteToHz (float note) noexcept
{
    return 440.0f * std::exp2 ((note - 69.0f) / 12.0f);
}

// Hz → MIDI ノート番号（小数）
inline float hzToNote (float hz) noexcept
{
    return 69.0f + 12.0f * std::log2 (hz / 440.0f);
}
} // namespace grow
