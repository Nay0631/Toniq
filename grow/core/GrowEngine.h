#pragma once

#include "GrowFx.h"
#include "GrowParams.h"
#include "GrowVoice.h"

namespace grow
{
// grow の本体（JUCE 版・WebAssembly 版で共通）。
// パラメーターの値を持ち、音符を受けてボイスを割り当て、エフェクトを通して左右に書き出す。
// ボイスの割り当て：ポリ（8音。足りなければ古い音から差し替える）／モノ・レガート（1音）。
//   モノ    ：鍵盤を押すたびに EG を掛け直す（グライドがあれば前の音から滑る）
//   レガート：前の鍵盤を押したまま次を押したときは EG を掛け直さず、高さだけ変える
// モノ・レガートは、押している鍵盤を離すと、まだ押している鍵盤のうち最後に押した音へ戻る。
// 音符は render() の呼び出しの間に渡す（サンプル単位で合わせたいときは、呼び出し側が音符の位置で render を区切る）
class Engine
{
public:
    Engine();

    void prepare (double sampleRate);

    void setParam (int index, float value);  // 実際の値（範囲外は収める）
    float getParam (int index) const;
    void loadPreset (int index);
    void setBpm (double bpm);

    void noteOn (int midiNote, float velocity);  // velocity は 0〜1
    void noteOff (int midiNote);
    void setSustainPedal (bool down);
    void setPitchBend (float semitones);
    void allNotesOff();  // すぐ止める（余韻なし）

    // left / right に書く（足すのではなく上書き）
    void render (float* left, float* right, int numSamples);

private:
    void updateParams();
    Voice* findVoiceForNewNote();
    Voice& monoVoice() { return voices[0]; }

    float values[numParams] {};
    GrowParams params;
    bool dirty = true;
    double bpm = 120.0;
    double sampleRate = 44100.0;

    VoiceShared shared;
    Voice voices[numVoices];
    Fx fx;

    VoiceMode voiceMode = VoiceMode::poly;
    int heldNotes[128] {};  // モノ・レガートで押している鍵盤（押した順）
    int numHeld = 0;
    bool sustainPedal = false;
    std::uint32_t noteCounter = 0;
};
} // namespace grow
