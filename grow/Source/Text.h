#pragma once

#include <juce_core/juce_core.h>

namespace grow
{
// 日本語の表示文字列。juce::String (const char*) は ASCII 前提なので、日本語を含む文字列は必ずこれを通す
// （ソースは UTF-8 で保存し、MSVC は /utf-8 でコンパイルする）
inline juce::String jp (const char* utf8)
{
    return juce::String::fromUTF8 (utf8);
}
} // namespace grow
