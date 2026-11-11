#include "FxChain.h"

namespace grow
{
void FxChain::prepare (double newSampleRate, int maxBlockSize)
{
    sampleRate = newSampleRate;
    const juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32) juce::jmax (1, maxBlockSize), 2 };

    chorus.prepare (spec);
    chorus.setCentreDelay (8.0f);
    chorus.setFeedback (0.0f);

    delay.setMaximumDelayInSamples ((int) (maxDelaySeconds * sampleRate));
    delay.prepare (spec);
    delaySamples.reset (sampleRate, 0.08);  // 長さを変えたときに「ブツッ」とならないよう滑らかに

    reverb.prepare (spec);

    masterGain.reset (sampleRate, 0.02);
    limiter.prepare (spec);
    limiter.setThreshold (-1.0f);
    limiter.setRelease (100.0f);

    reset();
}

void FxChain::reset()
{
    chorus.reset();
    delay.reset();
    reverb.reset();
    limiter.reset();
}

void FxChain::processDrive (juce::AudioBuffer<float>& buffer, float drive)
{
    if (drive <= 0.001f) return;
    // tanh で丸く歪ませる。tanh (k) で割って、強くしても一番大きい所の音量はそろえる
    const auto k    = 1.0f + drive * 9.0f;
    const auto norm = 1.0f / std::tanh (k);
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
    {
        auto* data = buffer.getWritePointer (ch);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            data[i] = std::tanh (k * data[i]) * norm;
    }
}

void FxChain::processDelay (juce::AudioBuffer<float>& buffer, const GrowParams& p)
{
    if (buffer.getNumChannels() < 2) return;

    const auto maxSamples = (float) (maxDelaySeconds * sampleRate) - 2.0f;
    delaySamples.setTargetValue (juce::jlimit (1.0f, maxSamples, p.delaySeconds * (float) sampleRate));
    const auto feedback = juce::jlimit (0.0f, 0.95f, p.delayFeedback);

    auto* left  = buffer.getWritePointer (0);
    auto* right = buffer.getWritePointer (1);
    for (int i = 0; i < buffer.getNumSamples(); ++i)
    {
        const auto d  = delaySamples.getNextValue();
        const auto dl = delay.popSample (0, d);
        const auto dr = delay.popSample (1, d);
        const auto inL = left[i], inR = right[i];

        if (p.delayPingPong)
        {
            // 入力は左から入れ、くり返すたびに左右を入れ替える
            delay.pushSample (0, 0.5f * (inL + inR) + dr * feedback);
            delay.pushSample (1, dl * feedback);
        }
        else
        {
            delay.pushSample (0, inL + dl * feedback);
            delay.pushSample (1, inR + dr * feedback);
        }
        left[i]  = inL + dl * p.delayMix;
        right[i] = inR + dr * p.delayMix;
    }
}

void FxChain::process (juce::AudioBuffer<float>& buffer, const GrowParams& p)
{
    processDrive (buffer, p.drive);

    juce::dsp::AudioBlock<float> block (buffer);
    juce::dsp::ProcessContextReplacing<float> context (block);

    chorus.setRate (p.chorusRate);
    chorus.setDepth (p.chorusDepth);
    chorus.setMix (p.chorusMix);
    chorus.process (context);

    processDelay (buffer, p);

    juce::dsp::Reverb::Parameters rp;
    rp.roomSize   = p.reverbSize;
    rp.damping    = 0.5f;
    rp.width      = 1.0f;
    rp.wetLevel   = p.reverbMix;
    rp.dryLevel   = 1.0f - 0.4f * p.reverbMix;
    rp.freezeMode = 0.0f;
    reverb.setParameters (rp);
    reverb.process (context);

    masterGain.setTargetValue (juce::Decibels::decibelsToGain (p.masterDb));
    if (masterGain.isSmoothing())
        masterGain.applyGain (buffer, buffer.getNumSamples());
    else
        buffer.applyGain (masterGain.getTargetValue());

    limiter.process (context);
}
} // namespace grow
