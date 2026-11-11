#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "GrowEngine.h"

namespace grow
{
// JUCE 版 grow の本体（Standalone・VST3 で共通）。
// パラメーターは AudioProcessorValueTreeState（コアの表から作る）に持ち、ブロックごとにコアのエンジンへ渡す。
// MIDI はイベントの位置でブロックを区切ってエンジンに渡す
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
    void handleMidi (const juce::MidiMessage& message);

    Engine engine;
    std::atomic<float>* rawValues[numParams] {};
    int currentProgram = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GrowProcessor)
};
} // namespace grow
