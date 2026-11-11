#pragma once

#include <algorithm>
#include <vector>
#include "GrowDsp.h"
#include "GrowParams.h"

namespace grow
{
// 全ボイスを足した後ろのエフェクト（左右）：
// ドライブ → コーラス → ディレイ（テンポ同期・左右に跳ねる）→ リバーブ（Freeverb）
//   → マスター → DC カット → ソフトクリップ → リミッター
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

    struct Comb
    {
        std::vector<float> buffer;
        int index = 0;
        float last = 0.0f;
        float process (float input, float damp, float feedback);
    };

    struct Allpass
    {
        std::vector<float> buffer;
        int index = 0;
        float process (float input);
    };

    void processDrive (float* left, float* right, int numSamples, const GrowParams& p);
    void processChorus (float* left, float* right, int numSamples, const GrowParams& p);
    void processDelay (float* left, float* right, int numSamples, const GrowParams& p);
    void processReverb (float* left, float* right, int numSamples, const GrowParams& p);
    void processOutput (float* left, float* right, int numSamples, const GrowParams& p);

    double sampleRate = 44100.0;

    DelayLine chorusLine[2];
    float chorusPhase = 0.0f;

    DelayLine delayLine[2];
    float delaySamples = 0.0f;  // 今の長さ（目標へ滑らかに近づける）

    static constexpr int numCombs = 8, numAllpasses = 4;
    Comb combs[2][numCombs];
    Allpass allpasses[2][numAllpasses];

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
