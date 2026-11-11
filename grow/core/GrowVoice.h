#pragma once

#include "GrowDsp.h"
#include "GrowParams.h"

namespace grow
{
// すべての音（ボイス）で共有する値。params はエンジンが値の変わったときに作り直す
struct VoiceShared
{
    const GrowParams* params = nullptr;
    float lastNote  = -1.0f;  // 直前に弾いた音（グライドの出発点。-1 = まだない）
    float bendSemis = 0.0f;   // ピッチベンド（半音）
};

// 1音分のシンセ。
// 音の流れ：OSC 1・OSC 2（それぞれユニゾンで重ねて左右に広げる）＋サブ＋ノイズ → フィルター（EG・LFO・キー追従）
//          → アンプ（ADSR・ベロシティ・LFO）→ 出力（左右に足す）
class Voice
{
public:
    void setup (VoiceShared& shared, std::uint32_t seed);
    void prepare (double sampleRate);

    void startNote (int midiNote, float velocity);
    // 鳴らしたまま音の高さだけ変える（モノ・レガート）。retrigger なら EG を今の大きさから掛け直す。velocity < 0 なら強さはそのまま
    void changeNote (int midiNote, float velocity, bool retrigger);
    void stopNote (bool allowTailOff);

    // left / right に足す
    void render (float* left, float* right, int numSamples);

    bool isActive() const noexcept   { return active; }
    bool isReleased() const noexcept { return released; }
    int  getNote() const noexcept    { return targetNote; }

    std::uint32_t age = 0;   // 鳴らし始めた順（古い音から差し替える）
    bool sustained = false;  // 鍵盤を離したがサスティンペダルで伸ばしている

private:
    void trigger (float velocity);
    void updateBlockSettings (const GrowParams& p);
    float lfoValue (LfoWave wave) const noexcept;

    VoiceShared* shared = nullptr;
    double sampleRate = 44100.0;
    Random random;

    bool  active       = false;
    bool  released     = false;
    int   targetNote   = 60;
    float currentNote  = 60.0f;  // グライド中の今の高さ（MIDI ノート番号）
    float velocityGain = 1.0f;

    Adsr ampEnv, filterEnv;

    float phases[2][maxUnison] {};
    float subPhase = 0.0f;
    // ユニゾンの1枚ずつの高さの比と左右の音量（ブロックごとに求める）
    float unisonRatio[2][maxUnison] {};
    float unisonLeft[2][maxUnison] {};
    float unisonRight[2][maxUnison] {};

    float lfoPhase = 0.0f;
    float lfoHold  = 0.0f;  // ランダム（サンプル＆ホールド）の今の値
    float pitchEnvLevel = 0.0f;

    Svf filter1, filter2;  // ローパス 24 は2段に重ねる
    int filterCounter = 0;
};
} // namespace grow
