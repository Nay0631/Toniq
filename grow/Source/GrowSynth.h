#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include "GrowVoice.h"

namespace grow
{
// ボイスの割り当て。ポリは juce::Synthesiser のまま、モノ・レガートは最初のボイスだけで鳴らす。
//   モノ    ：鍵盤を押すたびに EG を掛け直す（グライドがあれば前の音から滑る）
//   レガート：前の鍵盤を押したまま次を押したときは EG を掛け直さず、高さだけ変える
// どちらも、押している鍵盤を離すと、まだ押している鍵盤のうち最後に押した音へ戻る
class GrowSynth : public juce::Synthesiser
{
public:
    void setVoiceMode (VoiceMode mode);

    void noteOn (int midiChannel, int midiNote, float velocity) override;
    void noteOff (int midiChannel, int midiNote, float velocity, bool allowTailOff) override;
    void allNotesOff (int midiChannel, bool allowTailOff) override;
    void handleSustainPedal (int midiChannel, bool isDown) override;

private:
    GrowVoice* monoVoice() const;

    VoiceMode voiceMode = VoiceMode::poly;
    juce::Array<int> heldNotes;  // 押している鍵盤（押した順）
};
} // namespace grow
