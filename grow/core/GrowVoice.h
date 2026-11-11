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
// つまみの値（音量・カットオフ・レゾナンス・ユニゾンの広がりなど）は数 ms かけて滑らかに変える。
// 鳴っている音を別の音に差し替えるときは、短くフェードアウトしてから新しい音を鳴らす（クリックを防ぐ）
class Voice
{
public:
    void setup (VoiceShared& shared, std::uint32_t seed);
    void prepare (double sampleRate);

    void startNote (int midiNote, float velocity);
    // 鳴っていれば短くフェードアウトしてから midiNote を鳴らす（鳴っていなければすぐ鳴らす）
    void steal (int midiNote, float velocity);
    // 鳴らしたまま音の高さだけ変える（モノ・レガート）。retrigger なら EG を今の大きさから掛け直す。velocity < 0 なら強さはそのまま
    void changeNote (int midiNote, float velocity, bool retrigger);
    // allowTailOff なら EG のリリースへ。でなければすぐ止める（余韻なし）
    void stopNote (bool allowTailOff);
    // 短くフェードアウトして止める（リリースを待たない。クリックは出さない）
    void fadeOut();

    // left / right に足す
    void render (float* left, float* right, int numSamples);

    bool isActive() const noexcept   { return active; }
    // 鍵盤を離した（余韻だけ）か。差し替え待ちの音は、その音の鍵盤を離したかどうか
    bool isReleased() const noexcept { return pending ? pendingStopped : released; }
    bool isFading() const noexcept   { return fading; }
    bool hasPendingNote() const noexcept { return pending; }
    int  getNote() const noexcept    { return pending ? pendingNote : targetNote; }

    std::uint32_t age = 0;   // 鳴らし始めた順（古い音から差し替える）
    bool sustained = false;  // 鍵盤を離したがサスティンペダルで伸ばしている

private:
    void trigger (float velocity);
    void updateBlockSettings (const GrowParams& p, int numSamples);
    void snapSmoothing();
    void finishFade();
    static float lfoShape (LfoWave wave, float phase, float hold) noexcept;

    VoiceShared* shared = nullptr;
    double sampleRate = 44100.0;
    Random random;

    bool  active       = false;
    bool  released     = false;
    int   targetNote   = 60;
    float currentNote  = 60.0f;  // グライド中の今の高さ（MIDI ノート番号）
    float velocityGain = 1.0f;

    // 差し替え・止めるときの短いフェードアウト
    bool  fading   = false;
    float fadeGain = 1.0f, fadeStep = 0.0f;
    bool  pending  = false;  // フェードが終わったら鳴らす音がある
    int   pendingNote = 60;
    float pendingVelocity = 1.0f;
    bool  pendingStopped = false;  // 鳴らす前にその鍵盤を離した

    Adsr ampEnv, filterEnv, eg2;

    float phases[2][maxUnison] {};
    float subPhase = 0.0f;
    // OSC 変調：変調の元（OSC 2 の高さの1本の波）の位相と、ハードシンクの親（OSC 1 の高さ）の位相
    float modPhase = 0.0f, syncPhase = 0.0f;
    // ユニゾンの1枚ずつの高さの比と左右の音量。target はブロックの頭に求めた目標、cur は今の値（1サンプルずつ inc だけ動かす）
    float targetRatio[2][maxUnison] {}, targetLeft[2][maxUnison] {}, targetRight[2][maxUnison] {};
    float curRatio[2][maxUnison] {}, curLeft[2][maxUnison] {}, curRight[2][maxUnison] {};
    float incRatio[2][maxUnison] {}, incLeft[2][maxUnison] {}, incRight[2][maxUnison] {};
    int   renderCount[2] {};  // 描く枚数（減らしたときは、外した音が消えるまで描く）
    bool  unisonReady = false;  // false なら次のブロックで今の値を目標にそろえる（発音の頭）

    // 1サンプルごとに滑らかにする値
    Smoother lfoPitchSmooth, lfoAmpSmooth, subSmooth, noiseSmooth, fmSmooth, ringSmooth, pwSmooth[2], lfoPwSmooth;
    // フィルターの計算し直し（filterEvery サンプルごと）に合わせて滑らかにする値
    Smoother cutoffSmooth, qSmooth, envAmountSmooth, lfoFilterSmooth, keyTrackSmooth, driveSmooth;

    float lfoPhase = 0.0f;
    float lfoHold  = 0.0f;  // ランダム（サンプル＆ホールド）の今の値
    float pitchEnvLevel = 0.0f;
    // LFO 2 の位相・ランダムの今の値、LFO 1 / 2 のフェードインの進み具合（0〜1）、音ごとのランダム（-1〜1）
    float lfo2Phase = 0.0f, lfo2Hold = 0.0f;
    float lfoFadeLevel = 1.0f, lfo2FadeLevel = 1.0f;
    float noteRandom = 0.0f;
    Smoother modAmountSmooth[numModSlots];

    // ドリフト（アナログらしいずれ。量は GrowParams::drift）。
    // 音ごとに決める高さ・カットオフのずれ（-1〜1）と、高さのゆっくりした揺れ（今の値・目指す値・次に目指す値を選び直すまでのサンプル数）
    float driftPitch = 0.0f, driftCutoff = 0.0f;
    // 弾いた強さ（0〜1）。カットオフのベロシティに使う
    float noteVelocity = 1.0f;
    float wander = 0.0f, wanderTarget = 0.0f;
    int   wanderCounter = 0;

    Svf filter1, filter2;  // ローパス 24 は2段に重ねる
    int filterCounter = 0;
};
} // namespace grow
