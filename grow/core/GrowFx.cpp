#include "GrowFx.h"
#include "GrowDsp.h"

#include <algorithm>

namespace grow
{
namespace
{
constexpr double maxDelaySeconds  = 4.0;
constexpr double chorusMaxSeconds = 0.05;

// Freeverb の長さ（44.1kHz のサンプル数。サンプリング周波数に合わせて伸ばす）。右は少しずらして左右に広げる
constexpr int combTunings[]    = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 };
constexpr int allpassTunings[] = { 556, 441, 341, 225 };
constexpr int stereoSpread     = 23;

constexpr float limiterThreshold = 0.891f;  // -1 dB
} // namespace

float Fx::DelayLine::read (float delay) const
{
    const auto size = (int) buffer.size();
    auto position = (float) write - delay;
    while (position < 0.0f) position += (float) size;
    const auto i0   = (int) position;
    const auto frac = position - (float) i0;
    const auto a = buffer[(size_t) (i0 % size)];
    const auto b = buffer[(size_t) ((i0 + 1) % size)];
    return a + (b - a) * frac;
}

float Fx::Comb::process (float input, float damp, float feedback)
{
    const auto out = buffer[(size_t) index];
    last = out * (1.0f - damp) + last * damp;
    buffer[(size_t) index] = input + last * feedback;
    if (++index >= (int) buffer.size()) index = 0;
    return out;
}

float Fx::Allpass::process (float input)
{
    const auto buffered = buffer[(size_t) index];
    buffer[(size_t) index] = input + buffered * 0.5f;
    if (++index >= (int) buffer.size()) index = 0;
    return buffered - input;
}

void Fx::prepare (double newSampleRate)
{
    sampleRate = newSampleRate;
    const auto scale = sampleRate / 44100.0;

    for (int ch = 0; ch < 2; ++ch)
    {
        chorusLine[ch].resize ((int) (chorusMaxSeconds * sampleRate) + 4);
        delayLine[ch].resize ((int) (maxDelaySeconds * sampleRate) + 4);
        for (int i = 0; i < numCombs; ++i)
            combs[ch][i].buffer.assign ((size_t) ((combTunings[i] + ch * stereoSpread) * scale), 0.0f);
        for (int i = 0; i < numAllpasses; ++i)
            allpasses[ch][i].buffer.assign ((size_t) ((allpassTunings[i] + ch * stereoSpread) * scale), 0.0f);
    }
    reset();
}

void Fx::reset()
{
    for (int ch = 0; ch < 2; ++ch)
    {
        chorusLine[ch].clear();
        delayLine[ch].clear();
        for (auto& c : combs[ch])
        {
            std::fill (c.buffer.begin(), c.buffer.end(), 0.0f);
            c.last = 0.0f;
        }
        for (auto& a : allpasses[ch])
            std::fill (a.buffer.begin(), a.buffer.end(), 0.0f);
    }
    chorusPhase  = 0.0f;
    delaySamples = 0.0f;
    masterGain   = 0.0f;
    limiterGain  = 1.0f;
}

void Fx::processChorus (float* left, float* right, int numSamples, const GrowParams& p)
{
    // 左右で揺れを 90° ずらした2本の揺れるディレイ。量で元の音と混ぜる
    const auto sr     = (float) sampleRate;
    const auto step   = p.chorusRate / sr;
    const auto centre = 0.008f * sr;
    const auto depth  = 0.007f * sr * std::clamp (p.chorusDepth, 0.0f, 1.0f);
    const auto mix    = std::clamp (p.chorusMix, 0.0f, 1.0f);

    for (int n = 0; n < numSamples; ++n)
    {
        chorusPhase += step;
        if (chorusPhase >= 1.0f) chorusPhase -= 1.0f;
        const float in[2] = { left[n], right[n] };
        float out[2];
        for (int ch = 0; ch < 2; ++ch)
        {
            chorusLine[ch].push (in[ch]);
            const auto lfo = std::sin (twoPi * (chorusPhase + 0.25f * (float) ch));
            const auto wet = chorusLine[ch].read (std::max (1.0f, centre + depth * lfo));
            out[ch] = in[ch] * (1.0f - mix) + wet * mix;
        }
        left[n]  = out[0];
        right[n] = out[1];
    }
}

void Fx::processDelay (float* left, float* right, int numSamples, const GrowParams& p)
{
    const auto maxSamples = (float) (maxDelaySeconds * sampleRate) - 2.0f;
    const auto target     = std::clamp (p.delaySeconds * (float) sampleRate, 1.0f, maxSamples);
    if (delaySamples <= 0.0f) delaySamples = target;
    // 長さを変えたときに「ブツッ」とならないよう滑らかに（約 80ms）
    const auto smooth   = 1.0f - std::exp (-1.0f / (0.08f * (float) sampleRate / 3.0f));
    const auto feedback = std::clamp (p.delayFeedback, 0.0f, 0.95f);
    const auto mix      = p.delayMix;

    for (int n = 0; n < numSamples; ++n)
    {
        delaySamples += (target - delaySamples) * smooth;
        const auto dl  = delayLine[0].read (delaySamples);
        const auto dr  = delayLine[1].read (delaySamples);
        const auto inL = left[n], inR = right[n];

        if (p.delayPingPong)
        {
            // 入力は左から入れ、くり返すたびに左右を入れ替える
            delayLine[0].push (0.5f * (inL + inR) + dr * feedback);
            delayLine[1].push (dl * feedback);
        }
        else
        {
            delayLine[0].push (inL + dl * feedback);
            delayLine[1].push (inR + dr * feedback);
        }
        left[n]  = inL + dl * mix;
        right[n] = inR + dr * mix;
    }
}

void Fx::processReverb (float* left, float* right, int numSamples, const GrowParams& p)
{
    // Freeverb（JUCE の Reverb と同じ作り）。量が 0 でも響きの残りは鳴らし切る
    const auto feedback = std::clamp (p.reverbSize, 0.0f, 1.0f) * 0.28f + 0.7f;
    const auto damp     = 0.5f * 0.4f;
    const auto wet      = std::clamp (p.reverbMix, 0.0f, 1.0f) * 3.0f;
    const auto wet1     = 0.5f * wet * 2.0f;  // 左右の広がり 1（いっぱい）
    const auto wet2     = 0.0f;
    const auto dry      = 1.0f - 0.4f * std::clamp (p.reverbMix, 0.0f, 1.0f);
    const auto gain     = 0.015f;

    for (int n = 0; n < numSamples; ++n)
    {
        const auto input = (left[n] + right[n]) * gain;
        float out[2] = { 0.0f, 0.0f };
        for (int ch = 0; ch < 2; ++ch)
        {
            for (auto& c : combs[ch]) out[ch] += c.process (input, damp, feedback);
            for (auto& a : allpasses[ch]) out[ch] = a.process (out[ch]);
        }
        left[n]  = out[0] * wet1 + out[1] * wet2 + left[n] * dry;
        right[n] = out[1] * wet1 + out[0] * wet2 + right[n] * dry;
    }
}

void Fx::processOutput (float* left, float* right, int numSamples, const GrowParams& p)
{
    const auto target  = dbToGain (p.masterDb);
    const auto smooth  = 1.0f - std::exp (-1.0f / (0.02f * (float) sampleRate / 3.0f));
    const auto release = 1.0f - std::exp (-1.0f / (0.1f * (float) sampleRate));  // リミッターの戻り（約 100ms）

    for (int n = 0; n < numSamples; ++n)
    {
        masterGain += (target - masterGain) * smooth;
        auto l = left[n] * masterGain;
        auto r = right[n] * masterGain;

        // リミッター：-1 dB を超えたらすぐ下げ、ゆっくり戻す
        const auto peak = std::max (std::fabs (l), std::fabs (r));
        const auto want = peak > limiterThreshold ? limiterThreshold / peak : 1.0f;
        limiterGain = want < limiterGain ? want : limiterGain + (want - limiterGain) * release;
        left[n]  = std::clamp (l * limiterGain, -1.0f, 1.0f);
        right[n] = std::clamp (r * limiterGain, -1.0f, 1.0f);
    }
}

void Fx::process (float* left, float* right, int numSamples, const GrowParams& p)
{
    if (p.drive > 0.001f)
    {
        // tanh で丸く歪ませる。tanh (k) で割って、強くしても一番大きい所の音量はそろえる
        const auto k    = 1.0f + p.drive * 9.0f;
        const auto norm = 1.0f / std::tanh (k);
        for (int n = 0; n < numSamples; ++n)
        {
            left[n]  = std::tanh (k * left[n]) * norm;
            right[n] = std::tanh (k * right[n]) * norm;
        }
    }

    processChorus (left, right, numSamples, p);
    processDelay (left, right, numSamples, p);
    processReverb (left, right, numSamples, p);
    processOutput (left, right, numSamples, p);
}
} // namespace grow
