#include "PluginProcessor.h"
#include "GrowPresets.h"
#include "PluginEditor.h"
#include "Text.h"

namespace grow
{
namespace
{
constexpr double defaultBpm = 120.0;  // ホストからテンポが来ないとき（Standalone）のテンポ同期の BPM
const juce::Identifier programProperty { "program" };

juce::String formatted (int index, float value)
{
    char text[128];
    formatParam (index, value, text, (int) sizeof (text));
    return juce::String::fromUTF8 (text);
}

// コアのパラメーターの表から、JUCE のパラメーターを作る
juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    for (int i = 0; i < numParams; ++i)
    {
        const auto& info = paramInfo (i);
        const juce::ParameterID id { info.id, 1 };
        const auto name = jp (info.name);

        switch (info.kind)
        {
            case ParamKind::continuous:
            {
                juce::NormalisableRange<float> range (info.min, info.max);
                if (info.skewCentre > info.min && info.skewCentre < info.max)
                    range.setSkewForCentre (info.skewCentre);
                layout.add (std::make_unique<juce::AudioParameterFloat> (
                    id, name, range, info.defaultValue,
                    juce::AudioParameterFloatAttributes().withStringFromValueFunction (
                        [i] (float v, int) { return formatted (i, v); })));
                break;
            }
            case ParamKind::integer:
                layout.add (std::make_unique<juce::AudioParameterInt> (
                    id, name, (int) info.min, (int) info.max, (int) info.defaultValue,
                    juce::AudioParameterIntAttributes().withStringFromValueFunction (
                        [i] (int v, int) { return formatted (i, (float) v); })));
                break;
            case ParamKind::choice:
            {
                juce::StringArray choices;
                for (int c = 0; c < info.numChoices; ++c) choices.add (jp (info.choices[c]));
                layout.add (std::make_unique<juce::AudioParameterChoice> (id, name, choices, (int) info.defaultValue));
                break;
            }
            case ParamKind::toggle:
                layout.add (std::make_unique<juce::AudioParameterBool> (id, name, info.defaultValue > 0.5f));
                break;
        }
    }
    return layout;
}
} // namespace

GrowProcessor::GrowProcessor()
    : juce::AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      state (*this, nullptr, "grow", createParameterLayout())
{
    for (int i = 0; i < numParams; ++i)
    {
        rawValues[i] = state.getRawParameterValue (paramInfo (i).id);
        jassert (rawValues[i] != nullptr);
    }
}

void GrowProcessor::prepareToPlay (double sampleRate, int)
{
    engine.prepare (sampleRate);
    keyboardState.reset();
}

bool GrowProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void GrowProcessor::handleMidi (const juce::MidiMessage& message)
{
    if (message.isNoteOn())
        engine.noteOn (message.getNoteNumber(), message.getFloatVelocity());
    else if (message.isNoteOff())
        engine.noteOff (message.getNoteNumber());
    else if (message.isSustainPedalOn())
        engine.setSustainPedal (true);
    else if (message.isSustainPedalOff())
        engine.setSustainPedal (false);
    else if (message.isPitchWheel())
        engine.setPitchBend (2.0f * (float) (message.getPitchWheelValue() - 8192) / 8192.0f);  // ±2 半音
    else if (message.isAllNotesOff() || message.isAllSoundOff())
        engine.allNotesOff();
}

void GrowProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const auto numSamples = buffer.getNumSamples();

    // 画面の鍵盤で弾いた音も MIDI に混ぜる
    keyboardState.processNextMidiBuffer (midi, 0, numSamples, true);

    auto bpm = defaultBpm;
    if (auto* playHead = getPlayHead())
        if (auto position = playHead->getPosition())
            if (auto hostBpm = position->getBpm())
                bpm = *hostBpm;

    engine.setBpm (bpm);
    for (int i = 0; i < numParams; ++i)
        if (rawValues[i] != nullptr) engine.setParam (i, rawValues[i]->load());

    auto* left  = buffer.getWritePointer (0);
    auto* right = buffer.getWritePointer (1);

    // MIDI イベントの位置で区切って描く
    auto position = 0;
    for (const auto metadata : midi)
    {
        const auto at = juce::jlimit (0, numSamples, metadata.samplePosition);
        if (at > position)
        {
            engine.render (left + position, right + position, at - position);
            position = at;
        }
        handleMidi (metadata.getMessage());
    }
    if (position < numSamples)
        engine.render (left + position, right + position, numSamples - position);
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

    float values[numParams];
    presetValues (index, values);
    for (int i = 0; i < numParams; ++i)
        if (auto* param = state.getParameter (paramInfo (i).id))
            param->setValueNotifyingHost (param->convertTo0to1 (values[i]));

    updateHostDisplay (ChangeDetails().withProgramChanged (true));
}

const juce::String GrowProcessor::getProgramName (int index)
{
    return jp (presetName (index));
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
