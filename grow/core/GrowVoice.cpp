#include "GrowVoice.h"

#include <algorithm>
#include <initializer_list>

namespace grow
{
namespace
{
constexpr float voiceGain   = 0.3f;    // 8音重ねても割れにくいよう、1音の大きさを抑える（最後にリミッター）
constexpr int   filterEvery = 4;       // フィルターのカットオフを計算し直す間隔（サンプル）
// ドリフトの量が最大（1）のときのずれ。音ごとの高さ（半音）・カットオフ（半音）、高さのゆっくりした揺れ（半音）と、
// 揺れの目指す値を選び直す間隔（秒）・近づく速さ（時定数・秒）
constexpr float driftPitchSemis   = 0.07f;
constexpr float driftCutoffSemis  = 2.0f;
constexpr float driftWanderSemis  = 0.04f;
constexpr float driftWanderPeriod = 0.15f;
constexpr float driftWanderTime   = 0.1f;
// FM の量が最大（1）のときに OSC 1 の位相をずらす大きさ（周期。1.5 周期 ≒ 変調指数 9.4）
constexpr float fmDepth = 1.5f;
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
    eg2.setSampleRate (sampleRate);
    filter1.setSampleRate (sampleRate);
    filter2.setSampleRate (sampleRate);
    fadeStep = 1.0f / (fadeSeconds * (float) sampleRate);

    for (auto* s : { &lfoPitchSmooth, &lfoAmpSmooth, &subSmooth, &noiseSmooth, &fmSmooth, &ringSmooth,
                     &pwSmooth[0], &pwSmooth[1], &lfoPwSmooth })
        s->prepare (sampleRate, smoothSeconds);
    for (auto& s : modAmountSmooth) s.prepare (sampleRate, smoothSeconds);
    for (auto* s : { &cutoffSmooth, &qSmooth, &envAmountSmooth, &lfoFilterSmooth, &keyTrackSmooth, &driveSmooth })
        s->prepare (sampleRate, smoothSeconds, filterEvery);

    stopNote (false);
}

void Voice::snapSmoothing()
{
    // 新しく鳴らす音は、今のつまみの値から始める（前の音の途中の値から滑らせない）
    unisonReady = false;
    for (auto* s : { &lfoPitchSmooth, &lfoAmpSmooth, &subSmooth, &noiseSmooth, &fmSmooth, &ringSmooth,
                     &pwSmooth[0], &pwSmooth[1], &lfoPwSmooth, &modAmountSmooth[0], &modAmountSmooth[1],
                     &modAmountSmooth[2], &modAmountSmooth[3], &cutoffSmooth, &qSmooth,
                     &envAmountSmooth, &lfoFilterSmooth, &keyTrackSmooth, &driveSmooth })
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
    subPhase  = 0.0f;
    modPhase  = 0.0f;
    syncPhase = 0.0f;
    // ドリフト：音ごとに少しずれた高さ・明るさで鳴らす（量が 0 なら使わないが、乱数の並びは量によらずそろえる）
    driftPitch    = random.bipolar();
    driftCutoff   = random.bipolar();
    wander        = 0.0f;
    wanderTarget  = random.bipolar();
    wanderCounter = 0;
    if (! p.lfoRetrigger) lfoPhase = random.next();  // 同時に弾いた音どうしの揺れがそろいすぎないように
    if (! p.lfo2Retrigger) lfo2Phase = random.next();
    noteRandom = random.bipolar();  // モジュレーションの元「ランダム」（音ごとに決める）
    snapSmoothing();

    active    = true;
    sustained = false;
    fading    = false;
    fadeGain  = 1.0f;
    pending   = false;
    pendingStopped = false;
    ampEnv.reset();
    filterEnv.reset();
    eg2.reset();
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
    {
        noteVelocity = std::clamp (velocity, 0.0f, 1.0f);
        velocityGain = 1.0f - p.velocitySens * (1.0f - noteVelocity);
    }
    released = false;
    pitchEnvLevel = 1.0f;
    if (p.lfoRetrigger)
    {
        lfoPhase = 0.0f;
        lfoHold  = random.bipolar();
    }
    if (p.lfo2Retrigger)
    {
        lfo2Phase = 0.0f;
        lfo2Hold  = random.bipolar();
    }
    // フェードイン：発音から LFO の深さを 0 から上げていく
    lfoFadeLevel  = p.lfoFade  > 0.0f ? 0.0f : 1.0f;
    lfo2FadeLevel = p.lfo2Fade > 0.0f ? 0.0f : 1.0f;
    ampEnv.setParams (p.ampEnv);
    filterEnv.setParams (p.filterEnv);
    eg2.setParams (p.eg2);
    ampEnv.noteOn();
    filterEnv.noteOn();
    eg2.noteOn();
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
        eg2.noteOff();
        if (! ampEnv.isActive()) active = false;
        return;
    }
    ampEnv.reset();
    filterEnv.reset();
    eg2.reset();
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

float Voice::lfoShape (LfoWave wave, float phase, float hold) noexcept
{
    switch (wave)
    {
        case LfoWave::sine:     return std::sin (twoPi * phase);
        case LfoWave::triangle: return 1.0f - 4.0f * std::fabs (phase - 0.5f);
        case LfoWave::saw:      return 2.0f * phase - 1.0f;
        case LfoWave::square:   return phase < 0.5f ? 1.0f : -1.0f;
        case LfoWave::random:   return hold;
    }
    return 0.0f;
}

void Voice::updateBlockSettings (const GrowParams& p, int numSamples)
{
    ampEnv.setParams (p.ampEnv);
    filterEnv.setParams (p.filterEnv);
    eg2.setParams (p.eg2);

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
    const auto lfo2Step      = p.lfo2Hz / sr;
    const auto lfoFadeStep   = p.lfoFade  > 0.0f ? 1.0f / (p.lfoFade  * sr) : 1.0f;
    const auto lfo2FadeStep  = p.lfo2Fade > 0.0f ? 1.0f / (p.lfo2Fade * sr) : 1.0f;
    // ピッチ EG：指数は時間の約 5% まで戻る係数、直線は1サンプルで減らす量
    const auto pitchEnvStep  = 1.0f / (std::max (0.001f, p.pitchEnvTime) * sr);
    // モジュレーションの割り当てで、量 1 のときに動かす大きさ（行き先ごと）
    static constexpr float modScale[numModDests] = {
        24.0f,   // 高さ（半音）
        24.0f,   // OSC 2 の高さ（半音）
        48.0f,   // カットオフ（半音）
        0.45f,   // パルス幅
        1.0f,    // 音量（1 + 量 × 元 を掛ける）
        1.0f,    // FM の量
        1.0f,    // リングの量
    };
    const auto cutoffTarget  = hzToNote (p.cutoffHz);
    const auto maxCutoff     = std::min (20000.0f, sr * 0.45f);
    const auto lowpass24     = p.filterType == FilterType::lowpass24;
    const auto bend          = shared->bendSemis;
    const auto drift         = p.drift;
    const auto wanderPeriod  = std::max (1, (int) (driftWanderPeriod * sr));
    const auto wanderCoeff   = 1.0f - std::exp (-1.0f / (driftWanderTime * sr));
    const auto driftNote     = drift * driftPitch * driftPitchSemis;
    const auto driftCut      = drift * driftCutoff * driftCutoffSemis;

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
        lfo2Phase += lfo2Step;
        if (lfo2Phase >= 1.0f)
        {
            lfo2Phase -= std::floor (lfo2Phase);
            lfo2Hold = random.bipolar();
        }
        if (lfoFadeLevel  < 1.0f) lfoFadeLevel  = std::min (1.0f, lfoFadeLevel  + lfoFadeStep);
        if (lfo2FadeLevel < 1.0f) lfo2FadeLevel = std::min (1.0f, lfo2FadeLevel + lfo2FadeStep);
        const auto lfo  = lfoShape (p.lfoWave,  lfoPhase,  lfoHold)  * lfoFadeLevel;
        const auto lfo2 = lfoShape (p.lfo2Wave, lfo2Phase, lfo2Hold) * lfo2FadeLevel;

        pitchEnvLevel = p.pitchEnvLinear ? std::max (0.0f, pitchEnvLevel - pitchEnvStep)
                                         : flushDenormal (pitchEnvLevel * pitchEnvCoeff);

        const auto ampLevel    = ampEnv.next();
        const auto filterLevel = filterEnv.next();
        const auto eg2Level    = eg2.next();

        // モジュレーションの割り当て：元 × 量 × 大きさ を行き先ごとに足す
        float modTo[numModDests] {};
        for (int m = 0; m < numModSlots; ++m)
        {
            const auto& slot   = p.mods[m];
            const auto  amount = modAmountSmooth[m].next (slot.amount);
            if (slot.source == ModSource::none || amount == 0.0f) continue;
            auto source = 0.0f;
            switch (slot.source)
            {
                case ModSource::none:      break;
                case ModSource::velocity:  source = noteVelocity; break;
                case ModSource::eg2:       source = eg2Level; break;
                case ModSource::lfo1:      source = lfo; break;
                case ModSource::lfo2:      source = lfo2; break;
                case ModSource::filterEnv: source = filterLevel; break;
                case ModSource::key:       source = ((float) targetNote - 60.0f) / 60.0f; break;
                case ModSource::random:    source = noteRandom; break;
            }
            modTo[(int) slot.dest] += source * amount * modScale[(int) slot.dest];
        }

        // ドリフトの高さのゆっくりした揺れ：ときどき目指す値を選び直し、そこへ1次でなめらかに近づく
        if (drift > 0.0f)
        {
            if (--wanderCounter <= 0)
            {
                wanderCounter = wanderPeriod;
                wanderTarget  = random.bipolar();
            }
            wander = flushDenormal (wander + (wanderTarget - wander) * wanderCoeff);
        }
        const auto driftSemis = driftNote + drift * wander * driftWanderSemis;

        const auto note = currentNote + bend + driftSemis + p.pitchEnvSemis * pitchEnvLevel
                          + lfo * lfoPitchSmooth.next (p.lfoPitchSemis) + modTo[(int) ModDest::pitch];

        // OSC ごとの基準の高さ（Hz）
        float baseHz[2];
        for (int o = 0; o < 2; ++o)
        {
            const auto& osc = p.osc[o];
            baseHz[o] = noteToHz (note + (float) (osc.octave * 12 + osc.semitone) + osc.fineCents / 100.0f
                                  + (o == 1 ? modTo[(int) ModDest::osc2Pitch] : 0.0f));
        }

        // OSC 変調：変調の元（OSC 2 の高さで鳴る1本の波。OSC 2 の音量・ユニゾンによらない）
        const auto fm   = std::clamp (fmSmooth.next (p.fmAmount) + modTo[(int) ModDest::fm], 0.0f, 1.0f);
        const auto ring = std::clamp (ringSmooth.next (p.ringAmount) + modTo[(int) ModDest::ring], 0.0f, 1.0f);
        auto mod = 0.0f;
        if (fm > 0.0f || ring > 0.0f)
        {
            const auto dt = std::min (0.5f, baseHz[1] / sr);
            mod = oscillatorSample (p.osc[1].wave, modPhase, dt, p.osc[1].pulseWidth);
            advancePhase (modPhase, dt);
        }
        // ハードシンク：OSC 1 の高さで回る位相が1周したら、OSC 2 の位相を頭に戻す
        auto syncReset = false;
        if (p.hardSync)
        {
            syncPhase += std::min (0.5f, baseHz[0] / sr);
            if (syncPhase >= 1.0f) { syncPhase -= std::floor (syncPhase); syncReset = true; }
        }

        const auto lfoPw = lfo * lfoPwSmooth.next (p.lfoPulseWidth) + modTo[(int) ModDest::pulseWidth];
        auto l = 0.0f, r = 0.0f;
        for (int o = 0; o < 2; ++o)
        {
            const auto count = renderCount[o];
            const auto& osc = p.osc[o];
            const auto pulseWidth = std::clamp (pwSmooth[o].next (osc.pulseWidth) + lfoPw, 0.05f, 0.95f);
            if (o == 1 && syncReset)
                for (int i = 0; i < maxUnison; ++i) phases[1][i] = 0.0f;
            if (count == 0) continue;
            for (int i = 0; i < count; ++i)
            {
                curRatio[o][i] += incRatio[o][i];
                curLeft[o][i]  += incLeft[o][i];
                curRight[o][i] += incRight[o][i];
                const auto dt = std::min (0.5f, baseHz[o] * curRatio[o][i] / sr);
                auto s = 0.0f;
                if (o == 0 && fm > 0.0f)
                {
                    // FM（位相変調）：変調の元の値だけ位相をずらして読む（最大 ±fmDepth 周期）
                    auto shifted = phases[0][i] + fm * fmDepth * mod;
                    shifted -= std::floor (shifted);
                    s = oscillatorSample (osc.wave, shifted, dt, pulseWidth);
                }
                else
                {
                    s = oscillatorSample (osc.wave, phases[o][i], dt, pulseWidth);
                }
                if (o == 0 && ring > 0.0f) s += (s * mod - s) * ring;  // リング：掛けた音へ量の分だけ寄せる
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
                                + (currentNote - 60.0f) * keyTrackSmooth.next (p.keyTrack)
                                + driftCut
                                - (1.0f - noteVelocity) * p.velocitySemis
                                + modTo[(int) ModDest::cutoff];
            const auto hz = std::clamp (noteToHz (cutoff), 20.0f, maxCutoff);
            const auto resonance = qSmooth.next (p.resonance);
            const auto filterDrive = driveSmooth.next (p.filterDrive);
            filter1.setDrive (filterDrive);
            filter2.setDrive (filterDrive);
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
        const auto modGain = std::max (0.0f, 1.0f + modTo[(int) ModDest::amp]);
        const auto gain    = ampLevel * velocityGain * tremolo * modGain * voiceGain * (fading ? fadeGain : 1.0f);
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
