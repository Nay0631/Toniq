#pragma once

#include <juce_dsp/juce_dsp.h>
#include "Parameters.h"

namespace grow
{
// 全ボイスを足した後ろのエフェクト：ドライブ → コーラス → ディレイ（テンポ同期・左右に跳ねる）→ リバーブ → マスター → リミッター
class FxChain
{
public:
    void prepare (double sampleRate, int maxBlockSize);
    void reset();
    void process (juce::AudioBuffer<float>& buffer, const GrowParams& p);

private:
    void processDrive (juce::AudioBuffer<float>& buffer, float drive);
    void processDelay (juce::AudioBuffer<float>& buffer, const GrowParams& p);

    double sampleRate = 44100.0;
    static constexpr double maxDelaySeconds = 4.0;

    juce::dsp::Chorus<float> chorus;
    juce::dsp::DelayLine<float, juce::dsp::DelayLineInterpolationTypes::Linear> delay;
    juce::SmoothedValue<float> delaySamples;
    juce::dsp::Reverb reverb;
    juce::SmoothedValue<float> masterGain;
    juce::dsp::Limiter<float> limiter;
};
} // namespace grow
