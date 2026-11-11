#include "GrowSynth.h"

namespace grow
{
void GrowSynth::setVoiceMode (VoiceMode mode)
{
    if (mode == voiceMode) return;
    allNotesOff (0, false);  // 切り替えの途中で音が残らないように止める
    voiceMode = mode;
}

GrowVoice* GrowSynth::monoVoice() const
{
    return dynamic_cast<GrowVoice*> (getVoice (0));
}

void GrowSynth::noteOn (int midiChannel, int midiNote, float velocity)
{
    if (voiceMode == VoiceMode::poly)
    {
        juce::Synthesiser::noteOn (midiChannel, midiNote, velocity);
        return;
    }

    const juce::ScopedLock sl (lock);
    heldNotes.removeFirstMatchingValue (midiNote);
    heldNotes.add (midiNote);

    auto* voice = monoVoice();
    if (voice == nullptr || getNumSounds() == 0) return;

    if (voice->isVoiceActive())
    {
        // 鳴っている（余韻を含む）ボイスの高さを変える。レガートは前の鍵盤を押したままならつなぐ
        const auto overlapping = heldNotes.size() > 1 && ! voice->isReleased();
        voice->changeNote (midiNote, velocity, voiceMode == VoiceMode::mono || ! overlapping);
        return;
    }
    startVoice (voice, getSound (0).get(), midiChannel, midiNote, velocity);
}

void GrowSynth::noteOff (int midiChannel, int midiNote, float velocity, bool allowTailOff)
{
    if (voiceMode == VoiceMode::poly)
    {
        juce::Synthesiser::noteOff (midiChannel, midiNote, velocity, allowTailOff);
        return;
    }

    const juce::ScopedLock sl (lock);
    heldNotes.removeFirstMatchingValue (midiNote);

    auto* voice = monoVoice();
    if (voice == nullptr || ! voice->isVoiceActive() || voice->isReleased()) return;
    if (voice->getTargetNote() != midiNote) return;  // 今鳴っていない鍵盤を離しただけ

    if (! heldNotes.isEmpty())
        voice->changeNote (heldNotes.getLast(), -1.0f, false);  // まだ押している鍵盤へ戻る
    else
        stopVoice (voice, velocity, allowTailOff);
}

void GrowSynth::allNotesOff (int midiChannel, bool allowTailOff)
{
    const juce::ScopedLock sl (lock);
    heldNotes.clear();
    juce::Synthesiser::allNotesOff (midiChannel, allowTailOff);
}

void GrowSynth::handleSustainPedal (int midiChannel, bool isDown)
{
    // モノ・レガートでは押している鍵盤の順を自前で持つので、サスティンペダルは使わない
    if (voiceMode == VoiceMode::poly)
        juce::Synthesiser::handleSustainPedal (midiChannel, isDown);
}
} // namespace grow
