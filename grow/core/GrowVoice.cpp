#include "GrowVoice.h"

#include <algorithm>

namespace grow
{
namespace
{
constexpr float voiceGain   = 0.3f;  // 8音重ねても割れにくいよう、1音の大きさを抑える（最後にリミッター）
constexpr int   filterEvery = 4;     // フィルターのカットオフを計算し直す間隔（サンプル）
constexpr float sqrt2       = 1.41421356f;

// レゾナンス 0〜1 → Q 0.5〜12
float resonanceToQ (float resonance)
{
    return 0.5f * std::pow (24.0f, std::clamp (resonance, 0.0f, 1.0f));
}
} // namespace

void Voice::setup (VoiceShared& s, std::uint32_t seed)
{
    shared = &s;
    random = Random (seed);
}

void Voice::prepare (double newSampleRate)
{
    sampleRate = newSampleRate;
    ampEnv.setSampleRate (sampleRate);
    filterEnv.setSampleRate (sampleRate);
    filter1.setSampleRate (sampleRate);
    filter2.setSampleRate (sampleRate);
    stopNote (false);
}

void Voice::startNote (int midiNote, float velocity)
{
    const auto& p = *shared->params;

    targetNote = midiNote;
    // グライド：前に弾いた音から滑らせる（ポリでも直前の音から）
    currentNote = (p.glideTime > 0.0f && shared->lastNote >= 0.0f) ? shared->lastNote : (float) midiNote;
    shared->lastNote = (float) midiNote;

    // 新しく鳴らすので、フィルター・位相は頭から（ユニゾンは位相をばらばらにして打ち消し合いを防ぐ）
    filter1.reset();
    filter2.reset();
    filterCounter = 0;
    for (int o = 0; o < 2; ++o)
        for (int i = 0; i < maxUnison; ++i)
            phases[o][i] = p.osc[o].unison > 1 ? random.next() : 0.0f;
    subPhase = 0.0f;
    if (! p.lfoRetrigger) lfoPhase = random.next();  // 同時に弾いた音どうしの揺れがそろいすぎないように

    active    = true;
    sustained = false;
    ampEnv.reset();
    filterEnv.reset();
    trigger (velocity);
}

void Voice::changeNote (int midiNote, float velocity, bool retrigger)
{
    const auto& p = *shared->params;
    targetNote = midiNote;
    shared->lastNote = (float) midiNote;
    if (p.glideTime <= 0.0f) currentNote = (float) midiNote;
    sustained = false;

    if (retrigger || released)
        trigger (velocity);  // ADSR は今の大きさから立ち上がり直す
}

void Voice::trigger (float velocity)
{
    const auto& p = *shared->params;
    if (velocity >= 0.0f)
        velocityGain = 1.0f - p.velocitySens * (1.0f - std::clamp (velocity, 0.0f, 1.0f));
    released = false;
    pitchEnvLevel = 1.0f;
    if (p.lfoRetrigger)
    {
        lfoPhase = 0.0f;
        lfoHold  = random.bipolar();
    }
    ampEnv.setParams (p.ampEnv);
    filterEnv.setParams (p.filterEnv);
    ampEnv.noteOn();
    filterEnv.noteOn();
}

void Voice::stopNote (bool allowTailOff)
{
    sustained = false;
    if (allowTailOff && active)
    {
        released = true;
        ampEnv.noteOff();
        filterEnv.noteOff();
        if (! ampEnv.isActive()) active = false;
        return;
    }
    ampEnv.reset();
    filterEnv.reset();
    released = false;
    active   = false;
}

float Voice::lfoValue (LfoWave wave) const noexcept
{
    switch (wave)
    {
        case LfoWave::sine:     return std::sin (twoPi * lfoPhase);
        case LfoWave::triangle: return 1.0f - 4.0f * std::fabs (lfoPhase - 0.5f);
        case LfoWave::saw:      return 2.0f * lfoPhase - 1.0f;
        case LfoWave::square:   return lfoPhase < 0.5f ? 1.0f : -1.0f;
        case LfoWave::random:   return lfoHold;
    }
    return 0.0f;
}

void Voice::updateBlockSettings (const GrowParams& p)
{
    ampEnv.setParams (p.ampEnv);
    filterEnv.setParams (p.filterEnv);

    // ユニゾン：重ねた中の位置 pos（-1〜1）で高さのずれと左右の位置を決める（OSC 2 は左右を逆に振る）
    for (int o = 0; o < 2; ++o)
    {
        const auto& osc  = p.osc[o];
        const auto count = osc.unison;
        const auto gain  = osc.level / std::sqrt ((float) count);
        for (int i = 0; i < count; ++i)
        {
            const auto pos = count == 1 ? 0.0f : 2.0f * (float) i / (float) (count - 1) - 1.0f;
            unisonRatio[o][i] = std::exp2 (pos * osc.detuneCents / 1200.0f);
            const auto pan   = std::clamp (pos * osc.width * (o == 0 ? 1.0f : -1.0f), -1.0f, 1.0f);
            const auto angle = (pan + 1.0f) * pi * 0.25f;
            // 等パワーで振る。真ん中で 1 になるよう √2 倍
            unisonLeft[o][i]  = gain * std::cos (angle) * sqrt2;
            unisonRight[o][i] = gain * std::sin (angle) * sqrt2;
        }
    }

    const auto q = resonanceToQ (p.resonance);
    switch (p.filterType)
    {
        case FilterType::lowpass12:
            filter1.setType (Svf::Type::lowpass);
            filter1.setQ (q);
            break;
        case FilterType::lowpass24:
            filter1.setType (Svf::Type::lowpass);
            filter2.setType (Svf::Type::lowpass);
            filter1.setQ (0.54f);  // 1段目は控えめにして、山は2段目で作る
            filter2.setQ (q);
            break;
        case FilterType::highpass:
            filter1.setType (Svf::Type::highpass);
            filter1.setQ (q);
            break;
        case FilterType::bandpass:
            filter1.setType (Svf::Type::bandpass);
            filter1.setQ (q);
            break;
    }
}

void Voice::render (float* left, float* right, int numSamples)
{
    if (! active) return;

    const auto& p = *shared->params;
    const auto sr = (float) sampleRate;
    updateBlockSettings (p);

    // グライド：目標の高さへ指数的に近づける（glideTime でほぼ届く）
    const auto glideCoeff    = p.glideTime > 0.0f ? std::exp (-3.0f / (p.glideTime * sr)) : 0.0f;
    const auto pitchEnvCoeff = std::exp (-3.0f / (std::max (0.001f, p.pitchEnvTime) * sr));
    const auto lfoStep       = p.lfoHz / sr;
    const auto cutoffNote    = hzToNote (p.cutoffHz);
    const auto maxCutoff     = std::min (20000.0f, sr * 0.45f);
    const auto lowpass24     = p.filterType == FilterType::lowpass24;
    const auto bend          = shared->bendSemis;

    for (int n = 0; n < numSamples; ++n)
    {
        currentNote = (float) targetNote + (currentNote - (float) targetNote) * glideCoeff;

        lfoPhase += lfoStep;
        if (lfoPhase >= 1.0f)
        {
            lfoPhase -= std::floor (lfoPhase);
            lfoHold = random.bipolar();
        }
        const auto lfo = lfoValue (p.lfoWave);

        pitchEnvLevel *= pitchEnvCoeff;
        const auto note = currentNote + bend + p.pitchEnvSemis * pitchEnvLevel + lfo * p.lfoPitchSemis;

        const auto ampLevel    = ampEnv.next();
        const auto filterLevel = filterEnv.next();

        auto l = 0.0f, r = 0.0f;
        for (int o = 0; o < 2; ++o)
        {
            const auto& osc = p.osc[o];
            if (osc.level <= 0.0f) continue;
            const auto baseHz = noteToHz (note + (float) (osc.octave * 12 + osc.semitone) + osc.fineCents / 100.0f);
            for (int i = 0; i < osc.unison; ++i)
            {
                const auto dt = std::min (0.5f, baseHz * unisonRatio[o][i] / sr);
                const auto s  = oscillatorSample (osc.wave, phases[o][i], dt);
                advancePhase (phases[o][i], dt);
                l += s * unisonLeft[o][i];
                r += s * unisonRight[o][i];
            }
        }

        if (p.subLevel > 0.0f)
        {
            const auto s = std::sin (twoPi * subPhase) * p.subLevel;
            advancePhase (subPhase, std::min (0.5f, noteToHz (note - 12.0f) / sr));
            l += s;
            r += s;
        }

        if (p.noiseLevel > 0.0f)
        {
            l += random.bipolar() * p.noiseLevel;
            r += random.bipolar() * p.noiseLevel;
        }

        if (filterCounter-- <= 0)
        {
            filterCounter = filterEvery - 1;
            const auto cutoff = cutoffNote + filterLevel * p.filterEnvSemis + lfo * p.lfoFilterSemis
                                + (currentNote - 60.0f) * p.keyTrack;
            const auto hz = std::clamp (noteToHz (cutoff), 20.0f, maxCutoff);
            filter1.setCutoff (hz);
            if (lowpass24) filter2.setCutoff (hz);
        }
        l = filter1.process (0, l);
        r = filter1.process (1, r);
        if (lowpass24)
        {
            l = filter2.process (0, l);
            r = filter2.process (1, r);
        }

        const auto tremolo = 1.0f - p.lfoAmp * (0.5f - 0.5f * lfo);
        const auto gain    = ampLevel * velocityGain * tremolo * voiceGain;
        left[n]  += l * gain;
        right[n] += r * gain;

        if (! ampEnv.isActive())
        {
            // 余韻が消えたら終わり
            active   = false;
            released = false;
            break;
        }
    }
}
} // namespace grow
