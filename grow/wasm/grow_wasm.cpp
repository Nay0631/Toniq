// grow の WebAssembly 版の入口（Toniq の AudioWorklet から呼ぶ C の関数）。
// 1つの wasm のインスタンスで、複数のエンジン（スロット。最大 maxSlots）を鳴らせる（マルチティンバー）。
// エンジンはスロットを開いたときに確保し、閉じたら捨てる（メモリは必要な分だけ伸びる。ビルドの ALLOW_MEMORY_GROWTH）。
// スロット番号を取らない関数（grow_init / grow_render など）はスロット 0 を使う（測定ツール grow/tools/render.mjs 向け）。
// 文字列は UTF-8 の NUL 終端で、wasm のメモリ上の位置を返す。
// ビルドは grow/wasm/build.mjs（Emscripten）。出力は public/grow/grow.wasm
#include "../core/GrowEngine.h"
#include "../core/GrowParams.h"
#include "../core/GrowPresets.h"

#define GROW_EXPORT extern "C" __attribute__ ((used, visibility ("default")))

namespace
{
constexpr int blockSize = 128;  // 1回の grow_render で書ける最大のサンプル数（AudioWorklet の1回分）
constexpr int maxSlots  = 32;

grow::Engine* slots[maxSlots] {};
float sampleRate = 48000.0f;
float leftBuffer[blockSize];
float rightBuffer[blockSize];
char textBuffer[256];

grow::Engine* slotEngine (int slot)
{
    return slot >= 0 && slot < maxSlots ? slots[slot] : nullptr;
}
} // namespace

// ===== スロット（マルチティンバー） =====

GROW_EXPORT int  grow_max_slots()                  { return maxSlots; }
GROW_EXPORT void grow_set_sample_rate (float rate) { sampleRate = rate; }

// スロットを開く（エンジンを作る。開いていれば作り直す）。開けたら 1
GROW_EXPORT int grow_open (int slot)
{
    if (slot < 0 || slot >= maxSlots) return 0;
    delete slots[slot];
    slots[slot] = new grow::Engine();
    slots[slot]->prepare (sampleRate);
    return 1;
}

// スロットを閉じる（エンジンを捨てる）
GROW_EXPORT void grow_close (int slot)
{
    if (slot < 0 || slot >= maxSlots) return;
    delete slots[slot];
    slots[slot] = nullptr;
}

// numSamples（blockSize 以下）サンプル分を grow_left / grow_right に書く
GROW_EXPORT void grow_render_slot (int slot, int numSamples)
{
    auto* engine = slotEngine (slot);
    if (engine == nullptr || numSamples <= 0) return;
    engine->render (leftBuffer, rightBuffer, numSamples < blockSize ? numSamples : blockSize);
}

GROW_EXPORT void grow_note_on_slot (int slot, int note, float velocity) { if (auto* e = slotEngine (slot)) e->noteOn (note, velocity); }
GROW_EXPORT void grow_note_off_slot (int slot, int note)                { if (auto* e = slotEngine (slot)) e->noteOff (note); }
GROW_EXPORT void grow_all_notes_off_slot (int slot)                     { if (auto* e = slotEngine (slot)) e->allNotesOff(); }
GROW_EXPORT void grow_set_bpm_slot (int slot, float bpm)                { if (auto* e = slotEngine (slot)) e->setBpm (bpm); }
GROW_EXPORT void grow_set_param_slot (int slot, int index, float value) { if (auto* e = slotEngine (slot)) e->setParam (index, value); }

GROW_EXPORT int   grow_block_size() { return blockSize; }
GROW_EXPORT float* grow_left()      { return leftBuffer; }
GROW_EXPORT float* grow_right()     { return rightBuffer; }

// ===== スロット 0 の短縮形（1つだけ鳴らすとき） =====

// サンプリング周波数を決めてスロット 0 を開く
GROW_EXPORT void grow_init (float rate)
{
    sampleRate = rate;
    grow_open (0);
}

GROW_EXPORT void grow_render (int numSamples)           { grow_render_slot (0, numSamples); }
GROW_EXPORT void grow_note_on (int note, float velocity) { grow_note_on_slot (0, note, velocity); }
GROW_EXPORT void grow_note_off (int note)                { grow_note_off_slot (0, note); }
GROW_EXPORT void grow_all_notes_off()                    { grow_all_notes_off_slot (0); }
GROW_EXPORT void grow_set_bpm (float bpm)                { grow_set_bpm_slot (0, bpm); }
GROW_EXPORT void grow_set_param (int index, float value) { grow_set_param_slot (0, index, value); }
GROW_EXPORT float grow_get_param (int index)             { auto* e = slotEngine (0); return e ? e->getParam (index) : 0.0f; }
GROW_EXPORT void grow_load_preset (int index)            { if (auto* e = slotEngine (0)) e->loadPreset (index); }

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
GROW_EXPORT const char* grow_preset_id (int i)    { return grow::presetId (i); }

// プリセットの値（index 番目のパラメーター）
GROW_EXPORT float grow_preset_value (int preset, int index)
{
    float values[grow::numParams];
    grow::presetValues (preset, values);
    return index >= 0 && index < grow::numParams ? values[index] : 0.0f;
}
