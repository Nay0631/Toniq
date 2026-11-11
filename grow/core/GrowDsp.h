#pragma once

#include <cmath>
#include <cstdint>
#include "GrowParams.h"

// grow のコアの部品（JUCE を使わない）：エンベロープ・フィルター・オシレーター・乱数
namespace grow
{
inline constexpr float pi    = 3.14159265358979f;
inline constexpr float twoPi = 6.28318530717959f;

// ===== 音の高さ =====

// MIDI ノート番号（小数可）→ Hz
inline float noteToHz (float note) noexcept { return 440.0f * std::exp2 ((note - 69.0f) / 12.0f); }
// Hz → MIDI ノート番号（小数）
inline float hzToNote (float hz) noexcept { return 69.0f + 12.0f * std::log2 (hz / 440.0f); }
inline float dbToGain (float db) noexcept { return std::pow (10.0f, db / 20.0f); }

// ===== 乱数（xorshift。オーディオスレッドで使えるよう軽く・確保なし） =====
class Random
{
public:
    explicit Random (std::uint32_t seed = 0x9e3779b9u) : state (seed != 0 ? seed : 1u) {}
    float next() noexcept  // 0〜1
    {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return (float) (state >> 8) / 16777216.0f;
    }
    float bipolar() noexcept { return next() * 2.0f - 1.0f; }  // -1〜1

private:
    std::uint32_t state;
};

// ===== オシレーター（ノコギリ・矩形は PolyBLEP で折り返しノイズを抑える） =====

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
        case Wave::sine:     return std::sin (twoPi * phase);
        case Wave::triangle: return 1.0f - 4.0f * std::fabs (phase - 0.5f);
        case Wave::saw:      return 2.0f * phase - 1.0f - polyBlep (phase, dt);
        case Wave::square:
        {
            auto half = phase + 0.5f;
            if (half >= 1.0f) half -= 1.0f;
            return (phase < 0.5f ? 1.0f : -1.0f) + polyBlep (phase, dt) - polyBlep (half, dt);
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

// ===== ADSR（直線。鳴っている途中で掛け直すと、今の大きさから立ち上がり直す） =====
class Adsr
{
public:
    void setSampleRate (double sr) noexcept { sampleRate = (float) sr; }

    void setParams (const EnvParams& p) noexcept
    {
        params = p;
        attackRate = p.attack > 0.0f ? 1.0f / (p.attack * sampleRate) : 0.0f;
        decayRate  = p.decay > 0.0f ? (1.0f - p.sustain) / (p.decay * sampleRate) : 0.0f;
        if (state == State::sustain) value = p.sustain;
    }

    void noteOn() noexcept
    {
        if (attackRate > 0.0f)      state = State::attack;
        else if (decayRate > 0.0f) { value = 1.0f; state = State::decay; }
        else                       { value = params.sustain; state = State::sustain; }
    }

    void noteOff() noexcept
    {
        if (state == State::idle) return;
        if (params.release > 0.0f && value > 0.0f)
        {
            releaseRate = value / (params.release * sampleRate);
            state = State::release;
        }
        else
        {
            reset();
        }
    }

    void reset() noexcept
    {
        value = 0.0f;
        state = State::idle;
    }

    bool isActive() const noexcept { return state != State::idle; }

    float next() noexcept
    {
        switch (state)
        {
            case State::idle:
                return 0.0f;
            case State::attack:
                value += attackRate;
                if (value >= 1.0f)
                {
                    value = 1.0f;
                    state = decayRate > 0.0f ? State::decay : State::sustain;
                }
                break;
            case State::decay:
                value -= decayRate;
                if (value <= params.sustain)
                {
                    value = params.sustain;
                    state = State::sustain;
                }
                break;
            case State::sustain:
                value = params.sustain;
                break;
            case State::release:
                value -= releaseRate;
                if (value <= 0.0f) reset();
                break;
        }
        return value;
    }

private:
    enum class State { idle, attack, decay, sustain, release };
    State state = State::idle;
    EnvParams params;
    float sampleRate = 44100.0f;
    float value = 0.0f, attackRate = 0.0f, decayRate = 0.0f, releaseRate = 0.0f;
};

// ===== ステートバリアブルフィルター（TPT。左右2チャンネル） =====
class Svf
{
public:
    enum class Type { lowpass, highpass, bandpass };

    void setSampleRate (double sr) noexcept { sampleRate = (float) sr; update(); }
    void setType (Type t) noexcept { type = t; }
    void setCutoff (float hz) noexcept { if (hz != cutoff) { cutoff = hz; update(); } }
    void setQ (float q) noexcept { if (q != resonance) { resonance = q; update(); } }
    void reset() noexcept { s1[0] = s1[1] = s2[0] = s2[1] = 0.0f; }

    float process (int ch, float x) noexcept
    {
        auto& a = s1[ch];
        auto& b = s2[ch];
        const auto hp = h * (x - a * (g + r2) - b);
        const auto bp = hp * g + a;
        a = hp * g + bp;
        const auto lp = bp * g + b;
        b = bp * g + lp;
        return type == Type::lowpass ? lp : type == Type::bandpass ? bp : hp;
    }

private:
    void update() noexcept
    {
        const auto fc = std::fmin (cutoff, sampleRate * 0.49f);
        g  = std::tan (pi * fc / sampleRate);
        r2 = 1.0f / resonance;
        h  = 1.0f / (1.0f + r2 * g + g * g);
    }

    Type type = Type::lowpass;
    float sampleRate = 44100.0f, cutoff = 1000.0f, resonance = 0.7071f;
    float g = 0.0f, r2 = 1.414f, h = 1.0f;
    float s1[2] {}, s2[2] {};
};
} // namespace grow
