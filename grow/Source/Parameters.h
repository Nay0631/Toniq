#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

// grow の音作りの値（パラメーター）。
// 値の保持は AudioProcessorValueTreeState（ホストのオートメーション・プリセット・状態の保存もこれ）。
// 音を作る側（GrowVoice / FxChain）はブロックの頭で readParams() が作るスナップショット GrowParams だけを読む。
namespace grow
{
inline constexpr int numVoices  = 8;  // 同時に鳴らせる音の数（ポリ）
inline constexpr int maxUnison  = 7;  // OSC 1つあたりに重ねられる音の数

enum class Wave       { sine, triangle, saw, square };
enum class FilterType { lowpass12, lowpass24, highpass, bandpass };
enum class LfoWave    { sine, triangle, saw, square, random };
enum class VoiceMode  { poly, mono, legato };

struct OscParams
{
    Wave  wave        = Wave::saw;
    int   octave      = 0;
    int   semitone    = 0;
    float fineCents   = 0.0f;
    float level       = 0.0f;  // 0〜1
    int   unison      = 1;     // 重ねる音の数（1〜maxUnison）
    float detuneCents = 0.0f;  // 重ねた音の高さのずれ（いちばん外側の音のずれ）
    float width       = 0.0f;  // 重ねた音の左右の広がり（0〜1）
};

struct GrowParams
{
    OscParams osc[2];
    float subLevel   = 0.0f;  // 1オクターブ下のサイン波
    float noiseLevel = 0.0f;  // ホワイトノイズ（左右別々）

    FilterType filterType   = FilterType::lowpass24;
    float cutoffHz          = 6000.0f;
    float resonance         = 0.0f;  // 0〜1
    float filterEnvSemis    = 0.0f;  // フィルター EG でカットオフを動かす量（半音）
    float keyTrack          = 0.0f;  // 弾く音の高さにカットオフを追従させる量（0〜1。1 で音の高さと同じだけ動く）

    juce::ADSR::Parameters filterEnv;
    juce::ADSR::Parameters ampEnv;

    LfoWave lfoWave       = LfoWave::sine;
    float   lfoHz         = 5.0f;   // テンポ同期のときは BPM から求めた値
    bool    lfoRetrigger  = false;  // 発音ごとに LFO の位相を頭に戻す
    float   lfoPitchSemis = 0.0f;
    float   lfoFilterSemis = 0.0f;
    float   lfoAmp        = 0.0f;   // 0〜1

    float pitchEnvSemis = 0.0f;   // 発音の瞬間にずらす高さ（半音。0 に向かって戻る）
    float pitchEnvTime  = 0.08f;  // 戻るまでの時間（秒）

    VoiceMode voiceMode    = VoiceMode::poly;
    float     glideTime    = 0.0f;  // 前の音から滑らせる時間（秒）
    float     velocitySens = 0.5f;  // 強さ（ベロシティ）で音量を変える量

    float drive         = 0.0f;
    float chorusMix     = 0.0f;
    float chorusRate    = 0.8f;
    float chorusDepth   = 0.3f;
    float delayMix      = 0.0f;
    float delaySeconds  = 0.375f;
    float delayFeedback = 0.3f;
    bool  delayPingPong = true;
    float reverbMix     = 0.0f;
    float reverbSize    = 0.5f;
    float masterDb      = -6.0f;
};

// パラメーターの ID（OSC は osc1_ / osc2_ の後ろに名前を付ける：oscId (0, "wave") = "osc1_wave"）
namespace ids
{
    juce::String oscId (int osc, const char* name);

    inline constexpr const char* subLevel     = "sub_level";
    inline constexpr const char* noiseLevel   = "noise_level";
    inline constexpr const char* filterType   = "filter_type";
    inline constexpr const char* cutoff       = "filter_cutoff";
    inline constexpr const char* resonance    = "filter_reso";
    inline constexpr const char* filterEnvAmt = "filter_env";
    inline constexpr const char* keyTrack     = "filter_keytrack";
    inline constexpr const char* fenvA        = "fenv_attack";
    inline constexpr const char* fenvD        = "fenv_decay";
    inline constexpr const char* fenvS        = "fenv_sustain";
    inline constexpr const char* fenvR        = "fenv_release";
    inline constexpr const char* aenvA        = "aenv_attack";
    inline constexpr const char* aenvD        = "aenv_decay";
    inline constexpr const char* aenvS        = "aenv_sustain";
    inline constexpr const char* aenvR        = "aenv_release";
    inline constexpr const char* lfoWave      = "lfo_wave";
    inline constexpr const char* lfoSync      = "lfo_sync";
    inline constexpr const char* lfoRate      = "lfo_rate";
    inline constexpr const char* lfoRetrigger = "lfo_retrigger";
    inline constexpr const char* lfoPitch     = "lfo_pitch";
    inline constexpr const char* lfoFilter    = "lfo_filter";
    inline constexpr const char* lfoAmp       = "lfo_amp";
    inline constexpr const char* pitchEnvAmt  = "penv_amount";
    inline constexpr const char* pitchEnvTime = "penv_time";
    inline constexpr const char* voiceMode    = "voice_mode";
    inline constexpr const char* glide        = "glide";
    inline constexpr const char* velocity     = "velocity";
    inline constexpr const char* drive        = "fx_drive";
    inline constexpr const char* chorusMix    = "chorus_mix";
    inline constexpr const char* chorusRate   = "chorus_rate";
    inline constexpr const char* chorusDepth  = "chorus_depth";
    inline constexpr const char* delayMix     = "delay_mix";
    inline constexpr const char* delayTime    = "delay_time";
    inline constexpr const char* delayFeedback = "delay_feedback";
    inline constexpr const char* delayPingPong = "delay_pingpong";
    inline constexpr const char* reverbMix    = "reverb_mix";
    inline constexpr const char* reverbSize   = "reverb_size";
    inline constexpr const char* master       = "master";
} // namespace ids

juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

// 今のパラメーターの値をまとめて読む（オーディオスレッドでブロックの頭に呼ぶ）。bpm はテンポ同期に使う
GrowParams readParams (const juce::AudioProcessorValueTreeState& state, double bpm);
} // namespace grow
