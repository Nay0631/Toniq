#pragma once

#include <cmath>
#include <cstdint>
#include "GrowParams.h"

// grow のコアの部品（JUCE を使わない）：エンベロープ・フィルター・オシレーター・乱数
namespace grow
{
inline constexpr float pi    = 3.14159265358979f;
inline constexpr float twoPi = 6.28318530717959f;

// ===== 音の高さ =====

// MIDI ノート番号（小数可）→ Hz
inline float noteToHz (float note) noexcept { return 440.0f * std::exp2 ((note - 69.0f) / 12.0f); }
// Hz → MIDI ノート番号（小数）
inline float hzToNote (float hz) noexcept { return 69.0f + 12.0f * std::log2 (hz / 440.0f); }
inline float dbToGain (float db) noexcept { return std::pow (10.0f, db / 20.0f); }

// ===== デノーマル対策 =====
// wasm には FTZ / DAZ（とても小さい値を 0 にする CPU の設定）がないので、
// フィードバックや減衰で 0 に近づいていく値は自前で 0 にする（極小の値の計算はとても遅くなる）
inline float flushDenormal (float x) noexcept { return std::fabs (x) < 1.0e-15f ? 0.0f : x; }

// ===== パラメーターのスムージング（1次ローパス） =====
// ノブの値が段差で変わると「ジジッ」と鳴る（ジッパーノイズ）ので、目標の値へ数 ms かけて近づける。
// 最初の1回（と snapNext のあと）は目標の値から始める
class Smoother
{
public:
    // seconds = 時定数（約 3 倍の時間でほぼ届く）。every = 何サンプルごとに next() を呼ぶか
    void prepare (double sampleRate, float seconds, int every = 1) noexcept
    {
        coeff = 1.0f - std::exp (-(float) every / (seconds * (float) sampleRate));
        ready = false;
    }
    void snapNext() noexcept { ready = false; }
    // 今の値が target にいる（次の next (target) も target を返す）か
    bool isAt (float target) const noexcept { return ! ready || value == target; }

    float next (float target) noexcept
    {
        if (! ready)
        {
            value = target;
            ready = true;
            return value;
        }
        value += (target - value) * coeff;
        if (std::fabs (target - value) < 1.0e-6f) value = target;  // 届いたら止める（極小の差を残さない）
        return value;
    }

private:
    float value = 0.0f, coeff = 1.0f;
    bool ready = false;
};

inline constexpr float smoothSeconds = 0.01f;  // パラメーターのスムージングの時定数（約 30ms でほぼ届く）

// ===== 乱数（xorshift。オーディオスレッドで使えるよう軽く・確保なし） =====
class Random
{
public:
    explicit Random (std::uint32_t seed = 0x9e3779b9u) : state (seed != 0 ? seed : 1u) {}
    float next() noexcept  // 0〜1
    {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return (float) (state >> 8) / 16777216.0f;
    }
    float bipolar() noexcept { return next() * 2.0f - 1.0f; }  // -1〜1

private:
    std::uint32_t state;
};

// ===== オシレーター（ノコギリ・矩形は PolyBLEP で折り返しノイズを抑える） =====

inline float polyBlep (float t, float dt) noexcept
{
    if (t < dt)
    {
        t /= dt;
        return t + t - t * t - 1.0f;
    }
    if (t > 1.0f - dt)
    {
        t = (t - 1.0f) / dt;
        return t * t + t + t + 1.0f;
    }
    return 0.0f;
}

// pulseWidth は矩形波の「上」の長さの割合（0.5 = 普通の矩形波）。幅を変えると平均がずれるので差し引いて 0 を中心にする
inline float oscillatorSample (Wave wave, float phase, float dt, float pulseWidth = 0.5f) noexcept
{
    switch (wave)
    {
        case Wave::sine:     return std::sin (twoPi * phase);
        case Wave::triangle: return 1.0f - 4.0f * std::fabs (phase - 0.5f);
        case Wave::saw:      return 2.0f * phase - 1.0f - polyBlep (phase, dt);
        case Wave::square:
        {
            // 上がる辺（位相 0）と下がる辺（位相 pulseWidth）の両方に PolyBLEP をかける
            auto fall = phase + (1.0f - pulseWidth);
            if (fall >= 1.0f) fall -= 1.0f;
            const auto raw = (phase < pulseWidth ? 1.0f : -1.0f) + polyBlep (phase, dt) - polyBlep (fall, dt);
            return raw - (2.0f * pulseWidth - 1.0f);
        }
    }
    return 0.0f;
}

// 位相を dt 進めて 0〜1 に収める
inline void advancePhase (float& phase, float dt) noexcept
{
    phase += dt;
    if (phase >= 1.0f) phase -= std::floor (phase);
}

// ===== ADSR（指数カーブ。鳴っている途中で掛け直すと、今の大きさから立ち上がり直す） =====
// アナログのエンベロープと同じく、目標より少し先の値へ1次で近づく形（Nigel Redmon の方式）：
//   アタック            ：1 より上（1 + attackRatio）を目指す、上に膨らんだ形
//   ディケイ・リリース  ：目標より少し下を目指す、はじめ速く後ろがゆっくり減る形（音量の dB が一定の速さで下がる）
// 目標を少し越えた所を目指すので、各段の時間ちょうどで目標に届いて次の段へ進む
class Adsr
{
public:
    void setSampleRate (double sr) noexcept
    {
        sampleRate = (float) sr;
        sustainCoeff = 1.0f - std::exp (-1.0f / (0.005f * sampleRate));  // サスティンの値を変えたときに約 15ms で寄せる
        computed = false;
    }

    void setParams (const EnvParams& p) noexcept
    {
        if (computed && p.attack == params.attack && p.decay == params.decay && p.sustain == params.sustain
            && p.release == params.release)
            return;
        params   = p;
        computed = true;
        attackCoeff  = coeffFor (p.attack, attackRatio);
        attackBase   = (1.0f + attackRatio) * (1.0f - attackCoeff);
        decayCoeff   = coeffFor (p.decay, decayRatio);
        decayBase    = (p.sustain - decayRatio) * (1.0f - decayCoeff);
        releaseCoeff = coeffFor (p.release, decayRatio);
        releaseBase  = -decayRatio * (1.0f - releaseCoeff);
    }

    void noteOn() noexcept { state = State::attack; }

    void noteOff() noexcept
    {
        if (state == State::idle) return;
        if (value > 0.0f) state = State::release;
        else              reset();
    }

    void reset() noexcept
    {
        value = 0.0f;
        state = State::idle;
    }

    bool isActive() const noexcept { return state != State::idle; }

    float next() noexcept
    {
        switch (state)
        {
            case State::idle:
                return 0.0f;
            case State::attack:
                value = attackBase + value * attackCoeff;
                if (value >= 1.0f)
                {
                    value = 1.0f;
                    state = State::decay;
                }
                break;
            case State::decay:
                value = decayBase + value * decayCoeff;
                if (value <= params.sustain)
                {
                    // サスティンが 0 なら、0 に届いた所で終わる（押したままでも音のないボイスを空ける。
                    // ドラムなど、消音の合図を送らずに鳴らし切る音に使う）
                    if (params.sustain <= 0.0f)
                    {
                        reset();
                        break;
                    }
                    value = params.sustain;
                    state = State::sustain;
                }
                break;
            case State::sustain:
                // サスティンのつまみを動かしても段差にならないよう、滑らかに寄せる
                value += (params.sustain - value) * sustainCoeff;
                value = flushDenormal (value);
                break;
            case State::release:
                value = releaseBase + value * releaseCoeff;
                if (value <= 0.0f) reset();
                break;
        }
        return value;
    }

private:
    // 目標を越えて目指す量。小さいほど曲がりが強い
    static constexpr float attackRatio = 0.3f;
    static constexpr float decayRatio  = 0.03f;

    // time 秒で目標に届く係数（time が 0 なら 1 サンプルで届く）
    float coeffFor (float time, float ratio) const noexcept
    {
        const auto samples = time * sampleRate;
        if (samples <= 1.0f) return 0.0f;
        return std::exp (-std::log ((1.0f + ratio) / ratio) / samples);
    }

    enum class State { idle, attack, decay, sustain, release };
    State state = State::idle;
    EnvParams params;
    bool  computed = false;
    float sampleRate = 44100.0f;
    float value = 0.0f;
    float attackCoeff = 0.0f, attackBase = 1.3f;
    float decayCoeff = 0.0f, decayBase = 0.0f;
    float releaseCoeff = 0.0f, releaseBase = 0.0f;
    float sustainCoeff = 1.0f;
};

// なめらかな飽和（tanh を有理式で近づけたもの。|x| が 3 を超えたら ±1）
inline float softSaturate (float x) noexcept
{
    if (x > 3.0f)  return 1.0f;
    if (x < -3.0f) return -1.0f;
    const auto x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}

// ===== ステートバリアブルフィルター（TPT。左右2チャンネル） =====
// ドライブ（0〜1）を上げると、入力を持ち上げて1段目の積分器（バンドパスの状態）を飽和させる。
// レゾナンスの山が大きくなりすぎずに丸く太くなる（アナログのフィルターに近い振る舞い）。出力は持ち上げた分だけ戻す
class Svf
{
public:
    enum class Type { lowpass, highpass, bandpass };

    void setSampleRate (double sr) noexcept { sampleRate = (float) sr; update(); }
    void setType (Type t) noexcept { type = t; }
    void setCutoff (float hz) noexcept { if (hz != cutoff) { cutoff = hz; update(); } }
    void setQ (float q) noexcept { if (q != resonance) { resonance = q; update(); } }
    // カットオフと Q を一緒に変える（計算し直しは1回）
    void setCutoffAndQ (float hz, float q) noexcept
    {
        if (hz == cutoff && q == resonance) return;
        cutoff = hz;
        resonance = q;
        update();
    }
    void setDrive (float amount) noexcept
    {
        drive    = amount;
        inGain   = 1.0f + 3.0f * amount;
        outGain  = 1.0f / inGain;
    }
    void reset() noexcept { s1[0] = s1[1] = s2[0] = s2[1] = 0.0f; }

    float process (int ch, float x) noexcept
    {
        auto& a = s1[ch];
        auto& b = s2[ch];
        if (drive > 0.0f) x *= inGain;
        const auto hp = h * (x - a * (g + r2) - b);
        const auto bp = hp * g + a;
        const auto next = hp * g + bp;
        // ドライブがあるときは積分器を飽和させる（satLevel までは素通しに近い）
        a = flushDenormal (drive > 0.0f ? satLevel * softSaturate (next / satLevel) : next);
        const auto lp = bp * g + b;
        b = flushDenormal (bp * g + lp);
        const auto y = type == Type::lowpass ? lp : type == Type::bandpass ? bp : hp;
        return drive > 0.0f ? y * outGain : y;
    }

private:
    void update() noexcept
    {
        const auto fc = std::fmin (cutoff, sampleRate * 0.49f);
        g  = std::tan (pi * fc / sampleRate);
        r2 = 1.0f / resonance;
        h  = 1.0f / (1.0f + r2 * g + g * g);
    }

    static constexpr float satLevel = 1.5f;  // 積分器が飽和し始める大きさ
    Type type = Type::lowpass;
    float drive = 0.0f, inGain = 1.0f, outGain = 1.0f;
    float sampleRate = 44100.0f, cutoff = 1000.0f, resonance = 0.7071f;
    float g = 0.0f, r2 = 1.414f, h = 1.0f;
    float s1[2] {}, s2[2] {};
};
} // namespace grow
