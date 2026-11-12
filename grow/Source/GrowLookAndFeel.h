#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

// grow の見た目（Toniq のフラットスキンに合わせる：グレーの面、白いノブと細いオレンジの弧）
namespace grow
{
namespace colours
{
    inline const juce::Colour background { 0xff1f2125 };
    inline const juce::Colour panel      { 0xff2a2d33 };
    inline const juce::Colour line       { 0xff3a3e46 };
    inline const juce::Colour text       { 0xffe8e9ec };
    inline const juce::Colour label      { 0xff9aa0aa };
    inline const juce::Colour accent     { 0xffff8a3d };
    inline const juce::Colour knob       { 0xfff4f5f7 };
    inline const juce::Colour track      { 0xff4a4f58 };
} // namespace colours

class GrowLookAndFeel : public juce::LookAndFeel_V4
{
public:
    GrowLookAndFeel();

    void drawRotarySlider (juce::Graphics&, int x, int y, int width, int height, float sliderPos,
                           float rotaryStartAngle, float rotaryEndAngle, juce::Slider&) override;
};
} // namespace grow
