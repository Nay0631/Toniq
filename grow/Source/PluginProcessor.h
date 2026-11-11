#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "FxChain.h"
#include "GrowSynth.h"
#include "Parameters.h"

namespace grow
{
// grow の本体（Standalone・VST3 で共通）。MIDI を受けてボイスを鳴らし、エフェクトを通して左右の出力に書く
class GrowProcessor : public juce::AudioProcessor
{
public:
    GrowProcessor();

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using juce::AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "grow"; }
    bool acceptsMidi() const override  { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 4.0; }

    int getNumPrograms() override;
    int getCurrentProgram() override { return currentProgram; }
    void setCurrentProgram (int index) override;
    const juce::String getProgramName (int index) override;
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState state;
    juce::MidiKeyboardState keyboardState;  // 画面の鍵盤（Standalone で弾く）

private:
    GrowParams  params;
    VoiceShared shared;
    GrowSynth   synth;
    FxChain     fx;
    int currentProgram = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GrowProcessor)
};
} // namespace grow
