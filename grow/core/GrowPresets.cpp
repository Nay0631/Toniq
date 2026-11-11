#include "GrowPresets.h"
#include "GrowParams.h"

#include <cstddef>

namespace grow
{
namespace
{
// 選択肢の番号（GrowParams.cpp の選択肢の並び）
namespace wave   { constexpr float sine = 0, triangle = 1, saw = 2, square = 3; }
namespace filter { constexpr float lp12 = 0, lp24 = 1, hp = 2, bp = 3; }
namespace lfo    { constexpr float sine = 0, triangle = 1; }
namespace mode   { constexpr float mono = 1, legato = 2; }
namespace delay  { constexpr float d8 = 1, d8dot = 2, d4 = 3, d4dot = 4; }

struct Value
{
    Param param;
    float value;
};

struct Preset
{
    const char* name;
    const Value* values;  // 初期値から変える値
    int count;
};

// ノコギリ波2枚を少しずらし、フィルターを EG で開く。レガートで滑らかにつなぎ、浅いビブラート
const Value lead[] = {
    { osc1Level, 0.7f }, { osc2Wave, wave::saw }, { osc2Level, 0.5f }, { osc2Fine, 8 },
    { filterCutoff, 2200 }, { filterResonance, 0.25f }, { filterEnvAmount, 24 },
    { fenvAttack, 0.005f }, { fenvDecay, 0.35f }, { fenvSustain, 0.4f }, { fenvRelease, 0.3f },
    { aenvDecay, 0.2f }, { aenvSustain, 0.8f }, { aenvRelease, 0.25f },
    { voiceMode, mode::legato }, { glide, 0.06f },
    { lfoRate, 5.5f }, { lfoPitch, 0.15f },
    { delayMix, 0.2f }, { reverbMix, 0.2f },
    { drift, 0.3f },
    { filterDrive, 0.2f },
};

// 7枚重ねたノコギリ波を左右いっぱいに広げ、1オクターブ上も重ねる（EDM・トランス）
const Value supersaw[] = {
    { osc1Unison, 7 }, { osc1Detune, 35 }, { osc1Width, 1 }, { osc1Level, 0.8f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Unison, 7 }, { osc2Detune, 22 }, { osc2Width, 1 }, { osc2Level, 0.35f },
    { filterType, filter::lp12 }, { filterCutoff, 9000 }, { filterResonance, 0.1f },
    { aenvAttack, 0.01f }, { aenvSustain, 0.8f }, { aenvRelease, 0.4f },
    { chorusMix, 0.25f }, { delayMix, 0.2f }, { reverbMix, 0.3f },
    { drift, 0.25f },
};

// フィルターが素早く閉じる、弦をはじいたような音（ハウス）
const Value pluck[] = {
    { osc2Wave, wave::square }, { osc2Octave, 1 }, { osc2Level, 0.3f },
    { filterCutoff, 400 }, { filterResonance, 0.3f }, { filterEnvAmount, 48 },
    { fenvAttack, 0.001f }, { fenvDecay, 0.18f }, { fenvSustain, 0 }, { fenvRelease, 0.2f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.4f }, { aenvSustain, 0 }, { aenvRelease, 0.3f },
    { delayMix, 0.25f }, { reverbMix, 0.2f },
    { filterVelocity, 0.3f },
};

// レゾナンスの強いフィルターを短く開閉させ、レガートで滑らせる（テクノ）
const Value acid[] = {
    { osc1Octave, -1 }, { osc1Level, 0.8f },
    { filterCutoff, 300 }, { filterResonance, 0.75f }, { filterEnvAmount, 40 }, { filterKeyTrack, 0.3f },
    { fenvAttack, 0.002f }, { fenvDecay, 0.15f }, { fenvSustain, 0.1f }, { fenvRelease, 0.1f },
    { aenvAttack, 0.002f }, { aenvDecay, 0.2f }, { aenvSustain, 0.6f }, { aenvRelease, 0.08f },
    { voiceMode, mode::legato }, { glide, 0.05f },
    { drive, 0.35f }, { delayMix, 0.15f }, { delayTime, delay::d8dot }, { reverbMix, 0.05f },
    { filterDrive, 0.5f },
};

// こもった厚い本体に、1オクターブ上の三角波を広げて重ねる。フィルターをゆっくり揺らす（アンビエント）
const Value pad[] = {
    { osc1Unison, 5 }, { osc1Detune, 18 }, { osc1Width, 0.9f }, { osc1Level, 0.6f },
    { osc2Wave, wave::triangle }, { osc2Octave, 1 }, { osc2Unison, 3 }, { osc2Detune, 10 }, { osc2Width, 1 },
    { osc2Level, 0.4f },
    { filterType, filter::lp12 }, { filterCutoff, 1800 }, { filterResonance, 0.1f }, { filterEnvAmount, 12 },
    { fenvAttack, 1.5f }, { fenvDecay, 2 }, { fenvSustain, 0.6f }, { fenvRelease, 2 },
    { aenvAttack, 1.2f }, { aenvDecay, 1 }, { aenvSustain, 0.9f }, { aenvRelease, 2.5f },
    { lfoWave, lfo::triangle }, { lfoRate, 0.3f }, { lfoFilter, 6 },
    { chorusMix, 0.4f }, { reverbMix, 0.45f }, { reverbSize, 0.8f },
    { drift, 0.4f },
};

// サイン波とサブで低音を支える。モノで少しだけ滑らせる
const Value subBass[] = {
    { osc1Wave, wave::sine }, { osc1Octave, -1 }, { osc1Level, 0.9f },
    { osc2Wave, wave::triangle }, { osc2Octave, -1 }, { osc2Level, 0.2f },
    { subLevel, 0.5f }, { filterCutoff, 600 }, { filterResonance, 0 },
    { aenvAttack, 0.003f }, { aenvSustain, 0.9f }, { aenvRelease, 0.15f },
    { voiceMode, mode::mono }, { glide, 0.03f }, { reverbMix, 0 },
};

// 矩形波の8bit 風。発音の瞬間に少し上から下ろし、ビブラートをかける
const Value chipLead[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.6f },
    { filterType, filter::lp12 }, { filterCutoff, 12000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.1f }, { aenvSustain, 0.7f }, { aenvRelease, 0.05f },
    { pitchEnvAmount, 3 }, { pitchEnvTime, 0.04f },
    { lfoRate, 6 }, { lfoPitch, 0.3f },
    { voiceMode, mode::mono },
    { delayMix, 0.15f }, { delayTime, delay::d8 }, { reverbMix, 0.05f },
};

// ノイズをバンドパスで細くし、フィルター EG でゆっくり掃き上げる効果音向けの音
const Value noiseSweep[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::bp }, { filterCutoff, 300 }, { filterResonance, 0.5f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 2 }, { fenvDecay, 1 }, { fenvSustain, 1 }, { fenvRelease, 1.5f },
    { aenvAttack, 1.5f }, { aenvSustain, 1 }, { aenvRelease, 1.5f },
    { chorusMix, 0.3f }, { reverbMix, 0.4f }, { reverbSize, 0.8f },
};

// ===== Toniq のパート（パッド・アルペジオ・シグネチャー）向け =====

// 三角波を少し重ね、ゆっくり立ち上げてコーラスで広げる、やわらかいパッド
const Value softPad[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.6f }, { osc1Unison, 3 }, { osc1Detune, 12 }, { osc1Width, 0.8f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Level, 0.25f },
    { filterType, filter::lp12 }, { filterCutoff, 2500 }, { filterResonance, 0.05f },
    { aenvAttack, 0.4f }, { aenvDecay, 0.8f }, { aenvSustain, 0.8f }, { aenvRelease, 2 },
    { chorusMix, 0.5f }, { reverbMix, 0.3f }, { reverbSize, 0.7f },
    { drift, 0.35f },
};

// 弾いた瞬間だけフィルターが開いてすぐ丸くなる、エレピ風の鍵盤。浅いトレモロ
const Value keys[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.7f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Level, 0.3f },
    { filterType, filter::lp12 }, { filterCutoff, 1800 }, { filterResonance, 0.1f }, { filterEnvAmount, 24 },
    { filterKeyTrack, 0.6f },
    { fenvAttack, 0.002f }, { fenvDecay, 0.4f }, { fenvSustain, 0.2f }, { fenvRelease, 0.4f },
    { aenvAttack, 0.003f }, { aenvDecay, 0.9f }, { aenvSustain, 0.2f }, { aenvRelease, 0.5f },
    { lfoRate, 4 }, { lfoAmp, 0.1f },
    { chorusMix, 0.3f }, { reverbMix, 0.2f },
    { drift, 0.2f },
    { filterVelocity, 0.4f },
};

// サインに1オクターブ＋5度上（約3倍）のサインを重ね、長く減衰させる鐘のような音
const Value bell[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.6f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Semi, 7 }, { osc2Level, 0.35f },
    { filterType, filter::lp12 }, { filterCutoff, 9000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 1.4f }, { aenvSustain, 0 }, { aenvRelease, 1.4f },
    { delayMix, 0.15f }, { delayTime, delay::d4 }, { reverbMix, 0.35f }, { reverbSize, 0.7f },
};

// 短く切れる矩形波に、クセのあるレゾナンスのフィルター
const Value blip[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.7f },
    { filterType, filter::lp24 }, { filterCutoff, 300 }, { filterResonance, 0.55f }, { filterEnvAmount, 36 },
    { fenvAttack, 0.001f }, { fenvDecay, 0.08f }, { fenvSustain, 0 }, { fenvRelease, 0.05f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.1f }, { aenvSustain, 0 }, { aenvRelease, 0.05f },
    { delayMix, 0.15f }, { reverbMix, 0.05f },
    { filterDrive, 0.3f },
};

// 厚いノコギリ波を短く切るコードスタブ
const Value stab[] = {
    { osc1Unison, 5 }, { osc1Detune, 25 }, { osc1Width, 1 }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Fine, -8 }, { osc2Level, 0.3f },
    { filterType, filter::lp24 }, { filterCutoff, 2500 }, { filterResonance, 0.2f }, { filterEnvAmount, 24 },
    { fenvAttack, 0.002f }, { fenvDecay, 0.12f }, { fenvSustain, 0 }, { fenvRelease, 0.08f },
    { aenvAttack, 0.002f }, { aenvDecay, 0.15f }, { aenvSustain, 0.1f }, { aenvRelease, 0.08f },
    { reverbMix, 0.2f },
    { drift, 0.2f },
    { filterDrive, 0.2f },
};

// 細かく刻んでも濁らないよう、余韻を短くしたスーパーソウ（トランスゲート）
const Value gateSaw[] = {
    { osc1Unison, 7 }, { osc1Detune, 30 }, { osc1Width, 1 }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Unison, 3 }, { osc2Detune, 20 }, { osc2Level, 0.3f },
    { filterType, filter::lp12 }, { filterCutoff, 5000 }, { filterResonance, 0.1f },
    { aenvAttack, 0.003f }, { aenvDecay, 0.08f }, { aenvSustain, 0.6f }, { aenvRelease, 0.04f },
    { delayMix, 0.15f }, { delayTime, delay::d8dot }, { reverbMix, 0.3f },
    { drift, 0.2f },
};

// レコードのサーッというヒス（ノイズだけ。音の高さによらない）
const Value vinylHiss[] = {
    { osc1Level, 0 }, { noiseLevel, 0.6f },
    { filterType, filter::lp12 }, { filterCutoff, 5000 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { aenvAttack, 0.05f }, { aenvSustain, 1 }, { aenvRelease, 0.05f },
    { reverbMix, 0 }, { master, -30 },
};

// レコードのプチッという音（ハイパスを通したノイズをごく短く）
const Value vinylCrackle[] = {
    { osc1Level, 0 }, { noiseLevel, 1 },
    { filterType, filter::hp }, { filterCutoff, 1800 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.008f }, { aenvSustain, 0 }, { aenvRelease, 0.005f },
    { reverbMix, 0 }, { master, -12 },
};

// ゆっくりうねる風（バンドパスのノイズを遅い LFO で動かす）
const Value wind[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::bp }, { filterCutoff, 400 }, { filterResonance, 0.6f }, { filterKeyTrack, 0 },
    { lfoWave, lfo::sine }, { lfoRate, 0.07f }, { lfoFilter, 18 },
    { aenvAttack, 0.5f }, { aenvSustain, 1 }, { aenvRelease, 0.5f },
    { chorusMix, 0.3f }, { reverbMix, 0.4f }, { reverbSize, 0.8f }, { master, -12 },
};

// ===== Toniq のコードの音色（ChordPlayer.ts の INSTRUMENTS に合わせたもの） =====

// エレピ：弾いた瞬間だけフィルターが開いて丸くなる、長めの減衰。左右に揺れる深めのトレモロ
const Value ePiano[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.7f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Level, 0.35f },
    { filterType, filter::lp12 }, { filterCutoff, 900 }, { filterResonance, 0.1f }, { filterEnvAmount, 30 },
    { filterKeyTrack, 0.6f },
    { fenvAttack, 0.002f }, { fenvDecay, 0.5f }, { fenvSustain, 0.15f }, { fenvRelease, 0.5f },
    { aenvAttack, 0.002f }, { aenvDecay, 2 }, { aenvSustain, 0.25f }, { aenvRelease, 0.8f },
    { lfoRate, 4 }, { lfoAmp, 0.35f },
    { chorusMix, 0.15f }, { reverbMix, 0.2f },
    { drift, 0.2f },
    { filterVelocity, 0.5f },
};

// オルガン：サインを1オクターブ上と下（サブ）に重ねたドローバー風。押している間は減らない。ビブラート＋トレモロ
const Value organ[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.6f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Level, 0.45f },
    { subLevel, 0.3f },
    { filterType, filter::lp12 }, { filterCutoff, 5000 }, { filterResonance, 0 },
    { aenvAttack, 0.005f }, { aenvDecay, 0.05f }, { aenvSustain, 1 }, { aenvRelease, 0.08f },
    { lfoRate, 6 }, { lfoPitch, 0.1f }, { lfoAmp, 0.2f },
    { chorusMix, 0.2f }, { reverbMix, 0.15f },
};

// ストリングス：ずらしたノコギリ波をフィルターでゆっくり開き、ゆっくり立ち上げる
const Value strings[] = {
    { osc1Unison, 3 }, { osc1Detune, 25 }, { osc1Width, 1 }, { osc1Level, 0.6f },
    { osc2Wave, wave::saw }, { osc2Fine, -10 }, { osc2Level, 0.4f },
    { filterType, filter::lp24 }, { filterCutoff, 1200 }, { filterResonance, 0.1f }, { filterEnvAmount, 24 },
    { fenvAttack, 0.8f }, { fenvDecay, 1 }, { fenvSustain, 0.7f }, { fenvRelease, 1.5f },
    { aenvAttack, 0.5f }, { aenvDecay, 0.3f }, { aenvSustain, 0.85f }, { aenvRelease, 2 },
    { chorusMix, 0.4f }, { reverbMix, 0.3f },
    { drift, 0.4f },
};

// スクエア（8bit）：矩形波の和音。広げずに乾いた音のまま
const Value squareChord[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.5f },
    { filterType, filter::lp12 }, { filterCutoff, 6000 }, { filterResonance, 0 },
    { aenvAttack, 0.003f }, { aenvDecay, 0.15f }, { aenvSustain, 0.4f }, { aenvRelease, 0.08f },
    { reverbMix, 0.05f },
};

// ===== Toniq の FX / SE（FxPlayer.ts）向け =====
// 長さが曲のテンポで変わる値（EG の時間など）は、FxPlayer.ts が鳴らすときに上書きする

// ライザーのノイズ：バンドパスのノイズをフィルター EG で掃き上げ、音量もゆっくり上げる
const Value fxRiserNoise[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::bp }, { filterCutoff, 400 }, { filterResonance, 0.3f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 2 }, { fenvSustain, 1 }, { fenvRelease, 0.03f },
    { aenvAttack, 2 }, { aenvSustain, 1 }, { aenvRelease, 0.03f },
    { lfoWave, lfo::sine }, { lfoRate, 2 }, { lfoAmp, 0.2f },
    { chorusMix, 0.5f }, { delayMix, 0.25f }, { delayTime, delay::d8dot }, { reverbMix, 0.2f },
};

// ライザーの音程：重ねたノコギリ波がピッチ EG で2オクターブ下から上がり、フィルターが開く。トレモロ
const Value fxRiserPitch[] = {
    { osc1Unison, 3 }, { osc1Detune, 35 }, { osc1Width, 1 }, { osc1Level, 0.6f },
    { filterType, filter::lp24 }, { filterCutoff, 600 }, { filterResonance, 0.3f }, { filterEnvAmount, 42 },
    { filterKeyTrack, 0 },
    { fenvAttack, 2 }, { fenvSustain, 1 }, { fenvRelease, 0.03f },
    { aenvAttack, 2 }, { aenvSustain, 1 }, { aenvRelease, 0.03f },
    { pitchEnvAmount, -24 }, { pitchEnvTime, 2 },
    { lfoWave, lfo::sine }, { lfoRate, 8 }, { lfoAmp, 0.5f },
    { chorusMix, 0.5f }, { delayMix, 0.25f }, { delayTime, delay::d8dot }, { reverbMix, 0.2f },
};

// インパクトのブーム：低いサインがピッチ EG で沈む。中央に置いたまま広げない
const Value fxBoom[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.9f },
    { filterType, filter::lp12 }, { filterCutoff, 2000 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { aenvAttack, 0.002f }, { aenvDecay, 1.4f }, { aenvSustain, 0 }, { aenvRelease, 0.6f },
    { pitchEnvAmount, 36 }, { pitchEnvTime, 0.25f },
    { drive, 0.25f }, { reverbMix, 0.1f },
};

// インパクトのノイズ：明るさが閉じていくノイズの一撃
const Value fxBurst[] = {
    { osc1Level, 0 }, { noiseLevel, 0.7f },
    { filterType, filter::lp24 }, { filterCutoff, 350 }, { filterResonance, 0.1f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 0.001f }, { fenvDecay, 1.2f }, { fenvSustain, 0 }, { fenvRelease, 0.3f },
    { aenvAttack, 0.001f }, { aenvDecay, 1.2f }, { aenvSustain, 0 }, { aenvRelease, 0.3f },
    { chorusMix, 0.4f }, { delayMix, 0.2f }, { delayTime, delay::d4 }, { reverbMix, 0.3f },
};

// ダウンリフターのノイズ：バンドパスのノイズが下がりながら消えていく
const Value fxDownNoise[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::bp }, { filterCutoff, 250 }, { filterResonance, 0.3f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 0.001f }, { fenvDecay, 2 }, { fenvSustain, 0 }, { fenvRelease, 0.1f },
    { aenvAttack, 0.001f }, { aenvDecay, 2 }, { aenvSustain, 0 }, { aenvRelease, 0.1f },
    { lfoWave, lfo::sine }, { lfoRate, 0.3f }, { lfoAmp, 0.2f },
    { chorusMix, 0.5f }, { delayMix, 0.3f }, { delayTime, delay::d4dot }, { reverbMix, 0.3f },
};

// ダウンリフターの音程：三角波がピッチ EG で3オクターブ下がる
const Value fxDownTone[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.6f },
    { filterType, filter::lp12 }, { filterCutoff, 8000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 1.2f }, { aenvSustain, 0 }, { aenvRelease, 0.1f },
    { pitchEnvAmount, 36 }, { pitchEnvTime, 1.2f },
    { chorusMix, 0.5f }, { delayMix, 0.3f }, { delayTime, delay::d4dot }, { reverbMix, 0.3f },
};

// リバースシンバル：ハイパスの金属的なノイズがふくらみ、ぷつっと切れる
const Value fxReverse[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::hp }, { filterCutoff, 3500 }, { filterResonance, 0.35f }, { filterKeyTrack, 0 },
    { aenvAttack, 1 }, { aenvSustain, 1 }, { aenvRelease, 0.02f },
    { chorusMix, 0.4f }, { delayMix, 0.2f }, { delayTime, delay::d8 }, { delayFeedback, 0.4f }, { reverbMix, 0.2f },
};

// チップSE：乾いた矩形波（駆け上がりは音符で、「ピュン」はピッチ EG を上書きして鳴らす）
const Value fxChip[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.5f },
    { filterType, filter::lp12 }, { filterCutoff, 12000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.1f }, { aenvSustain, 0.8f }, { aenvRelease, 0.01f },
    { delayMix, 0.3f }, { delayTime, delay::d8dot }, { delayFeedback, 0.4f }, { reverbMix, 0.05f },
};

// ===== Toniq のベース（bass_params.json のジャンルごとの音色に合わせたもの） =====
// どれもモノ（音ごとに EG を掛け直す）で、空間系のエフェクトはかけない（低音がぼやけないように）

// ソウベース：ノコギリ波に1オクターブ下を重ね、弾いた瞬間だけフィルターが開く（EDM・ゲームBGM）
const Value sawBass[] = {
    { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, -1 }, { osc2Level, 0.5f },
    { filterType, filter::lp24 }, { filterCutoff, 200 }, { filterResonance, 0.3f }, { filterEnvAmount, 36 },
    { filterKeyTrack, 0.3f },
    { fenvAttack, 0.005f }, { fenvDecay, 0.15f }, { fenvSustain, 0.3f }, { fenvRelease, 0.1f },
    { aenvAttack, 0.005f }, { aenvDecay, 0.15f }, { aenvSustain, 0.6f }, { aenvRelease, 0.1f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { filterDrive, 0.3f },
};

// スクエアベース：矩形波にクセのあるフィルター。短く切る（テクノ・ハウス）
const Value squareBass[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.7f },
    { subLevel, 0.3f },
    { filterType, filter::lp24 }, { filterCutoff, 150 }, { filterResonance, 0.4f }, { filterEnvAmount, 42 },
    { filterKeyTrack, 0.3f },
    { fenvAttack, 0.002f }, { fenvDecay, 0.1f }, { fenvSustain, 0.1f }, { fenvRelease, 0.06f },
    { aenvAttack, 0.002f }, { aenvDecay, 0.15f }, { aenvSustain, 0.3f }, { aenvRelease, 0.06f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { filterDrive, 0.4f },
};

// ローリングベース：ノコギリ波を短くはじく、16分で転がすベース（トランス）
const Value rollingBass[] = {
    { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, -1 }, { osc2Level, 0.4f },
    { filterType, filter::lp24 }, { filterCutoff, 160 }, { filterResonance, 0.3f }, { filterEnvAmount, 36 },
    { filterKeyTrack, 0.3f },
    { fenvAttack, 0.003f }, { fenvDecay, 0.08f }, { fenvSustain, 0.15f }, { fenvRelease, 0.04f },
    { aenvAttack, 0.003f }, { aenvDecay, 0.09f }, { aenvSustain, 0.25f }, { aenvRelease, 0.04f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { filterDrive, 0.3f },
};

// チップベース：三角波のまま（ファミコンの三角波チャンネル風。8bit）
const Value chipBass[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.8f },
    { filterType, filter::lp12 }, { filterCutoff, 12000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.05f }, { aenvSustain, 0.9f }, { aenvRelease, 0.02f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
};

// ソフトベース：サインに三角波を薄く重ね、ゆっくり立ち上がって長く残る（アンビエント）
const Value softBass[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.8f },
    { osc2Wave, wave::triangle }, { osc2Level, 0.2f },
    { filterType, filter::lp12 }, { filterCutoff, 800 }, { filterResonance, 0 },
    { aenvAttack, 0.3f }, { aenvDecay, 1 }, { aenvSustain, 0.8f }, { aenvRelease, 1.5f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
};

template <std::size_t N>
constexpr Preset preset (const char* name, const Value (&values)[N]) { return { name, values, (int) N }; }

const Preset presets[] = {
    { "初期化", nullptr, 0 },
    preset ("シンセリード", lead),
    preset ("スーパーソウ", supersaw),
    preset ("プラック", pluck),
    preset ("アシッド", acid),
    preset ("ワイドパッド", pad),
    preset ("サブベース", subBass),
    preset ("チップリード", chipLead),
    preset ("ノイズスイープ", noiseSweep),
    // ここから Toniq のパート向け（Toniq は名前で探すので、名前を変えるときは src/engine/Grow.ts もそろえる）
    preset ("ソフトパッド", softPad),
    preset ("キーズ", keys),
    preset ("ベル", bell),
    preset ("ブリップ", blip),
    preset ("スタブ", stab),
    preset ("ゲートソウ", gateSaw),
    preset ("レコードヒス", vinylHiss),
    preset ("レコードプチ", vinylCrackle),
    preset ("ウィンド", wind),
    preset ("エレピ", ePiano),
    preset ("オルガン", organ),
    preset ("ストリングス", strings),
    preset ("スクエア", squareChord),
    // FX / SE 向け（FxPlayer.ts が名前で探す）
    preset ("FX ライザーノイズ", fxRiserNoise),
    preset ("FX ライザーピッチ", fxRiserPitch),
    preset ("FX ブーム", fxBoom),
    preset ("FX バースト", fxBurst),
    preset ("FX ダウンノイズ", fxDownNoise),
    preset ("FX ダウントーン", fxDownTone),
    preset ("FX リバース", fxReverse),
    preset ("FX チップ", fxChip),
    // ベース向け（Toniq は名前で探す。src/engine/Grow.ts の GROW_STANDARD）
    preset ("ソウベース", sawBass),
    preset ("スクエアベース", squareBass),
    preset ("ローリングベース", rollingBass),
    preset ("チップベース", chipBass),
    preset ("ソフトベース", softBass),
};

constexpr int presetCount = (int) (sizeof (presets) / sizeof (presets[0]));
} // namespace

int numPresets()
{
    return presetCount;
}

const char* presetName (int index)
{
    return index >= 0 && index < presetCount ? presets[index].name : "";
}

void presetValues (int index, float* values)
{
    defaultValues (values);
    if (index < 0 || index >= presetCount) return;
    const auto& p = presets[index];
    for (int i = 0; i < p.count; ++i)
        values[p.values[i].param] = clampParam (p.values[i].param, p.values[i].value);
}
} // namespace grow
