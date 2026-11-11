#pragma once

#include <algorithm>
#include <vector>
#include "GrowDsp.h"
#include "GrowParams.h"

namespace grow
{
// 全ボイスを足した後ろのエフェクト（左右）：
// ドライブ（2倍オーバーサンプリング）→ コーラス（左右3本ずつ）→ ディレイ（テンポ同期・左右に跳ねる・くり返しはテープ風）
//   → リバーブ（8本の FDN）→ マスター → DC カット → ソフトクリップ → リミッター
// 量・深さなどのつまみの値は数 ms かけて滑らかに変える
class Fx
{
public:
    void prepare (double sampleRate);
    void reset();
    void process (float* left, float* right, int numSamples, const GrowParams& p);

private:
    // 長さを小数で読めるリングバッファ（1チャンネル）
    struct DelayLine
    {
        std::vector<float> buffer;
        int write = 0;
        void resize (int size) { buffer.assign ((size_t) size, 0.0f); write = 0; }
        void clear() { std::fill (buffer.begin(), buffer.end(), 0.0f); }
        void push (float x)
        {
            buffer[(size_t) write] = x;
            if (++write >= (int) buffer.size()) write = 0;
        }
        float read (float delaySamples) const;  // delaySamples サンプル前（1 以上）
    };

    // 拡散用のオールパス（固定の長さ）
    struct Allpass
    {
        std::vector<float> buffer;
        int index = 0;
        float process (float input, float gain);
    };

    // 2倍オーバーサンプリング用のハーフバンド FIR（1チャンネル分の履歴）
    static constexpr int halfbandTaps = 31;
    struct Halfband
    {
        float history[halfbandTaps * 2] {};  // 同じ値を2回書き、折り返さずに連続で読む
        int index = 0;
        float process (float x, const float* coeffs);
        void clear();
    };

    void processDrive (float* left, float* right, int numSamples, const GrowParams& p);
    void processChorus (float* left, float* right, int numSamples, const GrowParams& p);
    void processDelay (float* left, float* right, int numSamples, const GrowParams& p);
    void processReverb (float* left, float* right, int numSamples, const GrowParams& p);
    void processOutput (float* left, float* right, int numSamples, const GrowParams& p);

    double sampleRate = 44100.0;

    float halfbandCoeffs[halfbandTaps] {};
    Halfband driveUp[2], driveDown[2];

    DelayLine chorusLine[2];
    float chorusPhase = 0.0f;

    DelayLine delayLine[2];
    float delaySamples = 0.0f;  // 今の長さ（目標へ滑らかに近づける）
    // ディレイのくり返しの中のローパス・ハイパス（1次）の状態
    float delayLow[2] {}, delayHigh[2] {}, delayHighIn[2] {};
    float delayLowCoeff = 0.5f, delayHighCoeff = 0.99f;

    // リバーブ：入口の拡散（オールパス4段）→ 8本のディレイを Householder 行列で混ぜる FDN
    static constexpr int numDiffusers = 4, numLines = 8;
    Allpass diffusers[numDiffusers];
    DelayLine reverbLine[numLines];
    float lineLength[numLines] {};       // サンプル
    float lineDamp[numLines] {};         // くり返しのローパスの状態
    float reverbDampCoeff = 0.3f;
    float reverbModPhase  = 0.0f;

    float masterGain = 0.0f;
    float limiterGain = 1.0f;

    // DC カット（1次のハイパス）の前の入力・出力
    float dcIn[2] {}, dcOut[2] {};
    float dcCoeff = 0.9995f;

    Smoother driveSmooth, chorusMixSmooth, chorusDepthSmooth;
    Smoother delayMixSmooth, delayFeedbackSmooth;
    Smoother reverbMixSmooth, reverbSizeSmooth;
};
} // namespace grow
