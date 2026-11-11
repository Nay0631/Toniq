#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include "Parameters.h"

namespace grow
{
class GrowSound : public juce::SynthesiserSound
{
public:
    bool appliesToNote (int) override    { return true; }
    bool appliesToChannel (int) override { return true; }
};

// すべての音（ボイス）で共有する値。params はプロセッサーがブロックの頭で更新する
struct VoiceShared
{
    const GrowParams* params = nullptr;
    float lastNote = -1.0f;  // 直前に弾いた音（グライドの出発点。-1 = まだない）
};

// 1音分のシンセ。
// 音の流れ：OSC 1・OSC 2（それぞれユニゾンで重ねて左右に広げる）＋サブ＋ノイズ → フィルター（EG・LFO・キー追従）
//          → アンプ（ADSR・ベロシティ・LFO）→ 出力（左右）
class GrowVoice : public juce::SynthesiserVoice
{
public:
    explicit GrowVoice (VoiceShared& shared);

    void prepare (double sampleRate, int maxBlockSize);

    bool canPlaySound (juce::SynthesiserSound* sound) override;
    void startNote (int midiNote, float velocity, juce::SynthesiserSound*, int pitchWheel) override;
    void stopNote (float velocity, bool allowTailOff) override;
    void pitchWheelMoved (int value) override;
    void controllerMoved (int, int) override {}
    void renderNextBlock (juce::AudioBuffer<float>& output, int startSample, int numSamples) override;

    // モノ・レガート：鳴らしたまま音の高さだけ変える。retrigger なら EG を今の大きさから掛け直す。
    // velocity < 0 なら強さはそのまま
    void changeNote (int midiNote, float velocity, bool retrigger);

    int  getTargetNote() const noexcept { return targetNote; }
    bool isReleased() const noexcept    { return released; }

private:
    void trigger (float velocity);
    void updateBlockSettings (const GrowParams& p);
    float lfoValue (LfoWave wave) const noexcept;

    VoiceShared& shared;
    double sampleRate = 44100.0;

    int   targetNote   = 60;
    float currentNote  = 60.0f;  // グライド中の今の高さ（MIDI ノート番号）
    float bendSemis    = 0.0f;
    float velocityGain = 1.0f;
    bool  released     = false;

    juce::ADSR ampEnv, filterEnv;

    float phases[2][maxUnison] {};
    float subPhase = 0.0f;
    // ユニゾンの1枚ずつの高さの比と左右の音量（ブロックごとに求める）
    float unisonRatio[2][maxUnison] {};
    float unisonLeft[2][maxUnison] {};
    float unisonRight[2][maxUnison] {};

    float lfoPhase = 0.0f;
    float lfoHold  = 0.0f;  // ランダム（サンプル＆ホールド）の今の値
    float pitchEnvLevel = 0.0f;

    juce::dsp::StateVariableTPTFilter<float> filter1, filter2;  // ローパス 24 は2段に重ねる
    int filterCounter = 0;

    juce::Random random;
};
} // namespace grow
