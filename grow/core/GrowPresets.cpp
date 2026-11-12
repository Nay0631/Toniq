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
namespace sync   { constexpr float n4 = 3, n8 = 4, n16 = 5; }
namespace src    { constexpr float eg2 = 2, lfo1 = 3, lfo2 = 4, fenv = 5; }
namespace dest   { constexpr float cutoff = 2, amp = 4, lfo1Rate = 7; }
namespace lfoW   { constexpr float saw = 2, square = 3; }

// 各プリセットの master（出力の大きさ）は、聞こえる大きさ（モーメンタリーラウドネスの最大）が -18 LUFS になるようにそろえた値
// （npm run grow:render -- --suggest で測る。FX は組み合わせる音どうしの差を残した目標。ヒス・プチプチはわざと小さい）。
// 音色を変えたら測り直して、提案の値に書き換える
struct Value
{
    Param param;
    float value;
};

struct Preset
{
    const char* id;       // 変えない ID（Toniq は曲にこれを保存し、これで探す）
    const char* name;
    const Value* values;  // 初期値から変える値
    int count;
};

// ノコギリ波を3枚重ねて少し広げ、もう1枚を少しずらす。フィルターを EG で開く。レガートで滑らかにつなぎ、
// 伸ばすほど深くなるビブラート
const Value lead[] = {
    { osc1Level, 0.7f }, { osc1Unison, 3 }, { osc1Detune, 12 }, { osc1Width, 0.5f }, { osc2Wave, wave::saw }, { osc2Level, 0.5f }, { osc2Fine, 8 },
    { filterCutoff, 2200 }, { filterResonance, 0.25f }, { filterEnvAmount, 24 },
    { fenvAttack, 0.005f }, { fenvDecay, 0.35f }, { fenvSustain, 0.4f }, { fenvRelease, 0.3f },
    { aenvDecay, 0.2f }, { aenvSustain, 0.8f }, { aenvRelease, 0.25f },
    { voiceMode, mode::legato }, { glide, 0.06f },
    { lfoRate, 5.5f }, { lfoPitch, 0.2f }, { lfoFade, 0.4f },
    { delayMix, 0.2f }, { reverbMix, 0.2f },
    { drift, 0.3f },
    { filterDrive, 0.2f },
    { master, -3.5f },
};

// 7枚重ねたノコギリ波を左右いっぱいに広げ、1オクターブ上も重ねる（EDM・トランス）
const Value supersaw[] = {
    { osc1Unison, 7 }, { osc1Detune, 35 }, { osc1Width, 1 }, { osc1Level, 0.8f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Unison, 7 }, { osc2Detune, 22 }, { osc2Width, 1 }, { osc2Level, 0.35f },
    { filterType, filter::lp12 }, { filterCutoff, 9000 }, { filterResonance, 0.1f },
    { aenvAttack, 0.01f }, { aenvSustain, 0.8f }, { aenvRelease, 0.8f },
    { chorusMix, 0.25f }, { delayMix, 0.2f }, { reverbMix, 0.3f },
    { drift, 0.25f },
    { filterVelocity, 0.3f },
    { master, -7.6f },
};

// フィルターが素早く閉じる、弦をはじいたような音（ハウス）
const Value pluck[] = {
    { osc2Wave, wave::square }, { osc2Octave, 1 }, { osc2Level, 0.3f },
    { filterCutoff, 400 }, { filterResonance, 0.3f }, { filterEnvAmount, 48 },
    { fenvAttack, 0.001f }, { fenvDecay, 0.18f }, { fenvSustain, 0 }, { fenvRelease, 0.2f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.4f }, { aenvSustain, 0 }, { aenvRelease, 0.3f },
    { delayMix, 0.25f }, { reverbMix, 0.2f },
    { filterVelocity, 0.3f },
    { pitchEnvAmount, 12 },
    { pitchEnvTime, 0.025f },
    { master, 1.6f },
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
    { master, -7.3f },
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
    { master, -6.3f },
};

// サイン波とサブで低音を支える。モノで少しだけ滑らせる
const Value subBass[] = {
    { osc1Wave, wave::sine }, { osc1Octave, -1 }, { osc1Level, 0.9f },
    { osc2Wave, wave::triangle }, { osc2Octave, -1 }, { osc2Level, 0.2f },
    { subLevel, 0.5f }, { filterCutoff, 600 }, { filterResonance, 0 },
    { aenvAttack, 0.003f }, { aenvSustain, 0.9f }, { aenvRelease, 0.15f },
    { voiceMode, mode::mono }, { glide, 0.03f }, { reverbMix, 0 },
    { master, -4.5f },
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
    { osc1PulseWidth, 0.25f },
    { master, -1.4f },
};

// ノイズをバンドパスで細くし、フィルター EG でゆっくり掃き上げる効果音向けの音
const Value noiseSweep[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::bp }, { filterCutoff, 300 }, { filterResonance, 0.5f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 2 }, { fenvDecay, 1 }, { fenvSustain, 1 }, { fenvRelease, 1.5f },
    { aenvAttack, 1.5f }, { aenvSustain, 1 }, { aenvRelease, 1.5f },
    { chorusMix, 0.3f }, { reverbMix, 0.4f }, { reverbSize, 0.8f },
    { master, -2.1f },
};

// ===== Toniq のパート（パッド・アルペジオ・シグネチャー）向け =====

// 三角波を少し重ね、ゆっくり立ち上げてコーラスで広げる、やわらかいパッド。フィルター EG でゆっくり明るくなる
const Value softPad[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.6f }, { osc1Unison, 3 }, { osc1Detune, 12 }, { osc1Width, 0.8f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Level, 0.25f },
    { filterType, filter::lp12 }, { filterCutoff, 1600 }, { filterResonance, 0.05f }, { filterEnvAmount, 10 },
    { fenvAttack, 1.2f }, { fenvDecay, 2 }, { fenvSustain, 0.6f }, { fenvRelease, 2 },
    { aenvAttack, 0.4f }, { aenvDecay, 0.8f }, { aenvSustain, 0.8f }, { aenvRelease, 2 },
    { chorusMix, 0.5f }, { reverbMix, 0.3f }, { reverbSize, 0.7f },
    { drift, 0.35f },
    { master, -3.5f },
};

// キーズ：2:1 の FM（OSC 2 は1オクターブ上のサイン）。EG 2 で FM の量を減らし、弾いた瞬間だけ倍音が出る。浅いトレモロ
const Value keys[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.8f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Level, 0 },
    { fmAmount, 0.02f },
    { eg2Attack, 0.001f }, { eg2Decay, 0.4f }, { eg2Sustain, 0 }, { eg2Release, 0.3f },
    { mod1Source, 2 }, { mod1Dest, 5 }, { mod1Amount, 0.25f },
    { mod2Source, 1 }, { mod2Dest, 5 }, { mod2Amount, 0.1f },
    { filterType, filter::lp12 }, { filterCutoff, 6000 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { aenvAttack, 0.003f }, { aenvDecay, 0.9f }, { aenvSustain, 0.2f }, { aenvRelease, 0.5f },
    { lfoRate, 4 }, { lfoAmp, 0.1f },
    { chorusMix, 0.3f }, { reverbMix, 0.2f },
    { drift, 0.2f },
    { master, -2.9f },
};

// サインに1オクターブ＋5度上（約3倍）のサインを重ね、長く減衰させる鐘のような音
const Value bell[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.6f },
    { osc2Wave, wave::sine }, { osc2Octave, 1 }, { osc2Semi, 10 }, { osc2Level, 0.08f },
    { filterType, filter::lp12 }, { filterCutoff, 9000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 1.4f }, { aenvSustain, 0 }, { aenvRelease, 1.4f },
    { delayMix, 0.15f }, { delayTime, delay::d4 }, { reverbMix, 0.35f }, { reverbSize, 0.7f },
    { osc2Fine, -31 },
    { fmAmount, 0.3f },
    { ringAmount, 0.15f },
    { master, -8.5f },
};

// 短く切れる矩形波に、クセのあるレゾナンスのフィルター
const Value blip[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.7f },
    { filterType, filter::lp24 }, { filterCutoff, 300 }, { filterResonance, 0.55f }, { filterEnvAmount, 36 },
    { fenvAttack, 0.001f }, { fenvDecay, 0.08f }, { fenvSustain, 0 }, { fenvRelease, 0.05f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.1f }, { aenvSustain, 0 }, { aenvRelease, 0.05f },
    { delayMix, 0.15f }, { reverbMix, 0.05f },
    { filterDrive, 0.3f },
    { pitchEnvAmount, 12 },
    { pitchEnvTime, 0.015f },
    { master, 4 },
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
    { pitchEnvAmount, 12 },
    { pitchEnvTime, 0.02f },
    { filterVelocity, 0.3f },
    { master, 3 },
};

// 細かく刻んでも濁らないよう、余韻を短くしたスーパーソウ（トランスゲート）
const Value gateSaw[] = {
    { osc1Unison, 7 }, { osc1Detune, 30 }, { osc1Width, 1 }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Unison, 3 }, { osc2Detune, 20 }, { osc2Level, 0.3f },
    { filterType, filter::lp12 }, { filterCutoff, 5000 }, { filterResonance, 0.1f },
    { aenvAttack, 0.003f }, { aenvDecay, 0.08f }, { aenvSustain, 0.6f }, { aenvRelease, 0.04f },
    { delayMix, 0.15f }, { delayTime, delay::d8dot }, { reverbMix, 0.3f },
    { drift, 0.2f },
    { filterVelocity, 0.2f },
    { master, -5.1f },
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
    { chorusMix, 0.3f }, { reverbMix, 0.4f }, { reverbSize, 0.8f }, { master, 3.3f },
};

// ===== Toniq のコードの音色（ChordPlayer.ts の INSTRUMENTS に合わせたもの） =====

// エレピ：1:1 の FM（OSC 2 のサインで OSC 1 のサインを変調）。EG 2 で FM の量を減らし、弾いた瞬間だけ明るい。
// 強く弾くほど FM が深くなる。左右に揺れる深めのトレモロ
const Value ePiano[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.8f },
    { osc2Wave, wave::sine }, { osc2Level, 0 },
    { fmAmount, 0.04f },
    { eg2Attack, 0.001f }, { eg2Decay, 0.7f }, { eg2Sustain, 0 }, { eg2Release, 0.3f },
    { mod1Source, 2 }, { mod1Dest, 5 }, { mod1Amount, 0.3f },
    { mod2Source, 1 }, { mod2Dest, 5 }, { mod2Amount, 0.15f },
    { filterType, filter::lp12 }, { filterCutoff, 7000 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { aenvAttack, 0.002f }, { aenvDecay, 2 }, { aenvSustain, 0.25f }, { aenvRelease, 0.8f },
    { lfoRate, 4 }, { lfoAmp, 0.35f },
    { chorusMix, 0.15f }, { reverbMix, 0.2f },
    { drift, 0.2f },
    { master, -5.3f },
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
    { master, -7.7f },
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
    { master, -4.2f },
};

// スクエア（8bit）：矩形波の和音。広げずに乾いた音のまま
const Value squareChord[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.5f },
    { filterType, filter::lp12 }, { filterCutoff, 6000 }, { filterResonance, 0 },
    { aenvAttack, 0.003f }, { aenvDecay, 0.15f }, { aenvSustain, 0.4f }, { aenvRelease, 0.08f },
    { reverbMix, 0.05f },
    { osc1PulseWidth, 0.25f },
    { master, -0.5f },
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
    { lfoWave, lfo::sine }, { lfoRate, 1.5f }, { lfoAmp, 0.3f },
    { mod1Source, src::fenv }, { mod1Dest, dest::lfo1Rate }, { mod1Amount, 0.6f },
    { chorusMix, 0.5f }, { delayMix, 0.25f }, { delayTime, delay::d8dot }, { reverbMix, 0.2f },
    { master, 4.6f },
};

// ライザーの音程：7枚重ねたノコギリ波がピッチ EG で2オクターブ下から上がり、フィルターが開く。
// 1オクターブ上とのリングで倍音を足し、トレモロが加速する
const Value fxRiserPitch[] = {
    { osc1Unison, 7 }, { osc1Detune, 35 }, { osc1Width, 1 }, { osc1Level, 1 },
    { filterType, filter::lp24 }, { filterCutoff, 600 }, { filterResonance, 0.3f }, { filterEnvAmount, 42 },
    { filterKeyTrack, 0 },
    { fenvAttack, 2 }, { fenvSustain, 1 }, { fenvRelease, 0.03f },
    { aenvAttack, 2 }, { aenvSustain, 1 }, { aenvRelease, 0.03f },
    { pitchEnvAmount, -24 }, { pitchEnvTime, 2 },
    { lfoWave, lfo::sine }, { lfoRate, 2 }, { lfoAmp, 0.5f },
    { mod1Source, src::fenv }, { mod1Dest, dest::lfo1Rate }, { mod1Amount, 0.5f },
    { chorusMix, 0.5f }, { delayMix, 0.25f }, { delayTime, delay::d8dot }, { reverbMix, 0.2f },
    { osc2Octave, 1 },
    { ringAmount, 0.7f },
    { pitchEnvCurve, 1 },
    { master, 1.9f },
};

// インパクトのブーム：低いサインがピッチ EG で沈む。中央に置いたまま広げない
const Value fxBoom[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.9f },
    { filterType, filter::lp12 }, { filterCutoff, 2000 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { aenvAttack, 0.002f }, { aenvDecay, 1.4f }, { aenvSustain, 0 }, { aenvRelease, 0.6f },
    { pitchEnvAmount, 36 }, { pitchEnvTime, 0.25f },
    { drive, 0.25f }, { reverbMix, 0.1f },
    { master, -10.8f },
};

// インパクトのノイズ：明るさが閉じていくノイズの一撃
const Value fxBurst[] = {
    { osc1Level, 0 }, { noiseLevel, 1 },
    { filterType, filter::lp24 }, { filterCutoff, 350 }, { filterResonance, 0.1f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 0.001f }, { fenvDecay, 1.2f }, { fenvSustain, 0 }, { fenvRelease, 0.3f },
    { aenvAttack, 0.001f }, { aenvDecay, 1.2f }, { aenvSustain, 0 }, { aenvRelease, 0.3f },
    { chorusMix, 0.4f }, { delayMix, 0.2f }, { delayTime, delay::d4 }, { reverbMix, 0.3f },
    { master, 4.8f },
};

// ダウンリフターのノイズ：バンドパスのノイズが下がりながら消えていく
const Value fxDownNoise[] = {
    { osc1Level, 0 }, { noiseLevel, 1 },
    { filterType, filter::bp }, { filterCutoff, 250 }, { filterResonance, 0.5f }, { filterEnvAmount, 48 },
    { filterKeyTrack, 0 },
    { fenvAttack, 0.001f }, { fenvDecay, 2 }, { fenvSustain, 0 }, { fenvRelease, 0.1f },
    { aenvAttack, 0.001f }, { aenvDecay, 2 }, { aenvSustain, 0 }, { aenvRelease, 0.1f },
    { lfoWave, lfo::sine }, { lfoRate, 0.3f }, { lfoAmp, 0.2f },
    { chorusMix, 0.3f }, { delayMix, 0.3f }, { delayTime, delay::d4dot }, { reverbMix, 0.3f },
    { master, 2.7f },
};

// ダウンリフターの音程：三角波がピッチ EG で3オクターブ下がる
const Value fxDownTone[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.6f },
    { filterType, filter::lp12 }, { filterCutoff, 8000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 1.2f }, { aenvSustain, 0 }, { aenvRelease, 0.1f },
    { pitchEnvAmount, 36 }, { pitchEnvTime, 1.2f },
    { chorusMix, 0.5f }, { delayMix, 0.3f }, { delayTime, delay::d4dot }, { reverbMix, 0.3f },
    { pitchEnvCurve, 1 },
    { master, 5.3f },
};

// リバースシンバル：ハイパスの金属的なノイズがふくらみ、ぷつっと切れる
const Value fxReverse[] = {
    { osc1Level, 0 }, { noiseLevel, 0.8f },
    { filterType, filter::hp }, { filterCutoff, 3500 }, { filterResonance, 0.35f }, { filterKeyTrack, 0 },
    { aenvAttack, 1 }, { aenvSustain, 1 }, { aenvRelease, 0.02f },
    { chorusMix, 0.4f }, { delayMix, 0.2f }, { delayTime, delay::d8 }, { delayFeedback, 0.4f }, { reverbMix, 0.2f },
    { master, -3.2f },
};

// チップSE：乾いた矩形波（駆け上がりは音符で、「ピュン」はピッチ EG を上書きして鳴らす）
const Value fxChip[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.5f },
    { filterType, filter::lp12 }, { filterCutoff, 12000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.1f }, { aenvSustain, 0.8f }, { aenvRelease, 0.01f },
    { delayMix, 0.3f }, { delayTime, delay::d8dot }, { delayFeedback, 0.4f }, { reverbMix, 0.05f },
    { osc1PulseWidth, 0.25f },
    { master, 0.4f },
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
    { pitchEnvAmount, 12 },
    { pitchEnvTime, 0.02f },
    { master, 1.9f },
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
    { pitchEnvAmount, 12 },
    { pitchEnvTime, 0.02f },
    { master, 4.6f },
};

// ローリングベース：ノコギリ波を短くはじく、16分で転がすベース（トランス）
const Value rollingBass[] = {
    { osc1Level, 1 },
    { osc2Wave, wave::saw }, { osc2Octave, -1 }, { osc2Level, 0.6f },
    { filterType, filter::lp24 }, { filterCutoff, 220 }, { filterResonance, 0.3f }, { filterEnvAmount, 36 },
    { filterKeyTrack, 0.3f },
    { fenvAttack, 0.003f }, { fenvDecay, 0.08f }, { fenvSustain, 0.15f }, { fenvRelease, 0.04f },
    { aenvAttack, 0.003f }, { aenvDecay, 0.09f }, { aenvSustain, 0.25f }, { aenvRelease, 0.04f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { filterDrive, 0.3f },
    { subLevel, 0.3f },
    { pitchEnvAmount, 12 },
    { pitchEnvTime, 0.015f },
    { master, 5.6f },
};

// チップベース：三角波のまま（ファミコンの三角波チャンネル風。8bit）
const Value chipBass[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.8f },
    { filterType, filter::lp12 }, { filterCutoff, 12000 }, { filterResonance, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.05f }, { aenvSustain, 0.9f }, { aenvRelease, 0.02f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { master, -0.3f },
};

// ソフトベース：サインに三角波を薄く重ね、ゆっくり立ち上がって長く残る（アンビエント）
const Value softBass[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.8f },
    { osc2Wave, wave::triangle }, { osc2Level, 0.2f },
    { filterType, filter::lp12 }, { filterCutoff, 800 }, { filterResonance, 0 },
    { aenvAttack, 0.3f }, { aenvDecay, 1 }, { aenvSustain, 0.8f }, { aenvRelease, 1.5f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { master, -2.8f },
};

// ブラス：ノコギリ波をユニゾンで重ね、1オクターブ上を薄く足す。フィルターがゆっくり開いてふくらみ、ビブラートで歌わせる
const Value brass[] = {
    { osc1Unison, 3 }, { osc1Detune, 18 }, { osc1Width, 0.7f }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Level, 0.3f },
    { filterType, filter::lp24 }, { filterCutoff, 800 }, { filterResonance, 0.15f }, { filterEnvAmount, 30 },
    { fenvAttack, 0.06f }, { fenvDecay, 0.4f }, { fenvSustain, 0.5f }, { fenvRelease, 0.3f },
    { aenvAttack, 0.04f }, { aenvDecay, 0.2f }, { aenvSustain, 0.85f }, { aenvRelease, 0.25f },
    { lfoWave, lfo::sine }, { lfoRate, 5.5f }, { lfoPitch, 0.25f }, { lfoFilter, 1.5f },
    { filterVelocity, 0.4f }, { drift, 0.2f },
    { reverbMix, 0.25f },
    { lfoFade, 0.5f },
    { master, -2.8f },
};

// シンクリード：OSC 2 を OSC 1 の周期で頭に戻す（ハードシンク）。OSC 2 を5度上げて、倍音の強い鋭い音にする
const Value syncLead[] = {
    { osc1Level, 0.25f },
    { osc2Wave, wave::saw }, { osc2Semi, 7 }, { osc2Level, 0.7f },
    { hardSync, 1 },
    { filterType, filter::lp24 }, { filterCutoff, 3000 }, { filterResonance, 0.15f }, { filterEnvAmount, 18 },
    { fenvAttack, 0.005f }, { fenvDecay, 0.3f }, { fenvSustain, 0.5f }, { fenvRelease, 0.3f },
    { aenvAttack, 0.005f }, { aenvDecay, 0.2f }, { aenvSustain, 0.8f }, { aenvRelease, 0.25f },
    { voiceMode, mode::legato }, { glide, 0.05f },
    { lfoRate, 5.5f }, { lfoPitch, 0.12f },
    { drift, 0.2f }, { delayMix, 0.2f }, { reverbMix, 0.2f },
    { eg2Decay, 0.5f },
    { eg2Sustain, 0 },
    { mod1Source, 2 },
    { mod1Dest, 1 },
    { mod1Amount, 0.5f },
    { master, -1.9f },
};

// ===== sleepfreaks のシンセレシピを参考にした音色 =====

// ハードパッド（ジャキジャキとしたコードパッド）：重ねたノコギリ波をハイパスで低域を削って明るくし、
// 1オクターブ下の OSC 2 はフィルターを通さず素の音で支える。ノイズを薄く足し、広く響かせる
const Value hardPad[] = {
    { osc1Unison, 5 }, { osc1Detune, 18 }, { osc1Width, 1 }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, -1 }, { osc2Fine, 6 }, { osc2Level, 0.25f },
    { osc2Direct, 1 },
    { noiseLevel, 0.04f },
    { filterType, filter::hp }, { filterCutoff, 350 }, { filterResonance, 0.1f }, { filterKeyTrack, 0.3f },
    { aenvAttack, 0.01f }, { aenvDecay, 0.4f }, { aenvSustain, 0.75f }, { aenvRelease, 0.6f },
    { chorusMix, 0.2f }, { delayMix, 0.15f }, { delayTime, delay::d8dot }, { reverbMix, 0.35f }, { reverbSize, 0.6f },
    { drift, 0.25f },
    { master, -5.1f },
};

// ゲートパッド（途切れながら変化するPAD）：音量を 1/16 の矩形の LFO で刻み、LFO 2 でフィルターをゆっくり動かす
const Value gatePad[] = {
    { osc1Unison, 5 }, { osc1Detune, 22 }, { osc1Width, 1 }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Level, 0.25f },
    { filterType, filter::lp24 }, { filterCutoff, 1500 }, { filterResonance, 0.2f },
    { aenvAttack, 0.05f }, { aenvSustain, 1 }, { aenvRelease, 0.5f },
    { lfoWave, lfoW::square }, { lfoSync, sync::n16 }, { lfoAmp, 0.9f }, { lfoRetrigger, 1 },
    { lfo2Wave, lfo::triangle }, { lfo2Rate, 0.15f },
    { mod1Source, src::lfo2 }, { mod1Dest, dest::cutoff }, { mod1Amount, 0.4f },
    { chorusMix, 0.2f }, { delayMix, 0.2f }, { delayTime, delay::d8dot }, { reverbMix, 0.3f },
    { drift, 0.2f },
    { master, -3.7f },
};

// ファットベース（ブリブリしたベース）：ノコギリ波を重ね、1オクターブ下のノコギリ波で厚くする。押している間は減らさない。
// 低音がぼやけないよう広がりは控えめに。レガートで少し滑らせる
const Value fatBass[] = {
    { osc1Unison, 5 }, { osc1Detune, 20 }, { osc1Width, 0.4f }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, -1 }, { osc2Level, 0.6f },
    { filterType, filter::lp24 }, { filterCutoff, 900 }, { filterResonance, 0.15f }, { filterEnvAmount, 18 },
    { filterKeyTrack, 0.3f },
    { fenvAttack, 0.003f }, { fenvDecay, 0.25f }, { fenvSustain, 0.3f }, { fenvRelease, 0.1f },
    { aenvAttack, 0.003f }, { aenvSustain, 1 }, { aenvRelease, 0.08f },
    { voiceMode, mode::legato }, { glide, 0.06f }, { reverbMix, 0 },
    { filterDrive, 0.3f }, { drive, 0.15f },
    { master, -10.9f },
};

// パルスベース（パルス波によるバキバキベース）：細いパルス波を重ね、同じ高さのサインの FM（位相）で倍音を足し、歪ませる。
// 弾いた瞬間だけ1オクターブ上から下ろしてアタックを出す
const Value pulseBass[] = {
    { osc1Wave, wave::square }, { osc1PulseWidth, 0.2f }, { osc1Unison, 3 }, { osc1Detune, 12 }, { osc1Width, 0.4f },
    { osc1Level, 0.7f },
    { osc2Wave, wave::sine }, { osc2Level, 0 },
    { fmAmount, 0.12f },
    { subLevel, 0.35f },
    { lfoRate, 0.4f }, { lfoPulseWidth, 0.1f },
    { filterType, filter::lp24 }, { filterCutoff, 1800 }, { filterResonance, 0.1f }, { filterEnvAmount, 12 },
    { fenvAttack, 0.002f }, { fenvDecay, 0.15f }, { fenvSustain, 0.4f }, { fenvRelease, 0.08f },
    { aenvAttack, 0.002f }, { aenvSustain, 1 }, { aenvRelease, 0.06f },
    { voiceMode, mode::mono }, { reverbMix, 0 },
    { drive, 0.35f },
    { pitchEnvAmount, 12 }, { pitchEnvTime, 0.015f },
    { master, -13.6f },
};

// ワブルベース：カットオフを 1/8 のテンポ同期の LFO で開閉する（発音ごとに頭から）。レゾナンスを強めにして歪ませる
const Value wobbleBass[] = {
    { osc1Unison, 3 }, { osc1Detune, 15 }, { osc1Width, 0.3f }, { osc1Level, 0.7f },
    { osc2Wave, wave::square }, { osc2Octave, -1 }, { osc2Level, 0.5f },
    { filterType, filter::lp24 }, { filterCutoff, 180 }, { filterResonance, 0.45f }, { filterKeyTrack, 0.3f },
    { filterDrive, 0.5f },
    { lfoWave, lfo::sine }, { lfoSync, sync::n8 }, { lfoRetrigger, 1 }, { lfoFilter, 40 },
    { aenvAttack, 0.003f }, { aenvSustain, 1 }, { aenvRelease, 0.08f },
    { voiceMode, mode::legato }, { glide, 0.05f }, { reverbMix, 0 },
    { drive, 0.3f },
    { master, -10.1f },
};

// トランスリード：7枚重ねたノコギリ波に1オクターブ上を重ね、レガートで滑らせる。
// 弾いた瞬間にフィルターが開き、伸ばすと深くなるビブラート。付点8分のディレイで広げる
const Value tranceLead[] = {
    { osc1Unison, 7 }, { osc1Detune, 25 }, { osc1Width, 0.8f }, { osc1Level, 0.7f },
    { osc2Wave, wave::saw }, { osc2Octave, 1 }, { osc2Unison, 3 }, { osc2Detune, 15 }, { osc2Width, 1 }, { osc2Level, 0.3f },
    { filterType, filter::lp24 }, { filterCutoff, 3000 }, { filterResonance, 0.15f }, { filterEnvAmount, 18 },
    { fenvAttack, 0.003f }, { fenvDecay, 0.4f }, { fenvSustain, 0.6f }, { fenvRelease, 0.3f },
    { aenvAttack, 0.005f }, { aenvSustain, 0.9f }, { aenvRelease, 0.3f },
    { voiceMode, mode::legato }, { glide, 0.08f },
    { lfoRate, 5.5f }, { lfoPitch, 0.25f }, { lfoFade, 0.5f },
    { delayMix, 0.3f }, { delayTime, delay::d8dot }, { delayFeedback, 0.35f }, { reverbMix, 0.3f },
    { drift, 0.2f }, { filterVelocity, 0.3f },
    { master, -3.9f },
};

// 加速SE（加速する効果音）：矩形波の高さを LFO で上下させ、EG 2 でその LFO を加速させる
const Value accelSe[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.5f },
    { filterType, filter::lp12 }, { filterCutoff, 8000 }, { filterResonance, 0 },
    { aenvAttack, 0.003f }, { aenvSustain, 1 }, { aenvRelease, 0.1f },
    { lfoWave, lfoW::square }, { lfoRate, 3 }, { lfoPitch, 7 }, { lfoRetrigger, 1 },
    { eg2Attack, 2 }, { eg2Sustain, 1 }, { eg2Release, 0.1f },
    { mod1Source, src::eg2 }, { mod1Dest, dest::lfo1Rate }, { mod1Amount, 0.75f },
    { delayMix, 0.2f }, { delayTime, delay::d8dot }, { reverbMix, 0.15f },
    { master, -4.4f },
};

// ===== ドラム（Toniq のドラムの音源「grow」。src/engine/SynthFactory.ts の GROW_DRUMS が ID で探す） =====
// 1台で1つの打楽器。どれもサスティン 0 で、押したままでもディケイで鳴り終わる（消音の合図は要らない）。
// 同じ高さを続けて鳴らすと前の音は余韻（リリース）になる。強さで音量がそのまま変わる（ベロシティ 1）。
// 空間系はかけない（Toniq ではマスターのリバーブ送りで響きを付ける）。音の高さ・長さはジャンルごとに Toniq が上書きする。
// master は聞こえる大きさではなく、強さ 1 のピークが -6dB 前後（出力段のソフトクリップの手前）になるようにした値
// （npm run grow:render -- --suggest のドラムの提案。Toniq は SynthFactory.ts の GROW_TRIM_DB でほかのドラムの音源とそろえる）

// キック：サインがピッチ EG で上から沈む。ノイズはフィルター EG で頭だけ通してクリックにする
// （C1 前後で鳴らす。フィルターは低く閉じているので、あとに残るのは本体のサインだけ）
const Value drumKick[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.9f }, { noiseLevel, 0.12f },
    { filterType, filter::lp12 }, { filterCutoff, 180 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { filterEnvAmount, 42 }, { fenvAttack, 0.001f }, { fenvDecay, 0.015f }, { fenvSustain, 0 }, { fenvRelease, 0.02f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.38f }, { aenvSustain, 0 }, { aenvRelease, 0.05f },
    { pitchEnvAmount, 28 }, { pitchEnvTime, 0.08f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 5.5f },
};

// スネア：胴鳴り（三角波。少し上から下がる）はフィルターを通さず、響き線（ノイズ）はバンドパスで帯域を絞る
const Value drumSnare[] = {
    { osc1Level, 0 }, { osc2Wave, wave::triangle }, { osc2Level, 0.45f }, { osc2Direct, 1 }, { noiseLevel, 1 },
    { filterType, filter::bp }, { filterCutoff, 1800 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { filterEnvAmount, 12 }, { fenvAttack, 0.001f }, { fenvDecay, 0.04f }, { fenvSustain, 0 }, { fenvRelease, 0.05f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.16f }, { aenvSustain, 0 }, { aenvRelease, 0.05f },
    { pitchEnvAmount, 7 }, { pitchEnvTime, 0.03f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 6 },
};

// ハイハット（クローズド）：高い矩形波どうしをリング・FM で掛け合わせた金属的な倍音に、ノイズを重ねてハイパスで削る
const Value drumHatClosed[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.35f },
    { osc2Wave, wave::square }, { osc2Semi, 5 }, { osc2Fine, 37 }, { osc2Level, 0 },
    { ringAmount, 1 }, { fmAmount, 0.3f },
    { noiseLevel, 0.7f },
    { filterType, filter::hp }, { filterCutoff, 6400 }, { filterResonance, 0.2f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.045f }, { aenvSustain, 0 }, { aenvRelease, 0.02f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 2.3f },
};

// ハイハット（オープン）：クローズドと同じ音で長く伸ばす（Toniq ではクローズドが鳴ると止める）
const Value drumHatOpen[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.35f },
    { osc2Wave, wave::square }, { osc2Semi, 5 }, { osc2Fine, 37 }, { osc2Level, 0 },
    { ringAmount, 1 }, { fmAmount, 0.3f },
    { noiseLevel, 0.7f },
    { filterType, filter::hp }, { filterCutoff, 6400 }, { filterResonance, 0.2f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.32f }, { aenvSustain, 0 }, { aenvRelease, 0.04f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 2.9f },
};

// クラップ：バンドパスのノイズ。Toniq は短い音を3回重ねてから余韻を鳴らす（手を叩く音のばらつき）
const Value drumClap[] = {
    { osc1Level, 0 }, { noiseLevel, 1 },
    { filterType, filter::bp }, { filterCutoff, 1200 }, { filterResonance, 0.3f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.2f }, { aenvSustain, 0 }, { aenvRelease, 0.006f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 5.9f },
};

// リム：短い三角波（1.7kHz 前後で鳴らす）にノイズのカチッを重ね、バンドパスで硬くする
const Value drumRim[] = {
    { osc1Wave, wave::triangle }, { osc1Level, 0.8f }, { noiseLevel, 0.3f },
    { filterType, filter::bp }, { filterCutoff, 1700 }, { filterResonance, 0.4f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.035f }, { aenvSustain, 0 }, { aenvRelease, 0.01f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 3.2f },
};

// ===== パーカッション（Toniq のパート「パーカッション」。src/engine/PercPlayer.ts の GROW_PERC が ID で探す） =====
// ドラムと同じく1台で1つの打楽器。サスティン 0 で鳴り終わり、空間系はかけない。master は強さ 1 のピークをそろえた値

// シェイカー：高い帯域のノイズ。アタックを少し遅らせて「シャッ」と砂が流れる立ち上がりにする
const Value drumShaker[] = {
    { osc1Level, 0 }, { noiseLevel, 1 },
    { filterType, filter::bp }, { filterCutoff, 7000 }, { filterResonance, 0.15f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.008f }, { aenvDecay, 0.06f }, { aenvSustain, 0 }, { aenvRelease, 0.02f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 5.8f },
};

// タンバリン：ハイハットより高い金属の倍音（ずらした矩形波のリング・FM）に、ジングルのノイズを重ねて少し長めに鳴らす
const Value drumTambourine[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.4f },
    { osc2Wave, wave::square }, { osc2Semi, 7 }, { osc2Fine, 13 }, { osc2Level, 0 },
    { ringAmount, 1 }, { fmAmount, 0.45f },
    { noiseLevel, 0.8f },
    { filterType, filter::hp }, { filterCutoff, 7500 }, { filterResonance, 0.3f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.002f }, { aenvDecay, 0.16f }, { aenvSustain, 0 }, { aenvRelease, 0.04f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 2 },
};

// コンガ：サインの胴鳴りが少しだけ上から沈む。手で叩く音はフィルター EG で頭だけ通すノイズ
// （高い・低いコンガは Toniq が音の高さを変えて鳴らす。A3 / E3 前後）
const Value drumConga[] = {
    { osc1Wave, wave::sine }, { osc1Level, 0.9f }, { noiseLevel, 0.15f },
    { filterType, filter::lp12 }, { filterCutoff, 900 }, { filterResonance, 0 }, { filterKeyTrack, 0 },
    { filterEnvAmount, 36 }, { fenvAttack, 0.001f }, { fenvDecay, 0.012f }, { fenvSustain, 0 }, { fenvRelease, 0.02f },
    { aenvAttack, 0.001f }, { aenvDecay, 0.2f }, { aenvSustain, 0 }, { aenvRelease, 0.05f },
    { pitchEnvAmount, 4 }, { pitchEnvTime, 0.03f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 5 },
};

// ライド：ハイハットより低く澄んだ金属の倍音を長く伸ばす（テクノ・トランスの裏拍）
const Value drumRide[] = {
    { osc1Wave, wave::square }, { osc1Level, 0.5f },
    { osc2Wave, wave::square }, { osc2Semi, 4 }, { osc2Fine, 31 }, { osc2Level, 0 },
    { ringAmount, 1 }, { fmAmount, 0.2f },
    { noiseLevel, 0.35f },
    { filterType, filter::hp }, { filterCutoff, 3800 }, { filterResonance, 0.35f }, { filterKeyTrack, 0 },
    { aenvAttack, 0.001f }, { aenvDecay, 0.7f }, { aenvSustain, 0 }, { aenvRelease, 0.1f },
    { velocity, 1 }, { reverbMix, 0 },
    { master, 2.5f },
};

template <std::size_t N>
constexpr Preset preset (const char* id, const char* name, const Value (&values)[N]) { return { id, name, values, (int) N }; }

// 並びは番号（JUCE 版のプログラム番号）になる。足すときは後ろに足す。ID は一度出したら変えない
const Preset presets[] = {
    { "init", "初期化", nullptr, 0 },
    preset ("lead", "シンセリード", lead),
    preset ("supersaw", "スーパーソウ", supersaw),
    preset ("pluck", "プラック", pluck),
    preset ("acid", "アシッド", acid),
    preset ("wide_pad", "ワイドパッド", pad),
    preset ("sub_bass", "サブベース", subBass),
    preset ("chip_lead", "チップリード", chipLead),
    preset ("noise_sweep", "ノイズスイープ", noiseSweep),
    // ここから Toniq のパート向け（Toniq は ID で探す。src/engine/Grow.ts の GROW_STANDARD）
    preset ("soft_pad", "ソフトパッド", softPad),
    preset ("keys", "キーズ", keys),
    preset ("bell", "ベル", bell),
    preset ("blip", "ブリップ", blip),
    preset ("stab", "スタブ", stab),
    preset ("gate_saw", "ゲートソウ", gateSaw),
    preset ("vinyl_hiss", "レコードヒス", vinylHiss),
    preset ("vinyl_crackle", "レコードプチ", vinylCrackle),
    preset ("wind", "ウィンド", wind),
    preset ("epiano", "エレピ", ePiano),
    preset ("organ", "オルガン", organ),
    preset ("strings", "ストリングス", strings),
    preset ("square", "スクエア", squareChord),
    // FX / SE 向け（FxPlayer.ts が ID で探す）
    preset ("fx_riser_noise", "FX ライザーノイズ", fxRiserNoise),
    preset ("fx_riser_pitch", "FX ライザーピッチ", fxRiserPitch),
    preset ("fx_boom", "FX ブーム", fxBoom),
    preset ("fx_burst", "FX バースト", fxBurst),
    preset ("fx_down_noise", "FX ダウンノイズ", fxDownNoise),
    preset ("fx_down_tone", "FX ダウントーン", fxDownTone),
    preset ("fx_reverse", "FX リバース", fxReverse),
    preset ("fx_chip", "FX チップ", fxChip),
    // ベース向け（Toniq は ID で探す。src/engine/Grow.ts の GROW_STANDARD）
    preset ("saw_bass", "ソウベース", sawBass),
    preset ("square_bass", "スクエアベース", squareBass),
    preset ("rolling_bass", "ローリングベース", rollingBass),
    preset ("chip_bass", "チップベース", chipBass),
    preset ("soft_bass", "ソフトベース", softBass),
    preset ("brass", "ブラス", brass),
    preset ("sync_lead", "シンクリード", syncLead),
    // sleepfreaks のシンセレシピを参考にした音色
    preset ("hard_pad", "ハードパッド", hardPad),
    preset ("gate_pad", "ゲートパッド", gatePad),
    preset ("fat_bass", "ファットベース", fatBass),
    preset ("pulse_bass", "パルスベース", pulseBass),
    preset ("wobble_bass", "ワブルベース", wobbleBass),
    preset ("trance_lead", "トランスリード", tranceLead),
    preset ("accel_se", "加速SE", accelSe),
    // ドラム（Toniq のドラムの音源「grow」。src/engine/SynthFactory.ts の GROW_DRUMS が ID で探す）
    preset ("drum_kick", "ドラム キック", drumKick),
    preset ("drum_snare", "ドラム スネア", drumSnare),
    preset ("drum_hat_closed", "ドラム ハイハット（クローズド）", drumHatClosed),
    preset ("drum_hat_open", "ドラム ハイハット（オープン）", drumHatOpen),
    preset ("drum_clap", "ドラム クラップ", drumClap),
    preset ("drum_rim", "ドラム リム", drumRim),
    // パーカッション（Toniq のパート「パーカッション」。src/engine/PercPlayer.ts の GROW_PERC が ID で探す）
    preset ("drum_shaker", "パーカッション シェイカー", drumShaker),
    preset ("drum_tambourine", "パーカッション タンバリン", drumTambourine),
    preset ("drum_conga", "パーカッション コンガ", drumConga),
    preset ("drum_ride", "パーカッション ライド", drumRide),
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

const char* presetId (int index)
{
    return index >= 0 && index < presetCount ? presets[index].id : "";
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
