#pragma once

// grow のコア（JUCE を使わない C++）：パラメーターの表と、音を作る側が読む値のまとめ GrowParams。
// JUCE 版（Standalone・VST3）と WebAssembly 版（Toniq の再生）で共通に使う。
// パラメーターの ID・名前・範囲・初期値・表示は、すべてこの表（GrowParams.cpp の table）が決める。
namespace grow
{
inline constexpr int numVoices = 8;  // 同時に鳴らせる音の数（ポリ）
inline constexpr int maxUnison = 7;  // OSC 1つあたりに重ねられる音の数

enum class Wave       { sine, triangle, saw, square };
enum class FilterType { lowpass12, lowpass24, highpass, bandpass };
enum class LfoWave    { sine, triangle, saw, square, random };
enum class VoiceMode  { poly, mono, legato };

enum class ParamKind { continuous, integer, choice, toggle };
enum class ParamUnit { none, percent, hertz, seconds, semitones, cents, decibels, signedInteger };

struct ParamInfo
{
    const char* id;     // 保存・ホストのオートメーションに使う ID（一度出したら変えない）
    const char* group;  // 画面のモジュール名（UTF-8）
    const char* name;   // 表示名（UTF-8）
    ParamKind kind;
    float min, max, defaultValue;
    float skewCentre;   // ノブの真ん中に来る値（0 = 直線）。JUCE の NormalisableRange::setSkewForCentre と同じ
    ParamUnit unit;
    const char* const* choices;  // choice / toggle の表示（UTF-8）
    int numChoices;
};

// パラメーターの番号（table の並びと同じ）
enum Param : int
{
    osc1Wave, osc1Octave, osc1Semi, osc1Fine, osc1Level, osc1Unison, osc1Detune, osc1Width,
    osc2Wave, osc2Octave, osc2Semi, osc2Fine, osc2Level, osc2Unison, osc2Detune, osc2Width,
    subLevel, noiseLevel,
    filterType, filterCutoff, filterResonance, filterEnvAmount, filterKeyTrack,
    fenvAttack, fenvDecay, fenvSustain, fenvRelease,
    aenvAttack, aenvDecay, aenvSustain, aenvRelease,
    lfoWave, lfoSync, lfoRate, lfoRetrigger, lfoPitch, lfoFilter, lfoAmp,
    pitchEnvAmount, pitchEnvTime,
    voiceMode, glide, velocity,
    drive, chorusMix, chorusRate, chorusDepth,
    delayMix, delayTime, delayFeedback, delayPingPong,
    reverbMix, reverbSize, master,
    numParams
};

const ParamInfo& paramInfo (int index);
int  findParam (const char* id);                 // 見つからなければ -1
void defaultValues (float* values);              // numParams 個
float clampParam (int index, float value);       // 範囲に収め、整数・選択肢は丸める
int  formatParam (int index, float value, char* out, int size);  // 表示用の文字列（UTF-8）。書いた長さを返す

// ノブの位置（0〜1）と値の変換（skewCentre の曲がり方込み）
float paramToNormalised (int index, float value);
float normalisedToParam (int index, float normalised);

struct EnvParams
{
    float attack = 0.005f, decay = 0.3f, sustain = 0.8f, release = 0.3f;  // 秒・0〜1
};

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

// 音を作る側（Voice / Fx）が読む値。makeParams() でパラメーターの値と BPM から作る
struct GrowParams
{
    OscParams osc[2];
    float subLevel   = 0.0f;  // 1オクターブ下のサイン波
    float noiseLevel = 0.0f;  // ホワイトノイズ（左右別々）

    FilterType filterType = FilterType::lowpass24;
    float cutoffHz        = 6000.0f;
    float resonance       = 0.0f;  // 0〜1
    float filterEnvSemis  = 0.0f;  // フィルター EG でカットオフを動かす量（半音）
    float keyTrack        = 0.0f;  // 弾く音の高さにカットオフを追従させる量（1 で音の高さと同じだけ動く）

    EnvParams filterEnv;
    EnvParams ampEnv;

    LfoWave lfoWave        = LfoWave::sine;
    float   lfoHz          = 5.0f;   // テンポ同期のときは BPM から求めた値
    bool    lfoRetrigger   = false;  // 発音ごとに LFO の位相を頭に戻す
    float   lfoPitchSemis  = 0.0f;
    float   lfoFilterSemis = 0.0f;
    float   lfoAmp         = 0.0f;   // 0〜1

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

GrowParams makeParams (const float* values, double bpm);
} // namespace grow
