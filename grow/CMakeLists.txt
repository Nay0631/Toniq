# grow — Toniq の内部シンセサイザー（JUCE / C++）
# Standalone（単体のアプリ）と VST3 プラグインを作る。
#
#   cmake -B build -G "Visual Studio 17 2022"
#   cmake --build build --config Release
#
# JUCE は -DGROW_JUCE_DIR=<JUCE のフォルダ> で指定できる。指定しなければ GitHub から取得する。
cmake_minimum_required(VERSION 3.22)

project(grow VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(GROW_JUCE_DIR "" CACHE PATH "JUCE のフォルダ（空なら GitHub から取得する）")

if(GROW_JUCE_DIR)
  add_subdirectory(${GROW_JUCE_DIR} JUCE)
else()
  include(FetchContent)
  FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE)
  FetchContent_MakeAvailable(JUCE)
endif()

juce_add_plugin(grow
  COMPANY_NAME                "Toniq"
  PRODUCT_NAME                "grow"
  BUNDLE_ID                   com.toniq.grow
  PLUGIN_MANUFACTURER_CODE    Tniq
  PLUGIN_CODE                 Grow
  IS_SYNTH                    TRUE
  NEEDS_MIDI_INPUT            TRUE
  NEEDS_MIDI_OUTPUT           FALSE
  IS_MIDI_EFFECT              FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS TRUE
  COPY_PLUGIN_AFTER_BUILD     FALSE
  VST3_CATEGORIES             Instrument Synth
  FORMATS                     Standalone VST3)

# 音を作る部分は JUCE を使わないコア（core/。WebAssembly 版と共通）
target_sources(grow PRIVATE
  core/GrowParams.cpp
  core/GrowPresets.cpp
  core/GrowVoice.cpp
  core/GrowFx.cpp
  core/GrowEngine.cpp
  Source/GrowLookAndFeel.cpp
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp)

target_include_directories(grow PRIVATE core)

target_compile_definitions(grow PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

# ソースは UTF-8（日本語の表示文字列を含む）
if(MSVC)
  target_compile_options(grow PRIVATE /utf-8)
endif()

target_link_libraries(grow
  PRIVATE
    juce::juce_audio_utils
    juce::juce_dsp
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)
