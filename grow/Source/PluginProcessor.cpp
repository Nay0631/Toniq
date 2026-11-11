#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "Presets.h"

namespace grow
{
namespace
{
constexpr double defaultBpm = 120.0;  // ホストからテンポが来ないとき（Standalone）のテンポ同期の BPM
const juce::Identifier programProperty { "program" };
} // namespace

GrowProcessor::GrowProcessor()
    : juce::AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      state (*this, nullptr, "grow", createParameterLayout())
{
    params = readParams (state, defaultBpm);
    shared.params = &params;

    for (int i = 0; i < numVoices; ++i)
        synth.addVoice (new GrowVoice (shared));
    synth.addSound (new GrowSound());
}

void GrowProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    synth.setCurrentPlaybackSampleRate (sampleRate);
    for (int i = 0; i < synth.getNumVoices(); ++i)
        if (auto* voice = dynamic_cast<GrowVoice*> (synth.getVoice (i)))
            voice->prepare (sampleRate, samplesPerBlock);
    fx.prepare (sampleRate, samplesPerBlock);
    keyboardState.reset();
}

bool GrowProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void GrowProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    // 画面の鍵盤で弾いた音も MIDI に混ぜる
    keyboardState.processNextMidiBuffer (midi, 0, buffer.getNumSamples(), true);

    auto bpm = defaultBpm;
    if (auto* playHead = getPlayHead())
        if (auto position = playHead->getPosition())
            if (auto hostBpm = position->getBpm())
                bpm = *hostBpm;

    params = readParams (state, bpm);
    synth.setVoiceMode (params.voiceMode);
    synth.renderNextBlock (buffer, midi, 0, buffer.getNumSamples());
    fx.process (buffer, params);
}

juce::AudioProcessorEditor* GrowProcessor::createEditor()
{
    return new GrowEditor (*this);
}

int GrowProcessor::getNumPrograms()
{
    return numPresets();
}

void GrowProcessor::setCurrentProgram (int index)
{
    if (! juce::isPositiveAndBelow (index, numPresets())) return;
    currentProgram = index;
    applyPreset (state, index);
    updateHostDisplay (ChangeDetails().withProgramChanged (true));
}

const juce::String GrowProcessor::getProgramName (int index)
{
    return presetName (index);
}

void GrowProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto tree = state.copyState();
    tree.setProperty (programProperty, currentProgram, nullptr);
    if (auto xml = tree.createXml())
        copyXmlToBinary (*xml, destData);
}

void GrowProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr || ! xml->hasTagName (state.state.getType())) return;

    auto tree = juce::ValueTree::fromXml (*xml);
    currentProgram = juce::jlimit (0, numPresets() - 1, (int) tree.getProperty (programProperty, 0));
    state.replaceState (tree);
}
} // namespace grow

// プラグインの入口（JUCE が呼ぶ）
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new grow::GrowProcessor();
}
