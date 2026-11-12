#pragma once

// grow のコア（JUCE を使わない C++）：パラメーターの表と、音を作る側が読む値のまとめ GrowParams。
// JUCE 版（Standalone・VST3）と WebAssembly 版（Toniq の再生）で共通に使う。
// パラメーターの ID・名前・範囲・初期値・表示は、すべてこの表（GrowParams.cpp の table）が決める。
namespace grow
{
inline constexpr int numVoices = 16;  // 同時に鳴らせる音の数（ポリ。鳴っていない音は計算しないので、増やしても負担は鳴っている音の分だけ）
inline constexpr int maxUnison = 7;  // OSC 1つあたりに重ねられる音の数

enum class Wave       { sine, triangle, saw, square };
enum class FilterType { lowpass12, lowpass24, highpass, bandpass };
enum class LfoWave    { sine, triangle, saw, square, random };
enum class VoiceMode  { poly, mono, legato };
// モジュレーションの元と行き先（GrowParams.cpp の modSourceNames / modDestNames の並び）
enum class ModSource  { none, velocity, eg2, lfo1, lfo2, filterEnv, key, random };
enum class ModDest    { pitch, osc2Pitch, cutoff, pulseWidth, amp, fm, ring, lfo1Rate };
inline constexpr int numModDests = 8;
inline constexpr int numModSlots = 4;  // モジュレーションの割り当ての数

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
    osc1PulseWidth, osc2PulseWidth, fmAmount, ringAmount, hardSync,
    filterType, filterCutoff, filterResonance, filterEnvAmount, filterKeyTrack, filterDrive, filterVelocity, osc2Direct,
    fenvAttack, fenvDecay, fenvSustain, fenvRelease,
    aenvAttack, aenvDecay, aenvSustain, aenvRelease,
    lfoWave, lfoSync, lfoRate, lfoRetrigger, lfoPitch, lfoFilter, lfoAmp, lfoPulseWidth, lfoFade,
    lfo2Wave, lfo2Sync, lfo2Rate, lfo2Retrigger, lfo2Fade,
    eg2Attack, eg2Decay, eg2Sustain, eg2Release,
    mod1Source, mod1Dest, mod1Amount, mod2Source, mod2Dest, mod2Amount,
    mod3Source, mod3Dest, mod3Amount, mod4Source, mod4Dest, mod4Amount,
    pitchEnvAmount, pitchEnvTime, pitchEnvCurve,
    voiceMode, glide, velocity, drift,
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
    float pulseWidth  = 0.5f;  // 矩形波の幅（0.5 = 普通の矩形波）
};

// 音を作る側（Voice / Fx）が読む値。makeParams() でパラメーターの値と BPM から作る
struct GrowParams
{
    OscParams osc[2];
    float subLevel   = 0.0f;  // 1オクターブ下のサイン波
    float noiseLevel = 0.0f;  // ホワイトノイズ（左右別々）

    // OSC 変調。変調の元は OSC 2 の高さで鳴る1本の波（OSC 2 の波形。OSC 2 の音量が 0 でも使える）
    float fmAmount   = 0.0f;   // OSC 2 → OSC 1 の FM（位相変調）の量（0〜1）
    float ringAmount = 0.0f;   // OSC 1 に OSC 2 を掛けるリングモジュレーションの量（0〜1。1 で掛けた音だけ）
    bool  hardSync   = false;  // OSC 2 の位相を OSC 1 の周期ごとに頭に戻す（ハードシンク）

    FilterType filterType = FilterType::lowpass24;
    float cutoffHz        = 6000.0f;
    float resonance       = 0.0f;  // 0〜1
    float filterEnvSemis  = 0.0f;  // フィルター EG でカットオフを動かす量（半音）
    float keyTrack        = 0.0f;  // 弾く音の高さにカットオフを追従させる量（1 で音の高さと同じだけ動く）
    float filterDrive     = 0.0f;  // フィルターの中で飽和させる量（0〜1。0 なら歪まない）。レゾナンスが丸く太くなる
    float velocitySemis   = 0.0f;  // 弱く弾いたときにカットオフを下げる量（半音。強さ 1 で 0、強さ 0 でこの分だけ下がる）
    bool  osc2Direct      = false; // OSC 2 をフィルターに通さず、フィルターのあとに足す（削った帯域にも素の音を残す）

    EnvParams filterEnv;
    EnvParams ampEnv;

    LfoWave lfoWave        = LfoWave::sine;
    float   lfoHz          = 5.0f;   // テンポ同期のときは BPM から求めた値
    bool    lfoRetrigger   = false;  // 発音ごとに LFO の位相を頭に戻す
    float   lfoPitchSemis  = 0.0f;
    float   lfoFilterSemis = 0.0f;
    float   lfoAmp         = 0.0f;   // 0〜1
    float   lfoPulseWidth  = 0.0f;   // 矩形波の幅を揺らす量（PWM。0〜0.45）
    float   lfoFade        = 0.0f;   // 発音から LFO が最大の深さになるまでの時間（秒。0 = すぐ）

    // LFO 2（行き先はモジュレーションの割り当てで決める）
    LfoWave lfo2Wave      = LfoWave::sine;
    float   lfo2Hz        = 2.0f;
    bool    lfo2Retrigger = false;
    float   lfo2Fade      = 0.0f;

    // EG 2（モジュレーション用の ADSR。行き先はモジュレーションの割り当てで決める）
    EnvParams eg2;

    // モジュレーションの割り当て（元 × 量 → 行き先。量は -1〜1）
    struct ModSlot
    {
        ModSource source = ModSource::none;
        ModDest   dest   = ModDest::pitch;
        float     amount = 0.0f;
    };
    ModSlot mods[numModSlots];

    float pitchEnvSemis = 0.0f;   // 発音の瞬間にずらす高さ（半音。0 に向かって戻る）
    float pitchEnvTime  = 0.08f;  // 戻るまでの時間（秒）
    bool  pitchEnvLinear = false; // true = 半音で一定の速さで戻る（直線）、false = はじめ速く戻る（指数）

    VoiceMode voiceMode    = VoiceMode::poly;
    float     glideTime    = 0.0f;  // 前の音から滑らせる時間（秒）
    float     velocitySens = 0.5f;  // 強さ（ベロシティ）で音量を変える量
    float     drift        = 0.0f;  // アナログらしいずれ（0〜1）。音ごとに高さ・カットオフを少しずらし、高さをゆっくり揺らす

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
