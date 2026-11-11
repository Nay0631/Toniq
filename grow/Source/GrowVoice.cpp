#include "GrowVoice.h"
#include "Oscillator.h"

namespace grow
{
namespace
{
constexpr float voiceGain   = 0.3f;  // 8音重ねても割れにくいよう、1音の大きさを抑える（最後にリミッター）
constexpr int   filterEvery = 4;     // フィルターのカットオフを計算し直す間隔（サンプル）

// レゾナンス 0〜1 → Q 0.5〜12
float resonanceToQ (float resonance)
{
    return 0.5f * std::pow (24.0f, juce::jlimit (0.0f, 1.0f, resonance));
}
} // namespace

GrowVoice::GrowVoice (VoiceShared& s) : shared (s) {}

void GrowVoice::prepare (double newSampleRate, int maxBlockSize)
{
    sampleRate = newSampleRate;
    ampEnv.setSampleRate (sampleRate);
    filterEnv.setSampleRate (sampleRate);

    const juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32) juce::jmax (1, maxBlockSize), 2 };
    filter1.prepare (spec);
    filter2.prepare (spec);
}

bool GrowVoice::canPlaySound (juce::SynthesiserSound* sound)
{
    return dynamic_cast<GrowSound*> (sound) != nullptr;
}

void GrowVoice::startNote (int midiNote, float velocity, juce::SynthesiserSound*, int pitchWheel)
{
    const auto& p = *shared.params;
    pitchWheelMoved (pitchWheel);

    targetNote = midiNote;
    // グライド：前に弾いた音から滑らせる（ポリでも直前の音から）
    currentNote = (p.glideTime > 0.0f && shared.lastNote >= 0.0f) ? shared.lastNote : (float) midiNote;
    shared.lastNote = (float) midiNote;

    // 新しく鳴らすので、フィルター・位相は頭から（ユニゾンは位相をばらばらにして打ち消し合いを防ぐ）
    filter1.reset();
    filter2.reset();
    filterCounter = 0;
    for (int o = 0; o < 2; ++o)
        for (int i = 0; i < maxUnison; ++i)
            phases[o][i] = p.osc[o].unison > 1 ? random.nextFloat() : 0.0f;
    subPhase = 0.0f;
    if (! p.lfoRetrigger) lfoPhase = random.nextFloat();  // 同時に弾いた音どうしの揺れがそろいすぎないように

    ampEnv.reset();
    filterEnv.reset();
    trigger (velocity);
}

void GrowVoice::changeNote (int midiNote, float velocity, bool retrigger)
{
    const auto& p = *shared.params;
    targetNote = midiNote;
    shared.lastNote = (float) midiNote;
    if (p.glideTime <= 0.0f) currentNote = (float) midiNote;

    if (retrigger || released)
        trigger (velocity);  // ADSR は今の大きさから立ち上がり直す
}

void GrowVoice::trigger (float velocity)
{
    const auto& p = *shared.params;
    if (velocity >= 0.0f)
        velocityGain = 1.0f - p.velocitySens * (1.0f - velocity);
    released = false;
    pitchEnvLevel = 1.0f;
    if (p.lfoRetrigger)
    {
        lfoPhase = 0.0f;
        lfoHold  = random.nextFloat() * 2.0f - 1.0f;
    }
    ampEnv.setParameters (p.ampEnv);
    filterEnv.setParameters (p.filterEnv);
    ampEnv.noteOn();
    filterEnv.noteOn();
}

void GrowVoice::stopNote (float, bool allowTailOff)
{
    if (allowTailOff)
    {
        released = true;
        ampEnv.noteOff();
        filterEnv.noteOff();
        return;
    }
    ampEnv.reset();
    filterEnv.reset();
    released = false;
    clearCurrentNote();
}

void GrowVoice::pitchWheelMoved (int value)
{
    bendSemis = 2.0f * (float) (value - 8192) / 8192.0f;  // ±2 半音
}

float GrowVoice::lfoValue (LfoWave wave) const noexcept
{
    switch (wave)
    {
        case LfoWave::sine:     return std::sin (juce::MathConstants<float>::twoPi * lfoPhase);
        case LfoWave::triangle: return 1.0f - 4.0f * std::abs (lfoPhase - 0.5f);
        case LfoWave::saw:      return 2.0f * lfoPhase - 1.0f;
        case LfoWave::square:   return lfoPhase < 0.5f ? 1.0f : -1.0f;
        case LfoWave::random:   return lfoHold;
    }
    return 0.0f;
}

void GrowVoice::updateBlockSettings (const GrowParams& p)
{
    ampEnv.setParameters (p.ampEnv);
    filterEnv.setParameters (p.filterEnv);

    // ユニゾン：重ねた中の位置 pos（-1〜1）で高さのずれと左右の位置を決める（OSC 2 は左右を逆に振る）
    for (int o = 0; o < 2; ++o)
    {
        const auto& osc = p.osc[o];
        const auto count = osc.unison;
        const auto gain  = osc.level / std::sqrt ((float) count);
        for (int i = 0; i < count; ++i)
        {
            const auto pos = count == 1 ? 0.0f : 2.0f * (float) i / (float) (count - 1) - 1.0f;
            unisonRatio[o][i] = std::exp2 (pos * osc.detuneCents / 1200.0f);
            const auto pan   = juce::jlimit (-1.0f, 1.0f, pos * osc.width * (o == 0 ? 1.0f : -1.0f));
            const auto angle = (pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f;
            // 等パワーで振る。真ん中で 1 になるよう √2 倍
            unisonLeft[o][i]  = gain * std::cos (angle) * juce::MathConstants<float>::sqrt2;
            unisonRight[o][i] = gain * std::sin (angle) * juce::MathConstants<float>::sqrt2;
        }
    }

    using Type = juce::dsp::StateVariableTPTFilterType;
    const auto q = resonanceToQ (p.resonance);
    switch (p.filterType)
    {
        case FilterType::lowpass12:
            filter1.setType (Type::lowpass);
            filter1.setResonance (q);
            break;
        case FilterType::lowpass24:
            filter1.setType (Type::lowpass);
            filter2.setType (Type::lowpass);
            filter1.setResonance (0.54f);  // 1段目は控えめにして、山は2段目で作る
            filter2.setResonance (q);
            break;
        case FilterType::highpass:
            filter1.setType (Type::highpass);
            filter1.setResonance (q);
            break;
        case FilterType::bandpass:
            filter1.setType (Type::bandpass);
            filter1.setResonance (q);
            break;
    }
}

void GrowVoice::renderNextBlock (juce::AudioBuffer<float>& output, int startSample, int numSamples)
{
    if (! isVoiceActive()) return;

    const auto& p  = *shared.params;
    const auto sr  = (float) sampleRate;
    updateBlockSettings (p);

    // グライド：目標の高さへ指数的に近づける（glideTime でほぼ届く）
    const auto glideCoeff    = p.glideTime > 0.0f ? std::exp (-3.0f / (p.glideTime * sr)) : 0.0f;
    const auto pitchEnvCoeff = std::exp (-3.0f / (juce::jmax (0.001f, p.pitchEnvTime) * sr));
    const auto lfoStep       = p.lfoHz / sr;
    const auto cutoffNote    = hzToNote (p.cutoffHz);
    const auto maxCutoff     = juce::jmin (20000.0f, sr * 0.45f);
    const auto lowpass24     = p.filterType == FilterType::lowpass24;
    const auto nyquistStep   = 0.5f;
    const auto hasRight      = output.getNumChannels() > 1;

    auto* left  = output.getWritePointer (0, startSample);
    auto* right = hasRight ? output.getWritePointer (1, startSample) : nullptr;

    for (int n = 0; n < numSamples; ++n)
    {
        currentNote = (float) targetNote + (currentNote - (float) targetNote) * glideCoeff;

        lfoPhase += lfoStep;
        if (lfoPhase >= 1.0f)
        {
            lfoPhase -= std::floor (lfoPhase);
            lfoHold = random.nextFloat() * 2.0f - 1.0f;
        }
        const auto lfo = lfoValue (p.lfoWave);

        pitchEnvLevel *= pitchEnvCoeff;
        const auto note = currentNote + bendSemis + p.pitchEnvSemis * pitchEnvLevel + lfo * p.lfoPitchSemis;

        const auto ampLevel    = ampEnv.getNextSample();
        const auto filterLevel = filterEnv.getNextSample();

        auto l = 0.0f, r = 0.0f;
        for (int o = 0; o < 2; ++o)
        {
            const auto& osc = p.osc[o];
            if (osc.level <= 0.0f) continue;
            const auto baseHz = noteToHz (note + (float) (osc.octave * 12 + osc.semitone) + osc.fineCents / 100.0f);
            for (int i = 0; i < osc.unison; ++i)
            {
                const auto dt = juce::jmin (nyquistStep, baseHz * unisonRatio[o][i] / sr);
                const auto s  = oscillatorSample (osc.wave, phases[o][i], dt);
                advancePhase (phases[o][i], dt);
                l += s * unisonLeft[o][i];
                r += s * unisonRight[o][i];
            }
        }

        if (p.subLevel > 0.0f)
        {
            const auto s = std::sin (juce::MathConstants<float>::twoPi * subPhase) * p.subLevel;
            advancePhase (subPhase, juce::jmin (nyquistStep, noteToHz (note - 12.0f) / sr));
            l += s;
            r += s;
        }

        if (p.noiseLevel > 0.0f)
        {
            l += (random.nextFloat() * 2.0f - 1.0f) * p.noiseLevel;
            r += (random.nextFloat() * 2.0f - 1.0f) * p.noiseLevel;
        }

        if (filterCounter-- <= 0)
        {
            filterCounter = filterEvery - 1;
            const auto cutoff = cutoffNote + filterLevel * p.filterEnvSemis + lfo * p.lfoFilterSemis
                                + (currentNote - 60.0f) * p.keyTrack;
            const auto hz = juce::jlimit (20.0f, maxCutoff, noteToHz (cutoff));
            filter1.setCutoffFrequency (hz);
            if (lowpass24) filter2.setCutoffFrequency (hz);
        }
        l = filter1.processSample (0, l);
        r = filter1.processSample (1, r);
        if (lowpass24)
        {
            l = filter2.processSample (0, l);
            r = filter2.processSample (1, r);
        }

        const auto tremolo = 1.0f - p.lfoAmp * (0.5f - 0.5f * lfo);
        const auto gain    = ampLevel * velocityGain * tremolo * voiceGain;
        left[n] += l * gain;
        if (right != nullptr) right[n] += r * gain;

        if (! ampEnv.isActive())
        {
            // 余韻が消えたら終わり
            released = false;
            clearCurrentNote();
            break;
        }
    }
}
} // namespace grow
