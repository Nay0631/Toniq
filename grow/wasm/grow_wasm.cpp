// grow の WebAssembly 版の入口（Toniq の AudioWorklet から呼ぶ C の関数）。
// 1つの wasm のインスタンスにエンジンは1つ。文字列は UTF-8 の NUL 終端で、wasm のメモリ上の位置を返す。
// ビルドは grow/wasm/build.mjs（Emscripten）。出力は public/grow/grow.wasm
#include "../core/GrowEngine.h"
#include "../core/GrowParams.h"
#include "../core/GrowPresets.h"

#define GROW_EXPORT extern "C" __attribute__ ((used, visibility ("default")))

namespace
{
constexpr int blockSize = 128;  // 1回の grow_render で書ける最大のサンプル数（AudioWorklet の1回分）

grow::Engine* engine = nullptr;
float leftBuffer[blockSize];
float rightBuffer[blockSize];
char textBuffer[256];
} // namespace

// エンジンを作る（作り直すときは前のものを捨てる）
GROW_EXPORT void grow_init (float sampleRate)
{
    delete engine;
    engine = new grow::Engine();
    engine->prepare (sampleRate);
}

GROW_EXPORT int   grow_block_size() { return blockSize; }
GROW_EXPORT float* grow_left()      { return leftBuffer; }
GROW_EXPORT float* grow_right()     { return rightBuffer; }

// numSamples（blockSize 以下）サンプル分を grow_left / grow_right に書く
GROW_EXPORT void grow_render (int numSamples)
{
    if (engine == nullptr || numSamples <= 0) return;
    engine->render (leftBuffer, rightBuffer, numSamples < blockSize ? numSamples : blockSize);
}

GROW_EXPORT void grow_note_on (int note, float velocity) { if (engine) engine->noteOn (note, velocity); }
GROW_EXPORT void grow_note_off (int note)                { if (engine) engine->noteOff (note); }
GROW_EXPORT void grow_all_notes_off()                    { if (engine) engine->allNotesOff(); }
GROW_EXPORT void grow_set_bpm (float bpm)                { if (engine) engine->setBpm (bpm); }
GROW_EXPORT void grow_set_param (int index, float value) { if (engine) engine->setParam (index, value); }
GROW_EXPORT float grow_get_param (int index)             { return engine ? engine->getParam (index) : 0.0f; }
GROW_EXPORT void grow_load_preset (int index)            { if (engine) engine->loadPreset (index); }

// ===== パラメーターの表（Toniq の画面を作るのに使う。エンジンがなくても読める） =====

GROW_EXPORT int grow_param_count()                { return grow::numParams; }
GROW_EXPORT const char* grow_param_id (int i)     { return grow::paramInfo (i).id; }
GROW_EXPORT const char* grow_param_group (int i)  { return grow::paramInfo (i).group; }
GROW_EXPORT const char* grow_param_name (int i)   { return grow::paramInfo (i).name; }
GROW_EXPORT int grow_param_kind (int i)           { return (int) grow::paramInfo (i).kind; }
GROW_EXPORT float grow_param_min (int i)          { return grow::paramInfo (i).min; }
GROW_EXPORT float grow_param_max (int i)          { return grow::paramInfo (i).max; }
GROW_EXPORT float grow_param_default (int i)      { return grow::paramInfo (i).defaultValue; }
GROW_EXPORT int grow_param_num_choices (int i)    { return grow::paramInfo (i).numChoices; }

GROW_EXPORT const char* grow_param_choice (int i, int choice)
{
    const auto& info = grow::paramInfo (i);
    return choice >= 0 && choice < info.numChoices ? info.choices[choice] : "";
}

GROW_EXPORT float grow_param_to_normalised (int i, float value) { return grow::paramToNormalised (i, value); }
GROW_EXPORT float grow_param_from_normalised (int i, float n)   { return grow::normalisedToParam (i, n); }

GROW_EXPORT const char* grow_param_format (int i, float value)
{
    grow::formatParam (i, value, textBuffer, (int) sizeof (textBuffer));
    return textBuffer;
}

GROW_EXPORT int grow_preset_count()               { return grow::numPresets(); }
GROW_EXPORT const char* grow_preset_name (int i)  { return grow::presetName (i); }

// プリセットの値（index 番目のパラメーター）
GROW_EXPORT float grow_preset_value (int preset, int index)
{
    float values[grow::numParams];
    grow::presetValues (preset, values);
    return index >= 0 && index < grow::numParams ? values[index] : 0.0f;
}
