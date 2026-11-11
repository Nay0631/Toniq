#include "GrowFx.h"
#include "GrowDsp.h"

#include <algorithm>
#include <initializer_list>

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
constexpr float dcCutoffHz       = 10.0f;   // DC カットの周波数（聞こえる低音は削らない）

// ソフトクリップ：knee までは素通し、その上は tanh で丸めて 1（0 dB）を超えないようにする。
// 急なピークをリミッターがいきなり押さえる（ガツッと歪む）前に、角を丸めておく
constexpr float clipKnee = 0.6f;  // 約 -4.4 dB
inline float softClip (float x) noexcept
{
    const auto a = std::fabs (x);
    if (a <= clipKnee) return x;
    const auto room = 1.0f - clipKnee;
    return std::copysign (clipKnee + room * std::tanh ((a - clipKnee) / room), x);
}

// ドライブ：この値までは元の音と混ぜて、0 から上げ始めたときに音量・音色が急に変わらないようにする
constexpr float driveFadeIn = 0.1f;
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
    last = flushDenormal (out * (1.0f - damp) + last * damp);
    buffer[(size_t) index] = flushDenormal (input + last * feedback);
    if (++index >= (int) buffer.size()) index = 0;
    return out;
}

float Fx::Allpass::process (float input)
{
    const auto buffered = buffer[(size_t) index];
    buffer[(size_t) index] = flushDenormal (input + buffered * 0.5f);
    if (++index >= (int) buffer.size()) index = 0;
    return buffered - input;
}

void Fx::prepare (double newSampleRate)
{
    sampleRate = newSampleRate;
    const auto scale = sampleRate / 44100.0;
    dcCoeff = 1.0f - twoPi * dcCutoffHz / (float) sampleRate;
    for (auto* s : { &driveSmooth, &chorusMixSmooth, &chorusDepthSmooth, &delayMixSmooth, &delayFeedbackSmooth,
                     &reverbMixSmooth, &reverbSizeSmooth })
        s->prepare (sampleRate, smoothSeconds);

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
    for (int ch = 0; ch < 2; ++ch) dcIn[ch] = dcOut[ch] = 0.0f;
    for (auto* s : { &driveSmooth, &chorusMixSmooth, &chorusDepthSmooth, &delayMixSmooth, &delayFeedbackSmooth,
                     &reverbMixSmooth, &reverbSizeSmooth })
        s->snapNext();
}

void Fx::processDrive (float* left, float* right, int numSamples, const GrowParams& p)
{
    // tanh で丸く歪ませる。tanh (k) で割って、強くしても一番大きい所の音量はそろえる
    for (int n = 0; n < numSamples; ++n)
    {
        const auto drive = driveSmooth.next (std::clamp (p.drive, 0.0f, 1.0f));
        if (drive <= 0.0f) continue;
        const auto k    = 1.0f + drive * 9.0f;
        const auto norm = 1.0f / std::tanh (k);
        const auto wet  = std::min (1.0f, drive / driveFadeIn);
        const auto l = left[n], r = right[n];
        left[n]  = l + (std::tanh (k * l) * norm - l) * wet;
        right[n] = r + (std::tanh (k * r) * norm - r) * wet;
    }
}

void Fx::processChorus (float* left, float* right, int numSamples, const GrowParams& p)
{
    // 左右で揺れを 90° ずらした2本の揺れるディレイ。量で元の音と混ぜる
    const auto sr     = (float) sampleRate;
    const auto step   = p.chorusRate / sr;
    const auto centre = 0.008f * sr;
    const auto depthTarget = std::clamp (p.chorusDepth, 0.0f, 1.0f);
    const auto mixTarget   = std::clamp (p.chorusMix, 0.0f, 1.0f);

    for (int n = 0; n < numSamples; ++n)
    {
        const auto depth = 0.007f * sr * chorusDepthSmooth.next (depthTarget);
        const auto mix   = chorusMixSmooth.next (mixTarget);
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
    const auto feedbackTarget = std::clamp (p.delayFeedback, 0.0f, 0.95f);
    const auto mixTarget      = std::clamp (p.delayMix, 0.0f, 1.0f);

    for (int n = 0; n < numSamples; ++n)
    {
        const auto feedback = delayFeedbackSmooth.next (feedbackTarget);
        const auto mix      = delayMixSmooth.next (mixTarget);
        delaySamples += (target - delaySamples) * smooth;
        const auto dl  = delayLine[0].read (delaySamples);
        const auto dr  = delayLine[1].read (delaySamples);
        const auto inL = left[n], inR = right[n];

        if (p.delayPingPong)
        {
            // 入力は左から入れ、くり返すたびに左右を入れ替える
            delayLine[0].push (flushDenormal (0.5f * (inL + inR) + dr * feedback));
            delayLine[1].push (flushDenormal (dl * feedback));
        }
        else
        {
            delayLine[0].push (flushDenormal (inL + dl * feedback));
            delayLine[1].push (flushDenormal (inR + dr * feedback));
        }
        left[n]  = inL + dl * mix;
        right[n] = inR + dr * mix;
    }
}

void Fx::processReverb (float* left, float* right, int numSamples, const GrowParams& p)
{
    // Freeverb（JUCE の Reverb と同じ作り）。量が 0 でも響きの残りは鳴らし切る
    const auto damp       = 0.5f * 0.4f;
    const auto wet2       = 0.0f;
    const auto gain       = 0.015f;
    const auto sizeTarget = std::clamp (p.reverbSize, 0.0f, 1.0f);
    const auto mixTarget  = std::clamp (p.reverbMix, 0.0f, 1.0f);

    for (int n = 0; n < numSamples; ++n)
    {
        const auto feedback = reverbSizeSmooth.next (sizeTarget) * 0.28f + 0.7f;
        const auto mix      = reverbMixSmooth.next (mixTarget);
        const auto wet1     = 0.5f * mix * 3.0f * 2.0f;  // 左右の広がり 1（いっぱい）
        const auto dry      = 1.0f - 0.4f * mix;
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
        float s[2] = { left[n] * masterGain, right[n] * masterGain };

        for (int ch = 0; ch < 2; ++ch)
        {
            // DC カット：直流（波形の片寄り）を取り除く。そのままだとソフトクリップ・リミッターが片側だけ早く効く
            const auto y = s[ch] - dcIn[ch] + dcCoeff * dcOut[ch];
            dcIn[ch]  = s[ch];
            dcOut[ch] = flushDenormal (y);
            s[ch] = softClip (y);
        }

        // リミッター：-1 dB を超えたらすぐ下げ、ゆっくり戻す
        const auto peak = std::max (std::fabs (s[0]), std::fabs (s[1]));
        const auto want = peak > limiterThreshold ? limiterThreshold / peak : 1.0f;
        limiterGain = want < limiterGain ? want : limiterGain + (want - limiterGain) * release;
        // 最後の clamp は念のため（NaN などで飛んだときに耳・スピーカーを守る）
        left[n]  = std::clamp (s[0] * limiterGain, -1.0f, 1.0f);
        right[n] = std::clamp (s[1] * limiterGain, -1.0f, 1.0f);
    }
}

void Fx::process (float* left, float* right, int numSamples, const GrowParams& p)
{
    processDrive (left, right, numSamples, p);
    processChorus (left, right, numSamples, p);
    processDelay (left, right, numSamples, p);
    processReverb (left, right, numSamples, p);
    processOutput (left, right, numSamples, p);
}
} // namespace grow
