#include "GrowFx.h"
#include "GrowDsp.h"

#include <algorithm>
#include <initializer_list>

namespace grow
{
namespace
{
constexpr double maxDelaySeconds  = 4.0;
constexpr double chorusMaxSeconds = 0.05;

// リバーブ（FDN）の8本のディレイの長さ（ミリ秒。互いに割り切れない長さにして、響きの山がそろわないようにする）
constexpr float reverbLineMs[]    = { 29.7f, 37.1f, 41.1f, 43.7f, 47.3f, 53.9f, 59.3f, 67.1f };
// 入口の拡散のオールパスの長さ（ミリ秒）と、くり返しの量
constexpr float diffuserMs[]      = { 4.7f, 3.6f, 12.7f, 9.3f };
constexpr float diffuserGain      = 0.6f;
// 「広さ」0〜1 → 響きが 60dB 下がるまでの時間（秒）。0.5 で 2 秒
constexpr float reverbMinSeconds  = 0.5f;
constexpr float reverbRatio       = 16.0f;
constexpr float reverbDampHz      = 6500.0f;  // くり返しのたびに高域を吸うローパス
constexpr float reverbModHz       = 0.3f;     // 2本の長さをゆっくり揺らす（金属的な鳴きを抑える）
constexpr float reverbModMs       = 0.4f;
constexpr float reverbWetGain     = 2.0f;    // 響きの大きさ（以前の Freeverb と同じくらいの大きさに合わせた値）

// ディレイのくり返しの中のフィルター（テープ風に、くり返すほど丸く・細くなる）
constexpr float delayLowHz  = 4500.0f;
constexpr float delayHighHz = 120.0f;

constexpr float limiterThreshold = 0.891f;  // -1 dB
constexpr float dcCutoffHz       = 10.0f;   // DC カットの周波数（聞こえる低音は削らない）

// ソフトクリップ：knee までは素通し、その上は tanh で丸めて 1（0 dB）を超えないようにする。
// 急なピークをリミッターがいきなり押さえる（ガツッと歪む）前に、角を丸めておく
constexpr float clipKnee = 0.6f;  // 約 -4.4 dB
inline float softClip (float x) noexcept
{
    const auto a = std::fabs (x);
    if (a <= clipKnee) return x;
    const auto room = 1.0f - clipKnee;
    return std::copysign (clipKnee + room * std::tanh ((a - clipKnee) / room), x);
}

// ディストーション
constexpr float distDcHz     = 15.0f;  // 歪ませた音の直流カット（チューブの片寄りで出る直流を取る）
constexpr float distPowerSec = 0.05f;  // 大きさをそろえるときの平均の時間
constexpr float distMaxGain  = 4.0f;   // 大きさをそろえるゲインの上限（ほぼ無音のときに持ち上げすぎない）
constexpr float distDriveDb  = 30.0f;  // 歪み 1 で入口を持ち上げる量（チューブ・ハード）
constexpr float distFoldDb   = 24.0f;  // 歪み 1 で入口を持ち上げる量（フォールド）

// コンプレッサー
constexpr float compKneeDb = 6.0f;  // ソフトニーの幅

// ドライブ：この値までは元の音と混ぜて、0 から上げ始めたときに音量・音色が急に変わらないようにする
constexpr float driveFadeIn = 0.1f;
} // namespace

float Fx::DelayLine::read (float delay) const
{
    const auto size = (int) buffer.size();
    auto position = (float) write - delay;
    while (position < 0.0f) position += (float) size;
    const auto i0   = (int) position;
    const auto frac = position - (float) i0;
    const auto a = buffer[(size_t) (i0 % size)];
    const auto b = buffer[(size_t) ((i0 + 1) % size)];
    return a + (b - a) * frac;
}

// Schroeder のオールパス（響きの色を変えずに位相だけ散らす）
float Fx::Allpass::process (float input, float gain)
{
    const auto buffered = buffer[(size_t) index];
    const auto v = flushDenormal (input + buffered * gain);
    buffer[(size_t) index] = v;
    if (++index >= (int) buffer.size()) index = 0;
    return buffered - v * gain;
}

float Fx::Halfband::process (float x, const float* coeffs)
{
    history[index] = x;
    history[index + halfbandTaps] = x;
    if (++index >= halfbandTaps) index = 0;
    auto y = 0.0f;
    const auto* h = history + index;  // いちばん古い値から
    for (int i = 0; i < halfbandTaps; ++i) y += h[i] * coeffs[i];
    return y;
}

void Fx::Halfband::clear()
{
    std::fill (std::begin (history), std::end (history), 0.0f);
    index = 0;
}

void Fx::prepare (double newSampleRate)
{
    sampleRate = newSampleRate;
    const auto scale = sampleRate / 44100.0;  // （以前の Freeverb の長さの基準。今は使わない）
    dcCoeff = 1.0f - twoPi * dcCutoffHz / (float) sampleRate;
    for (auto* s : { &driveSmooth, &distDriveSmooth, &distMixSmooth, &compMixSmooth, &compThresholdSmooth, &compMakeupSmooth,
                     &chorusMixSmooth, &chorusDepthSmooth, &delayMixSmooth, &delayFeedbackSmooth,
                     &reverbMixSmooth, &reverbSizeSmooth })
        s->prepare (sampleRate, smoothSeconds);
    // ディストーションの中は2倍の速さで動く
    distDcCoeff    = 1.0f - twoPi * distDcHz / (float) (2.0 * sampleRate);
    distPowerCoeff = 1.0f - std::exp (-1.0f / (distPowerSec * (float) (2.0 * sampleRate)));

    for (int ch = 0; ch < 2; ++ch)
    {
        chorusLine[ch].resize ((int) (chorusMaxSeconds * sampleRate) + 4);
        delayLine[ch].resize ((int) (maxDelaySeconds * sampleRate) + 4);
    }

    // ハーフバンド（2倍の速さで 1/4 周波数で切るローパス）：窓（Blackman）をかけた sinc。合計 1 にそろえる
    auto sum = 0.0f;
    const auto mid = (halfbandTaps - 1) / 2;
    for (int i = 0; i < halfbandTaps; ++i)
    {
        const auto n = (float) (i - mid);
        const auto sinc = n == 0.0f ? 0.5f : std::sin (pi * 0.5f * n) / (pi * n);
        const auto w = 0.42f - 0.5f * std::cos (twoPi * (float) i / (float) (halfbandTaps - 1))
                     + 0.08f * std::cos (2.0f * twoPi * (float) i / (float) (halfbandTaps - 1));
        halfbandCoeffs[i] = sinc * w;
        sum += halfbandCoeffs[i];
    }
    for (auto& c : halfbandCoeffs) c /= sum;

    // ディレイのくり返しのフィルターの係数
    delayLowCoeff  = 1.0f - std::exp (-twoPi * delayLowHz / (float) sampleRate);
    delayHighCoeff = std::exp (-twoPi * delayHighHz / (float) sampleRate);

    // リバーブ
    for (int i = 0; i < numDiffusers; ++i)
        diffusers[i].buffer.assign ((size_t) std::max (1.0, diffuserMs[i] * 0.001 * sampleRate), 0.0f);
    const auto modSamples = reverbModMs * 0.001f * (float) sampleRate;
    for (int i = 0; i < numLines; ++i)
    {
        lineLength[i] = reverbLineMs[i] * 0.001f * (float) sampleRate;
        reverbLine[i].resize ((int) (lineLength[i] + modSamples) + 4);
    }
    reverbDampCoeff = 1.0f - std::exp (-twoPi * reverbDampHz / (float) sampleRate);
    (void) scale;
    reset();
}

void Fx::clearDistortion()
{
    for (int ch = 0; ch < 2; ++ch)
    {
        distUp[ch].clear();
        distDown[ch].clear();
        distLow1[ch] = distLow2[ch] = distDcIn[ch] = distDcOut[ch] = distHeld[ch] = 0.0f;
    }
    distDryPower = distWetPower = 0.0f;
    distHoldCount = 0;
}

void Fx::clearChorus()
{
    for (auto& line : chorusLine) line.clear();
    chorusPhase = 0.0f;
}

void Fx::clearDelay()
{
    for (int ch = 0; ch < 2; ++ch)
    {
        delayLine[ch].clear();
        delayLow[ch] = delayHigh[ch] = delayHighIn[ch] = 0.0f;
    }
    delaySamples = 0.0f;
}

void Fx::clearReverb()
{
    for (auto& d : diffusers) std::fill (d.buffer.begin(), d.buffer.end(), 0.0f);
    for (auto& line : reverbLine) line.clear();
    for (auto& d : lineDamp) d = 0.0f;
    reverbModPhase = 0.0f;
}

void Fx::reset()
{
    for (int ch = 0; ch < 2; ++ch)
    {
        driveUp[ch].clear();
        driveDown[ch].clear();
    }
    clearDistortion();
    clearChorus();
    clearDelay();
    clearReverb();
    compGainDb = 0.0f;
    distToneCoeff = 1.0f;
    distIdle = compIdle = chorusIdle = delayIdle = reverbIdle = true;
    masterGain   = 0.0f;
    limiterGain  = 1.0f;
    for (int ch = 0; ch < 2; ++ch) dcIn[ch] = dcOut[ch] = 0.0f;
    for (auto* s : { &driveSmooth, &distDriveSmooth, &distMixSmooth, &compMixSmooth, &compThresholdSmooth, &compMakeupSmooth,
                     &chorusMixSmooth, &chorusDepthSmooth, &delayMixSmooth, &delayFeedbackSmooth,
                     &reverbMixSmooth, &reverbSizeSmooth })
        s->snapNext();
}

void Fx::processDrive (float* left, float* right, int numSamples, const GrowParams& p)
{
    // tanh で丸く歪ませる。tanh (k) で割って、強くしても一番大きい所の音量はそろえる。
    // 歪みで増えた高い倍音が折り返さないよう、2倍の速さにしてから歪ませ、ハーフバンドで切って戻す
    // （ドライブが 0 の間は何もしない。上げると FIR の分だけ約 7.5 サンプル遅れる）
    for (int n = 0; n < numSamples; ++n)
    {
        const auto drive = driveSmooth.next (std::clamp (p.drive, 0.0f, 1.0f));
        if (drive <= 0.0f) continue;
        const auto k    = 1.0f + drive * 9.0f;
        const auto norm = 1.0f / std::tanh (k);
        const auto wet  = std::min (1.0f, drive / driveFadeIn);
        float* io[2] = { left + n, right + n };
        for (int ch = 0; ch < 2; ++ch)
        {
            const auto x = *io[ch];
            auto y = 0.0f;
            for (int phase = 0; phase < 2; ++phase)
            {
                // 0 を挟んで2倍にし（振幅を 2 倍して戻す）、ローパスで間を埋める
                const auto up = driveUp[ch].process (phase == 0 ? 2.0f * x : 0.0f, halfbandCoeffs);
                const auto shaped = up + (std::tanh (k * up) * norm - up) * wet;
                y = driveDown[ch].process (shaped, halfbandCoeffs);  // 2つ目（間引いて残す方）を使う
            }
            *io[ch] = flushDenormal (y);
        }
    }
}

void Fx::processDistortion (float* left, float* right, int numSamples, const GrowParams& p)
{
    // 2倍の速さにしてから歪ませ（倍音の折り返しを抑える）、トーンのローパス・直流カットを通す。
    // 歪ませた音は元の音と平均の大きさ（左右まとめたパワー）をそろえてから「量」で混ぜるので、
    // 歪みを強くしても音量はほぼ変わらず、音色だけが変わる。混ぜるのも2倍の速さの中で行う（FIR の遅れで元の音とずれない）
    const auto mixTarget = std::clamp (p.distMix, 0.0f, 1.0f);
    if (mixTarget <= 0.0f && distMixSmooth.isAt (0.0f))
    {
        distIdle = true;  // 量が 0：元の音のまま（FIR も通さない）
        return;
    }
    if (distIdle)
    {
        clearDistortion();  // 止めていた間の古い音を出さない（量は 0 から滑らかに上がる）
        distIdle = false;
    }

    const auto rate2       = (float) (2.0 * sampleRate);
    const auto toneHz      = std::clamp (p.distToneHz, 20.0f, 0.45f * rate2);
    const auto toneTarget  = 1.0f - std::exp (-twoPi * toneHz / rate2);
    const auto toneSmooth  = 1.0f - std::exp (-1.0f / (smoothSeconds * rate2));
    const auto driveTarget = std::clamp (p.distDrive, 0.0f, 1.0f);
    const auto type        = p.distType;

    for (int n = 0; n < numSamples; ++n)
    {
        const auto mix   = distMixSmooth.next (mixTarget);
        const auto drive = distDriveSmooth.next (driveTarget);
        const auto gain  = dbToGain (drive * (type == DistType::fold ? distFoldDb : distDriveDb));
        // ビット：歪み 0 で 16 ビット・間引きなし、1 で 4 ビット・31 サンプルごと（2倍の速さで数える）
        const auto levels = std::exp2 (15.0f - 12.0f * drive);
        const auto hold   = 1 + (int) (drive * drive * 30.0f);

        const float in[2] = { left[n], right[n] };
        float out[2] = { 0.0f, 0.0f };
        for (int phase = 0; phase < 2; ++phase)
        {
            distToneCoeff += (toneTarget - distToneCoeff) * toneSmooth;
            if (type == DistType::bit && --distHoldCount < 0) distHoldCount = hold - 1;
            float up[2], wet[2];
            for (int ch = 0; ch < 2; ++ch)
            {
                // 0 を挟んで2倍にし（振幅を 2 倍して戻す）、ローパスで間を埋める
                up[ch] = distUp[ch].process (phase == 0 ? 2.0f * in[ch] : 0.0f, halfbandCoeffs);
                const auto u = up[ch] * gain;
                float y;
                switch (type)
                {
                    case DistType::tube:  // 正の側を早く、負の側をゆるく丸める（偶数倍音の出る片寄った歪み）
                        y = u >= 0.0f ? std::tanh (u) : std::tanh (0.6f * u) / 0.6f;
                        break;
                    case DistType::hard:  // ±1 で切る
                        y = std::clamp (u, -1.0f, 1.0f);
                        break;
                    case DistType::fold:  // ±1 を超えた所で折り返す（サインのウェーブフォルダー）
                        y = std::sin (u * (pi * 0.5f));
                        break;
                    case DistType::bit:
                    default:              // 間引いて保ち、段数を減らす（ビットクラッシャー）
                        if (distHoldCount == hold - 1) distHeld[ch] = std::round (up[ch] * levels) / levels;
                        y = distHeld[ch];
                        break;
                }
                // トーン（1次のローパス2段）→ 直流カット
                distLow1[ch] = flushDenormal (distLow1[ch] + (y - distLow1[ch]) * distToneCoeff);
                distLow2[ch] = flushDenormal (distLow2[ch] + (distLow1[ch] - distLow2[ch]) * distToneCoeff);
                const auto dc = distLow2[ch] - distDcIn[ch] + distDcCoeff * distDcOut[ch];
                distDcIn[ch]  = distLow2[ch];
                distDcOut[ch] = flushDenormal (dc);
                wet[ch] = dc;
            }

            // 元の音と平均の大きさをそろえる
            distDryPower = flushDenormal (distDryPower + (up[0] * up[0] + up[1] * up[1] - distDryPower) * distPowerCoeff);
            distWetPower = flushDenormal (distWetPower + (wet[0] * wet[0] + wet[1] * wet[1] - distWetPower) * distPowerCoeff);
            const auto match = std::min (distMaxGain, std::sqrt ((distDryPower + 1.0e-10f) / (distWetPower + 1.0e-10f)));

            for (int ch = 0; ch < 2; ++ch)
            {
                const auto mixed = up[ch] + (wet[ch] * match - up[ch]) * mix;
                out[ch] = distDown[ch].process (mixed, halfbandCoeffs);  // 2つ目（間引いて残す方）を使う
            }
        }
        left[n]  = flushDenormal (out[0]);
        right[n] = flushDenormal (out[1]);
    }
}

void Fx::processCompressor (float* left, float* right, int numSamples, const GrowParams& p)
{
    // 左右の大きい方のピーク（dB）がスレッショルドを超えた分を、レシオで縮める（ソフトニー）。
    // 下げ幅はアタック（下げるとき）・リリース（戻すとき）の時間で追い、左右に同じだけかける。
    // 「量」で元の音と混ぜる（1 未満ならパラレルコンプ。アタックの頭を残したまま余韻を持ち上げる）
    const auto mixTarget = std::clamp (p.compMix, 0.0f, 1.0f);
    if (mixTarget <= 0.0f && compMixSmooth.isAt (0.0f))
    {
        compIdle = true;  // 量が 0：元の音のまま
        return;
    }
    if (compIdle)
    {
        compGainDb = 0.0f;  // 前の下げ幅を持ち越さない
        compIdle = false;
    }

    const auto sr      = (float) sampleRate;
    const auto attack  = std::exp (-1.0f / (std::max (0.0001f, p.compAttack) * sr));
    const auto release = std::exp (-1.0f / (std::max (0.001f, p.compRelease) * sr));
    const auto slope   = 1.0f / std::max (1.0f, p.compRatio) - 1.0f;  // 超えた分 1dB あたりの下げ幅（負）

    for (int n = 0; n < numSamples; ++n)
    {
        const auto mix       = compMixSmooth.next (mixTarget);
        const auto threshold = compThresholdSmooth.next (p.compThresholdDb);
        const auto makeup    = compMakeupSmooth.next (p.compMakeupDb);

        const auto peak    = std::max (std::fabs (left[n]), std::fabs (right[n]));
        const auto levelDb = peak > 1.0e-6f ? 20.0f * std::log10 (peak) : -120.0f;
        const auto over    = levelDb - threshold;
        float target;
        if (2.0f * over <= -compKneeDb)
            target = 0.0f;
        else if (2.0f * over < compKneeDb)
        {
            const auto k = over + 0.5f * compKneeDb;
            target = slope * k * k / (2.0f * compKneeDb);
        }
        else
            target = slope * over;

        const auto coeff = target < compGainDb ? attack : release;
        compGainDb = flushDenormal (target + (compGainDb - target) * coeff);

        const auto gain = (1.0f - mix) + mix * dbToGain (compGainDb + makeup);
        left[n]  *= gain;
        right[n] *= gain;
    }
}

void Fx::processChorus (float* left, float* right, int numSamples, const GrowParams& p)
{
    // 揺れるディレイを左右3本ずつ（揺れの位相を 120° ずつずらし、右は左から 60° ずらす）。量で元の音と混ぜる
    const auto sr     = (float) sampleRate;
    const auto step   = p.chorusRate / sr;
    const auto centre = 0.008f * sr;
    const auto depthTarget = std::clamp (p.chorusDepth, 0.0f, 1.0f);
    const auto mixTarget   = std::clamp (p.chorusMix, 0.0f, 1.0f);
    if (mixTarget <= 0.0f && chorusMixSmooth.isAt (0.0f))
    {
        chorusIdle = true;  // 量が 0：元の音のまま
        return;
    }
    if (chorusIdle)
    {
        clearChorus();  // 止めていた間の古い音を出さない（量は 0 から滑らかに上がる）
        chorusIdle = false;
    }

    for (int n = 0; n < numSamples; ++n)
    {
        const auto depth = 0.007f * sr * chorusDepthSmooth.next (depthTarget);
        const auto mix   = chorusMixSmooth.next (mixTarget);
        chorusPhase += step;
        if (chorusPhase >= 1.0f) chorusPhase -= 1.0f;
        const float in[2] = { left[n], right[n] };
        float out[2];
        for (int ch = 0; ch < 2; ++ch)
        {
            chorusLine[ch].push (in[ch]);
            auto wet = 0.0f;
            for (int v = 0; v < 3; ++v)
            {
                const auto lfo = std::sin (twoPi * (chorusPhase + (float) v / 3.0f + (float) ch / 6.0f));
                wet += chorusLine[ch].read (std::max (1.0f, centre + depth * lfo));
            }
            wet *= 1.0f / 3.0f;
            out[ch] = in[ch] * (1.0f - mix) + wet * mix;
        }
        left[n]  = out[0];
        right[n] = out[1];
    }
}

void Fx::processDelay (float* left, float* right, int numSamples, const GrowParams& p)
{
    const auto maxSamples = (float) (maxDelaySeconds * sampleRate) - 2.0f;
    const auto target     = std::clamp (p.delaySeconds * (float) sampleRate, 1.0f, maxSamples);
    if (delaySamples <= 0.0f) delaySamples = target;
    // 長さを変えたときに「ブツッ」とならないよう滑らかに（約 80ms）
    const auto smooth   = 1.0f - std::exp (-1.0f / (0.08f * (float) sampleRate / 3.0f));
    const auto feedbackTarget = std::clamp (p.delayFeedback, 0.0f, 0.95f);
    const auto mixTarget      = std::clamp (p.delayMix, 0.0f, 1.0f);
    if (mixTarget <= 0.0f && delayMixSmooth.isAt (0.0f))
    {
        delayIdle = true;  // 量が 0：くり返しは聞こえないので計算しない
        return;
    }
    if (delayIdle)
    {
        clearDelay();  // 止めていた間の古い音を出さない（量は 0 から滑らかに上がる）
        delayIdle = false;
    }

    for (int n = 0; n < numSamples; ++n)
    {
        const auto feedback = delayFeedbackSmooth.next (feedbackTarget);
        const auto mix      = delayMixSmooth.next (mixTarget);
        delaySamples += (target - delaySamples) * smooth;
        const auto dl  = delayLine[0].read (delaySamples);
        const auto dr  = delayLine[1].read (delaySamples);
        const auto inL = left[n], inR = right[n];

        // くり返しの音：ローパス・ハイパスを通し、弱く飽和させる（テープ風。くり返すほど丸く細くなる）
        float back[2];
        const float raw[2] = { dl, dr };
        for (int ch = 0; ch < 2; ++ch)
        {
            delayLow[ch]  = flushDenormal (delayLow[ch] + (raw[ch] - delayLow[ch]) * delayLowCoeff);
            delayHigh[ch] = flushDenormal (delayHighCoeff * (delayHigh[ch] + delayLow[ch] - delayHighIn[ch]));
            delayHighIn[ch] = delayLow[ch];
            back[ch] = std::tanh (delayHigh[ch] * feedback);
        }

        if (p.delayPingPong)
        {
            // 入力は左から入れ、くり返すたびに左右を入れ替える
            delayLine[0].push (flushDenormal (0.5f * (inL + inR) + back[1]));
            delayLine[1].push (flushDenormal (back[0]));
        }
        else
        {
            delayLine[0].push (flushDenormal (inL + back[0]));
            delayLine[1].push (flushDenormal (inR + back[1]));
        }
        left[n]  = inL + dl * mix;
        right[n] = inR + dr * mix;
    }
}

void Fx::processReverb (float* left, float* right, int numSamples, const GrowParams& p)
{
    // FDN：入口の音をオールパスで散らし、8本のディレイに入れる。各ディレイの出力を Householder 行列
    // （全体の平均の 2 倍を引く。エネルギーを保ったまま全部の線を混ぜる）で混ぜて、減衰・ローパスをかけて戻す。
    // 左右は8本の出力を別々の符号の組で足して作る（左右で違う響きになり、広がる）
    const auto sr         = (float) sampleRate;
    const auto sizeTarget = std::clamp (p.reverbSize, 0.0f, 1.0f);
    const auto mixTarget  = std::clamp (p.reverbMix, 0.0f, 1.0f);
    if (mixTarget <= 0.0f && reverbMixSmooth.isAt (0.0f))
    {
        reverbIdle = true;  // 量が 0：響きは聞こえないので計算しない
        return;
    }
    if (reverbIdle)
    {
        clearReverb();  // 止めていた間の古い音を出さない（量は 0 から滑らかに上がる）
        reverbIdle = false;
    }
    const auto modStep    = reverbModHz / sr;
    const auto modDepth   = reverbModMs * 0.001f * sr;
    static constexpr float signL[numLines] = { 1, -1, 1, -1, 1, -1, 1, -1 };
    static constexpr float signR[numLines] = { 1, 1, -1, -1, 1, 1, -1, -1 };

    // 響きの長さは「広さ」をブロックの頭で読んで決める（滑らかに変わる）
    const auto size  = reverbSizeSmooth.next (sizeTarget);
    const auto rt60  = reverbMinSeconds * std::pow (reverbRatio, size);
    float lineGain[numLines];
    for (int i = 0; i < numLines; ++i) lineGain[i] = std::pow (10.0f, -3.0f * lineLength[i] / (rt60 * sr));

    for (int n = 0; n < numSamples; ++n)
    {
        const auto mix = reverbMixSmooth.next (mixTarget);
        reverbModPhase += modStep;
        if (reverbModPhase >= 1.0f) reverbModPhase -= 1.0f;
        const auto mod = std::sin (twoPi * reverbModPhase) * modDepth;

        auto input = (left[n] + right[n]) * 0.5f;
        for (auto& d : diffusers) input = d.process (input, diffuserGain);

        float out[numLines];
        auto total = 0.0f;
        for (int i = 0; i < numLines; ++i)
        {
            // 2本だけ長さを揺らす（逆向き）
            const auto wobble = i == 1 ? mod : i == 6 ? -mod : 0.0f;
            out[i] = reverbLine[i].read (lineLength[i] + wobble);
            total += out[i];
        }
        const auto householder = total * (2.0f / (float) numLines);
        auto wetL = 0.0f, wetR = 0.0f;
        for (int i = 0; i < numLines; ++i)
        {
            wetL += out[i] * signL[i];
            wetR += out[i] * signR[i];
            const auto mixed = out[i] - householder;
            lineDamp[i] = flushDenormal (lineDamp[i] + (mixed - lineDamp[i]) * reverbDampCoeff);
            reverbLine[i].push (flushDenormal (input + lineDamp[i] * lineGain[i]));
        }
        const auto wet = mix * reverbWetGain / (float) numLines * 2.0f;
        const auto dry = 1.0f - 0.4f * mix;
        left[n]  = left[n] * dry + wetL * wet;
        right[n] = right[n] * dry + wetR * wet;
    }
}

void Fx::processOutput (float* left, float* right, int numSamples, const GrowParams& p)
{
    const auto target  = dbToGain (p.masterDb);
    const auto smooth  = 1.0f - std::exp (-1.0f / (0.02f * (float) sampleRate / 3.0f));
    const auto release = 1.0f - std::exp (-1.0f / (0.1f * (float) sampleRate));  // リミッターの戻り（約 100ms）

    for (int n = 0; n < numSamples; ++n)
    {
        masterGain += (target - masterGain) * smooth;
        float s[2] = { left[n] * masterGain, right[n] * masterGain };

        for (int ch = 0; ch < 2; ++ch)
        {
            // DC カット：直流（波形の片寄り）を取り除く。そのままだとソフトクリップ・リミッターが片側だけ早く効く
            const auto y = s[ch] - dcIn[ch] + dcCoeff * dcOut[ch];
            dcIn[ch]  = s[ch];
            dcOut[ch] = flushDenormal (y);
            s[ch] = softClip (y);
        }

        // リミッター：-1 dB を超えたらすぐ下げ、ゆっくり戻す
        const auto peak = std::max (std::fabs (s[0]), std::fabs (s[1]));
        const auto want = peak > limiterThreshold ? limiterThreshold / peak : 1.0f;
        limiterGain = want < limiterGain ? want : limiterGain + (want - limiterGain) * release;
        // 最後の clamp は念のため（NaN などで飛んだときに耳・スピーカーを守る）
        left[n]  = std::clamp (s[0] * limiterGain, -1.0f, 1.0f);
        right[n] = std::clamp (s[1] * limiterGain, -1.0f, 1.0f);
    }
}

void Fx::process (float* left, float* right, int numSamples, const GrowParams& p)
{
    processDrive (left, right, numSamples, p);
    processDistortion (left, right, numSamples, p);
    processCompressor (left, right, numSamples, p);
    processChorus (left, right, numSamples, p);
    processDelay (left, right, numSamples, p);
    processReverb (left, right, numSamples, p);
    processOutput (left, right, numSamples, p);
}
} // namespace grow
