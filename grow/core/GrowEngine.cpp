#include "GrowEngine.h"
#include "GrowPresets.h"

#include <algorithm>
#include <cstring>

namespace grow
{
Engine::Engine()
{
    defaultValues (values);
    params = makeParams (values, bpm);
    shared.params = &params;
    for (int i = 0; i < numVoices; ++i)
        voices[i].setup (shared, 0x1234567u + (std::uint32_t) i * 7919u);
}

void Engine::prepare (double newSampleRate)
{
    sampleRate = newSampleRate;
    for (auto& v : voices) v.prepare (sampleRate);
    fx.prepare (sampleRate);
    numHeld = 0;
    sustainPedal = false;
}

void Engine::setParam (int index, float value)
{
    if (index < 0 || index >= numParams) return;
    const auto v = clampParam (index, value);
    if (v == values[index]) return;
    values[index] = v;
    dirty = true;
}

float Engine::getParam (int index) const
{
    return index >= 0 && index < numParams ? values[index] : 0.0f;
}

void Engine::loadPreset (int index)
{
    float preset[numParams];
    presetValues (index, preset);
    for (int i = 0; i < numParams; ++i) setParam (i, preset[i]);
}

void Engine::setBpm (double newBpm)
{
    if (newBpm <= 0.0 || newBpm == bpm) return;
    bpm = newBpm;
    dirty = true;
}

void Engine::updateParams()
{
    if (! dirty) return;
    dirty = false;
    params = makeParams (values, bpm);
    if (params.voiceMode != voiceMode)
    {
        // 切り替えの途中で音が残らないように、すべての音を短くフェードアウトして止める（いきなり切るとクリックになる）
        for (auto& v : voices) v.fadeOut();
        numHeld = 0;
        sustainPedal = false;
        voiceMode = params.voiceMode;
    }
}

Voice* Engine::findVoiceForNewNote()
{
    Voice* fadingOut = nullptr;
    Voice* oldestReleased = nullptr;
    Voice* oldest = nullptr;
    for (auto& v : voices)
    {
        if (! v.isActive()) return &v;
        if (v.isFading() && ! v.hasPendingNote()) fadingOut = &v;
        if (v.isReleased() && (oldestReleased == nullptr || v.age < oldestReleased->age)) oldestReleased = &v;
        if (oldest == nullptr || v.age < oldest->age) oldest = &v;
    }
    // 空きがなければ、消えていく途中の音 → 余韻だけの音 → いちばん古い音の順に差し替える
    // （差し替える音は Voice::steal で短くフェードアウトしてから鳴らす）
    if (fadingOut != nullptr) return fadingOut;
    return oldestReleased != nullptr ? oldestReleased : oldest;
}

void Engine::noteOn (int midiNote, float velocity)
{
    if (midiNote < 0 || midiNote > 127) return;
    updateParams();

    if (voiceMode == VoiceMode::poly)
    {
        // 同じ鍵盤がまだ鳴っていれば、余韻にして新しい音を重ねる
        for (auto& v : voices)
            if (v.isActive() && ! v.isReleased() && v.getNote() == midiNote) v.stopNote (true);

        if (auto* v = findVoiceForNewNote())
        {
            v->steal (midiNote, velocity);  // 空いていればすぐ鳴らす
            v->age = ++noteCounter;
        }
        return;
    }

    // モノ・レガート
    auto* end = heldNotes + numHeld;
    numHeld = (int) (std::remove (heldNotes, end, midiNote) - heldNotes);
    if (numHeld < 128) heldNotes[numHeld++] = midiNote;

    auto& v = monoVoice();
    if (v.isActive())
    {
        // 鳴っている（余韻を含む）ボイスの高さを変える。レガートは前の鍵盤を押したままならつなぐ
        const auto overlapping = numHeld > 1 && ! v.isReleased();
        v.changeNote (midiNote, velocity, voiceMode == VoiceMode::mono || ! overlapping);
    }
    else
    {
        v.startNote (midiNote, velocity);
    }
    v.age = ++noteCounter;
}

void Engine::noteOff (int midiNote)
{
    updateParams();

    if (voiceMode == VoiceMode::poly)
    {
        for (auto& v : voices)
        {
            if (! v.isActive() || v.isReleased() || v.sustained || v.getNote() != midiNote) continue;
            if (sustainPedal) v.sustained = true;
            else              v.stopNote (true);
        }
        return;
    }

    auto* end = heldNotes + numHeld;
    numHeld = (int) (std::remove (heldNotes, end, midiNote) - heldNotes);

    auto& v = monoVoice();
    if (! v.isActive() || v.isReleased() || v.getNote() != midiNote) return;  // 今鳴っていない鍵盤を離しただけ

    if (numHeld > 0)
        v.changeNote (heldNotes[numHeld - 1], -1.0f, false);  // まだ押している鍵盤へ戻る
    else
        v.stopNote (true);
}

void Engine::setSustainPedal (bool down)
{
    // モノ・レガートでは押している鍵盤の順を自前で持つので、サスティンペダルは使わない
    sustainPedal = down && voiceMode == VoiceMode::poly;
    if (sustainPedal) return;
    for (auto& v : voices)
        if (v.sustained) v.stopNote (true);
}

void Engine::setPitchBend (float semitones)
{
    shared.bendSemis = semitones;
}

void Engine::allNotesOff()
{
    for (auto& v : voices) v.stopNote (false);
    numHeld = 0;
    sustainPedal = false;
}

void Engine::render (float* left, float* right, int numSamples)
{
    updateParams();
    std::memset (left, 0, sizeof (float) * (size_t) numSamples);
    std::memset (right, 0, sizeof (float) * (size_t) numSamples);
    for (auto& v : voices) v.render (left, right, numSamples);
    fx.process (left, right, numSamples, params);
}
} // namespace grow
