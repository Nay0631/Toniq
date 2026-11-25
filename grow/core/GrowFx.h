#pragma once

#include <algorithm>
#include <memory>
#include <vector>
#include "GrowDsp.h"
#include "GrowParams.h"

namespace grow
{
// 全ボイスを足した後ろのエフェクト（左右）：
// ドライブ（2倍オーバーサンプリング）→ ディストーション（2倍オーバーサンプリング）→ コンプレッサー → コーラス（左右3本ずつ）→ ディレイ（テンポ同期・左右に跳ねる・くり返しはテープ風）
//   → リバーブ（8本の FDN）→ マスター → DC カット → ソフトクリップ → リミッター
// 量・深さなどのつまみの値は数 ms かけて滑らかに変える。
// 入力も出力も無音のまま続いたら計算を止め（休み）、次に音が来たら再開する
class Fx
{
public:
    void prepare (double sampleRate);
    void reset();
    // inputSilent = 入力が無音（鳴っているボイスがなく、left / right は 0）
    void process (float* left, float* right, int numSamples, const GrowParams& p, bool inputSilent);

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

    // ディレイの長い線（1チャンネル）。長い（4秒）ので 0 で埋めず、書いた長さを覚えておいて、まだ書いていない所は 0 として読む
    // （音色を作る・開き直すのがオーディオスレッドの上なので、長いバッファを埋めると音が途切れる）
    struct EchoLine
    {
        std::unique_ptr<float[]> buffer;
        int size = 0, write = 0, written = 0;
        void resize (int newSize)
        {
            if (newSize != size) buffer.reset (new float[(size_t) newSize]);  // 中身は不定のまま
            size = newSize;
            clear();
        }
        void clear() { write = written = 0; }
        void push (float x)
        {
            buffer[(size_t) write] = x;
            if (++write >= size) write = 0;
            if (written < size) ++written;
        }
        void pushSilence (int numSamples);      // 0 を numSamples 個入れる
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
    void processDistortion (float* left, float* right, int numSamples, const GrowParams& p);
    void processCompressor (float* left, float* right, int numSamples, const GrowParams& p);
    void processChorus (float* left, float* right, int numSamples, const GrowParams& p);
    void processDelay (float* left, float* right, int numSamples, const GrowParams& p);
    void processReverb (float* left, float* right, int numSamples, const GrowParams& p);
    void processOutput (float* left, float* right, int numSamples, const GrowParams& p);
    float delayTarget (const GrowParams& p) const;  // ディレイの長さ（サンプル）の目標
    void snapSmoothers();

    // 休み：入力も出力も無音のまま続いたので、計算を止めている
    bool resting = false;
    int  quietSamples = 0;  // 入力も出力も無音のまま続いたサンプル数
    void updateRest (const float* left, const float* right, int numSamples, const GrowParams& p);
    void rest (int numSamples, const GrowParams& p);
    void wake (const GrowParams& p);

    double sampleRate = 44100.0;

    float halfbandCoeffs[halfbandTaps] {};
    Halfband driveUp[2], driveDown[2];

    // ディストーション：2倍の速さで歪ませ、トーン（ローパス2段）・直流カットを通し、元の音と聞こえる大きさをそろえて混ぜる
    Halfband distUp[2], distDown[2];
    float distLow1[2] {}, distLow2[2] {};       // トーンのローパスの状態
    float distDcIn[2] {}, distDcOut[2] {};      // 歪ませた音の直流カット
    float distToneCoeff = 1.0f;                  // 今のトーンの係数（目標へ滑らかに近づける）
    float distDcCoeff = 0.999f;
    float distDryPower = 0.0f, distWetPower = 0.0f;  // 大きさをそろえるための平均パワー（左右まとめて）
    float distPowerCoeff = 0.001f;
    float distHeld[2] {};                        // ビット：間引いて保っている値
    int   distHoldCount = 0;

    // コンプレッサー：左右の大きい方のピークで、ゲインの下げ幅（dB）をアタック・リリースで追う（左右同じだけ下げる）
    float compGainDb = 0.0f;

    DelayLine chorusLine[2];
    float chorusPhase = 0.0f;

    EchoLine delayLine[2];
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

    Smoother distDriveSmooth, distMixSmooth;
    Smoother compMixSmooth, compThresholdSmooth, compMakeupSmooth;
    Smoother driveSmooth, chorusMixSmooth, chorusDepthSmooth;
    Smoother delayMixSmooth, delayFeedbackSmooth;
    Smoother reverbMixSmooth, reverbSizeSmooth;

    // 量が 0 で落ち着いている間は計算しない（混ぜても聞こえないため）。止めていたものを再開するときは、
    // 古い響きが出ないようにバッファを空にしてから始める
    bool distIdle = true, compIdle = true, chorusIdle = true, delayIdle = true, reverbIdle = true;
    void clearDistortion();
    void clearChorus();
    void clearDelay();
    void clearReverb();
};
} // namespace grow
