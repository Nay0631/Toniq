#include "GrowVoice.h"

#include <algorithm>
#include <initializer_list>

namespace grow
{
namespace
{
constexpr float voiceGain   = 0.3f;    // 8音重ねても割れにくいよう、1音の大きさを抑える（最後にリミッター）
constexpr int   filterEvery = 4;       // フィルターのカットオフを計算し直す間隔（サンプル）
constexpr float sqrt2       = 1.41421356f;
constexpr float fadeSeconds = 0.004f;  // 差し替え・止めるときのフェードアウトの長さ
constexpr float silentGain  = 1.0e-6f; // これより小さいユニゾンの音は描かない

// ユニゾンのデチューンの曲がり（位置 pos の |pos| をこの乗数で曲げる）。
// 内側の音はほとんどずらさず、外側ほど大きくずらす（JP-8000 のスーパーソウの分析に近い並び）
constexpr float detuneCurve = 1.5f;

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
    fadeStep = 1.0f / (fadeSeconds * (float) sampleRate);

    for (auto* s : { &lfoPitchSmooth, &lfoAmpSmooth, &subSmooth, &noiseSmooth })
        s->prepare (sampleRate, smoothSeconds);
    for (auto* s : { &cutoffSmooth, &qSmooth, &envAmountSmooth, &lfoFilterSmooth, &keyTrackSmooth })
        s->prepare (sampleRate, smoothSeconds, filterEvery);

    stopNote (false);
}

void Voice::snapSmoothing()
{
    // 新しく鳴らす音は、今のつまみの値から始める（前の音の途中の値から滑らせない）
    unisonReady = false;
    for (auto* s : { &lfoPitchSmooth, &lfoAmpSmooth, &subSmooth, &noiseSmooth, &cutoffSmooth, &qSmooth,
                     &envAmountSmooth, &lfoFilterSmooth, &keyTrackSmooth })
        s->snapNext();
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
            // 1枚だけなら頭から（発音がそろう）。2枚目以降は鳴らしながらユニゾンを増やしたときのためにもばらばらに
            phases[o][i] = (p.osc[o].unison > 1 || i > 0) ? random.next() : 0.0f;
    subPhase = 0.0f;
    if (! p.lfoRetrigger) lfoPhase = random.next();  // 同時に弾いた音どうしの揺れがそろいすぎないように
    snapSmoothing();

    active    = true;
    sustained = false;
    fading    = false;
    fadeGain  = 1.0f;
    pending   = false;
    pendingStopped = false;
    ampEnv.reset();
    filterEnv.reset();
    trigger (velocity);
}

void Voice::steal (int midiNote, float velocity)
{
    if (! active)
    {
        startNote (midiNote, velocity);
        return;
    }
    // 鳴っている音をいきなり切るとクリックになるので、短くフェードアウトしてから鳴らす
    pending         = true;
    pendingNote     = midiNote;
    pendingVelocity = velocity;
    pendingStopped  = false;
    sustained       = false;
    if (! fading)
    {
        fading   = true;
        fadeGain = 1.0f;
    }
}

void Voice::changeNote (int midiNote, float velocity, bool retrigger)
{
    if (fading)
    {
        // フェードアウト中（差し替え待ち・止める途中）なら、フェードが終わってからこの音を鳴らす
        pending        = true;
        pendingNote    = midiNote;
        pendingStopped = false;
        if (velocity >= 0.0f) pendingVelocity = velocity;
        sustained = false;
        return;
    }

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
        if (pending)
        {
            pendingStopped = true;  // 差し替え待ちの音の鍵盤を離した（鳴らしたらすぐリリースへ）
            return;
        }
        if (fading) return;  // もう消えていく途中
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
    fading   = false;
    pending  = false;
}

void Voice::fadeOut()
{
    if (! active) return;
    pending = false;
    if (! fading)
    {
        fading   = true;
        fadeGain = 1.0f;
    }
}

void Voice::finishFade()
{
    fading = false;
    if (! pending)
    {
        stopNote (false);
        return;
    }
    const auto note = pendingNote;
    const auto velocity = pendingVelocity;
    const auto stopped = pendingStopped;
    const auto wasSustained = sustained;  // 待っている間にサスティンペダルで伸ばしていた
    pending = false;
    startNote (note, velocity);
    if (stopped) stopNote (true);
    else sustained = wasSustained;
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

void Voice::updateBlockSettings (const GrowParams& p, int numSamples)
{
    ampEnv.setParams (p.ampEnv);
    filterEnv.setParams (p.filterEnv);

    // ユニゾンの目標の値。重ねた中の位置 pos（-1〜1）で高さのずれと左右の位置を決める（OSC 2 は左右を逆に振る）
    //   ・デチューンは |pos| を detuneCurve 乗で曲げる（内側は少し、外側は大きく）
    //   ・真ん中の音（偶数枚なら内側の2枚）は真ん中に置いてずらさず残す（モノラルにしても痩せない）
    //   ・外側の音の大きさはデチューンが小さいほど控えめ（0.4 → 1）。全体の大きさ（パワー）は枚数・デチューンによらずそろえる
    for (int o = 0; o < 2; ++o)
    {
        const auto& osc  = p.osc[o];
        const auto count = osc.unison;
        const auto amount     = std::clamp (osc.detuneCents / 100.0f, 0.0f, 1.0f);
        const auto sideWeight = 0.4f + 0.6f * amount;

        auto isCentre = [count] (int i)
        {
            return count % 2 == 1 ? i == count / 2 : (i == count / 2 - 1 || i == count / 2);
        };
        auto sumSquares = 0.0f;
        for (int i = 0; i < count; ++i)
        {
            const auto w = isCentre (i) ? 1.0f : sideWeight;
            sumSquares += w * w;
        }
        const auto norm = osc.level / std::sqrt (sumSquares);

        for (int i = 0; i < count; ++i)
        {
            const auto pos    = count == 1 ? 0.0f : 2.0f * (float) i / (float) (count - 1) - 1.0f;
            const auto curved = std::copysign (std::pow (std::fabs (pos), detuneCurve), pos);
            targetRatio[o][i] = std::exp2 (curved * osc.detuneCents / 1200.0f);
            const auto centre = isCentre (i);
            const auto pan    = centre ? 0.0f : std::clamp (pos * osc.width * (o == 0 ? 1.0f : -1.0f), -1.0f, 1.0f);
            const auto angle  = (pan + 1.0f) * pi * 0.25f;
            const auto gain   = norm * (centre ? 1.0f : sideWeight);
            // 等パワーで振る。真ん中で 1 になるよう √2 倍
            targetLeft[o][i]  = gain * std::cos (angle) * sqrt2;
            targetRight[o][i] = gain * std::sin (angle) * sqrt2;
        }
        // 外した音は音量 0 へ（高さはそのまま）
        for (int i = count; i < maxUnison; ++i)
        {
            targetRatio[o][i] = curRatio[o][i];
            targetLeft[o][i]  = 0.0f;
            targetRight[o][i] = 0.0f;
        }
    }

    // 今の値から目標へ、このブロックで滑らかに進める（ブロックごとの1次ローパスを、ブロックの中では直線でつなぐ）
    const auto alpha = 1.0f - std::exp (-(float) numSamples / (smoothSeconds * (float) sampleRate));
    const auto perSample = 1.0f / (float) numSamples;
    for (int o = 0; o < 2; ++o)
    {
        const auto previousCount = renderCount[o];
        auto count = 0;
        for (int i = 0; i < maxUnison; ++i)
        {
            if (! unisonReady)
            {
                curRatio[o][i] = targetRatio[o][i];
                curLeft[o][i]  = targetLeft[o][i];
                curRight[o][i] = targetRight[o][i];
            }
            else if (i >= previousCount)
            {
                // 新しく足した音は、目標の高さで音量 0 からフェードイン
                curRatio[o][i] = targetRatio[o][i];
                curLeft[o][i]  = 0.0f;
                curRight[o][i] = 0.0f;
            }
            incRatio[o][i] = (targetRatio[o][i] - curRatio[o][i]) * alpha * perSample;
            incLeft[o][i]  = (targetLeft[o][i] - curLeft[o][i]) * alpha * perSample;
            incRight[o][i] = (targetRight[o][i] - curRight[o][i]) * alpha * perSample;

            const auto audible = std::fabs (curLeft[o][i]) + std::fabs (curRight[o][i]) > silentGain
                                 || std::fabs (targetLeft[o][i]) + std::fabs (targetRight[o][i]) > silentGain;
            if (audible) count = i + 1;
        }
        renderCount[o] = count;
    }
    unisonReady = true;

    switch (p.filterType)
    {
        case FilterType::lowpass12:
            filter1.setType (Svf::Type::lowpass);
            break;
        case FilterType::lowpass24:
            filter1.setType (Svf::Type::lowpass);
            filter2.setType (Svf::Type::lowpass);
            break;
        case FilterType::highpass:
            filter1.setType (Svf::Type::highpass);
            break;
        case FilterType::bandpass:
            filter1.setType (Svf::Type::bandpass);
            break;
    }
}

void Voice::render (float* left, float* right, int numSamples)
{
    if (! active || numSamples <= 0) return;

    const auto& p = *shared->params;
    const auto sr = (float) sampleRate;
    updateBlockSettings (p, numSamples);

    // 差し替えの音を鳴らし始めたら、ユニゾンの値を目標にそろえる（このブロックの残りは動かさない）
    auto snapUnisonNow = [this]
    {
        for (int o = 0; o < 2; ++o)
        {
            auto count = 0;
            for (int i = 0; i < maxUnison; ++i)
            {
                curRatio[o][i] = targetRatio[o][i];
                curLeft[o][i]  = targetLeft[o][i];
                curRight[o][i] = targetRight[o][i];
                incRatio[o][i] = incLeft[o][i] = incRight[o][i] = 0.0f;
                if (std::fabs (curLeft[o][i]) + std::fabs (curRight[o][i]) > silentGain) count = i + 1;
            }
            renderCount[o] = count;
        }
        unisonReady = true;
    };

    // グライド：目標の高さへ指数的に近づける（glideTime でほぼ届く）
    const auto glideCoeff    = p.glideTime > 0.0f ? std::exp (-3.0f / (p.glideTime * sr)) : 0.0f;
    const auto pitchEnvCoeff = std::exp (-3.0f / (std::max (0.001f, p.pitchEnvTime) * sr));
    const auto lfoStep       = p.lfoHz / sr;
    const auto cutoffTarget  = hzToNote (p.cutoffHz);
    const auto maxCutoff     = std::min (20000.0f, sr * 0.45f);
    const auto lowpass24     = p.filterType == FilterType::lowpass24;
    const auto bend          = shared->bendSemis;

    auto lastResonance = -1.0f, q = 0.7071f;

    for (int n = 0; n < numSamples; ++n)
    {
        if (fading)
        {
            fadeGain -= fadeStep;
            if (fadeGain <= 0.0f)
            {
                finishFade();
                if (! active) break;
                snapUnisonNow();
                continue;
            }
        }

        auto glideDiff = (currentNote - (float) targetNote) * glideCoeff;
        if (std::fabs (glideDiff) < 1.0e-5f) glideDiff = 0.0f;
        currentNote = (float) targetNote + glideDiff;

        lfoPhase += lfoStep;
        if (lfoPhase >= 1.0f)
        {
            lfoPhase -= std::floor (lfoPhase);
            lfoHold = random.bipolar();
        }
        const auto lfo = lfoValue (p.lfoWave);

        pitchEnvLevel = flushDenormal (pitchEnvLevel * pitchEnvCoeff);
        const auto note = currentNote + bend + p.pitchEnvSemis * pitchEnvLevel + lfo * lfoPitchSmooth.next (p.lfoPitchSemis);

        const auto ampLevel    = ampEnv.next();
        const auto filterLevel = filterEnv.next();

        auto l = 0.0f, r = 0.0f;
        for (int o = 0; o < 2; ++o)
        {
            const auto count = renderCount[o];
            if (count == 0) continue;
            const auto& osc = p.osc[o];
            const auto baseHz = noteToHz (note + (float) (osc.octave * 12 + osc.semitone) + osc.fineCents / 100.0f);
            for (int i = 0; i < count; ++i)
            {
                curRatio[o][i] += incRatio[o][i];
                curLeft[o][i]  += incLeft[o][i];
                curRight[o][i] += incRight[o][i];
                const auto dt = std::min (0.5f, baseHz * curRatio[o][i] / sr);
                const auto s  = oscillatorSample (osc.wave, phases[o][i], dt);
                advancePhase (phases[o][i], dt);
                l += s * curLeft[o][i];
                r += s * curRight[o][i];
            }
        }

        const auto subLevel = subSmooth.next (p.subLevel);
        if (subLevel > 0.0f)
        {
            const auto s = std::sin (twoPi * subPhase) * subLevel;
            advancePhase (subPhase, std::min (0.5f, noteToHz (note - 12.0f) / sr));
            l += s;
            r += s;
        }

        const auto noiseLevel = noiseSmooth.next (p.noiseLevel);
        if (noiseLevel > 0.0f)
        {
            l += random.bipolar() * noiseLevel;
            r += random.bipolar() * noiseLevel;
        }

        if (filterCounter-- <= 0)
        {
            filterCounter = filterEvery - 1;
            const auto cutoff = cutoffSmooth.next (cutoffTarget)
                                + filterLevel * envAmountSmooth.next (p.filterEnvSemis)
                                + lfo * lfoFilterSmooth.next (p.lfoFilterSemis)
                                + (currentNote - 60.0f) * keyTrackSmooth.next (p.keyTrack);
            const auto hz = std::clamp (noteToHz (cutoff), 20.0f, maxCutoff);
            const auto resonance = qSmooth.next (p.resonance);
            if (resonance != lastResonance)
            {
                lastResonance = resonance;
                q = resonanceToQ (resonance);
            }
            if (lowpass24)
            {
                filter1.setCutoffAndQ (hz, 0.54f);  // 1段目は控えめにして、山は2段目で作る
                filter2.setCutoffAndQ (hz, q);
            }
            else
            {
                filter1.setCutoffAndQ (hz, q);
            }
        }
        l = filter1.process (0, l);
        r = filter1.process (1, r);
        if (lowpass24)
        {
            l = filter2.process (0, l);
            r = filter2.process (1, r);
        }

        const auto tremolo = 1.0f - lfoAmpSmooth.next (p.lfoAmp) * (0.5f - 0.5f * lfo);
        const auto gain    = ampLevel * velocityGain * tremolo * voiceGain * (fading ? fadeGain : 1.0f);
        left[n]  += l * gain;
        right[n] += r * gain;

        if (! ampEnv.isActive())
        {
            if (pending)
            {
                // 差し替え待ちの間に余韻が消えた → すぐ次の音へ
                finishFade();
                if (! active) break;
                snapUnisonNow();
                continue;
            }
            // 余韻が消えたら終わり
            active   = false;
            released = false;
            fading   = false;
            break;
        }
    }
}
} // namespace grow
