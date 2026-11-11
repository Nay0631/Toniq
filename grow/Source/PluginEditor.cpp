#include "PluginEditor.h"
#include "Presets.h"
#include "Text.h"

namespace grow
{
namespace
{
constexpr int margin       = 12;
constexpr int gap          = 8;
constexpr int headerHeight = 44;
constexpr int hintHeight   = 22;
constexpr int keyboardHeight = 84;
constexpr int keyboardLowest  = 36;  // C2
constexpr int keyboardHighest = 96;  // C7
constexpr int keyboardWhiteKeys = 36;

juce::Font uiFont (float height, bool bold = false)
{
    return juce::Font (juce::FontOptions (height, bold ? juce::Font::bold : juce::Font::plain));
}

juce::String osc (int index, const char* name) { return ids::oscId (index, name); }
} // namespace

// ===== ParamSection =====

ParamSection::ParamSection (juce::AudioProcessorValueTreeState& state, const juce::String& sectionTitle,
                            std::initializer_list<juce::String> parameterIds)
    : title (sectionTitle)
{
    for (const auto& id : parameterIds)
    {
        auto* param = state.getParameter (id);
        jassert (param != nullptr);  // ID の書き間違い
        if (param == nullptr) continue;

        auto control = std::make_unique<Control>();
        control->label.setText (param->getName (40), juce::dontSendNotification);
        control->label.setJustificationType (juce::Justification::centred);
        control->label.setFont (uiFont (12.0f));
        control->label.setColour (juce::Label::textColourId, colours::label);
        addAndMakeVisible (control->label);

        if (auto* choice = dynamic_cast<juce::AudioParameterChoice*> (param))
        {
            control->combo = std::make_unique<juce::ComboBox>();
            control->combo->addItemList (choice->choices, 1);  // 項目を入れてからつなぐ
            control->comboAttachment =
                std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (state, id, *control->combo);
            addAndMakeVisible (*control->combo);
        }
        else if (dynamic_cast<juce::AudioParameterBool*> (param) != nullptr)
        {
            control->toggle = std::make_unique<juce::ToggleButton>();
            control->toggle->setTitle (param->getName (40));
            control->toggleAttachment =
                std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment> (state, id, *control->toggle);
            addAndMakeVisible (*control->toggle);
        }
        else
        {
            auto slider = std::make_unique<juce::Slider> (juce::Slider::RotaryHorizontalVerticalDrag,
                                                          juce::Slider::TextBoxBelow);
            slider->setTextBoxStyle (juce::Slider::TextBoxBelow, false, cellWidth - 4, 18);
            slider->setTitle (param->getName (40));
            control->sliderAttachment =
                std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (state, id, *slider);
            // ダブルクリックで初期値に戻す
            slider->setDoubleClickReturnValue (true, param->convertFrom0to1 (param->getDefaultValue()));
            control->slider = std::move (slider);
            addAndMakeVisible (*control->slider);
        }
        controls.push_back (std::move (control));
    }
}

int ParamSection::getPreferredWidth() const
{
    return (int) controls.size() * cellWidth + 2 * gap;
}

void ParamSection::paint (juce::Graphics& g)
{
    const auto bounds = getLocalBounds().toFloat();
    g.setColour (colours::panel);
    g.fillRoundedRectangle (bounds, 6.0f);
    g.setColour (colours::line);
    g.drawRoundedRectangle (bounds.reduced (0.5f), 6.0f, 1.0f);

    g.setColour (colours::accent);
    g.setFont (uiFont (13.0f, true));
    g.drawText (title, getLocalBounds().reduced (gap + 2, 0).removeFromTop (titleHeight),
                juce::Justification::centredLeft);
}

void ParamSection::resized()
{
    auto area = getLocalBounds().reduced (gap, 0);
    area.removeFromTop (titleHeight);
    area.removeFromBottom (gap);
    if (controls.empty()) return;

    const auto width = area.getWidth() / (int) controls.size();
    for (auto& control : controls)
    {
        auto cell = area.removeFromLeft (width);
        control->label.setBounds (cell.removeFromTop (18));
        if (control->slider != nullptr)
            control->slider->setBounds (cell.withSizeKeepingCentre (juce::jmin (cell.getWidth(), cellWidth),
                                                                    cell.getHeight()));
        else if (control->combo != nullptr)
            control->combo->setBounds (cell.withSizeKeepingCentre (cell.getWidth() - 4, 24).translated (0, -12));
        else if (control->toggle != nullptr)
            control->toggle->setBounds (cell.withSizeKeepingCentre (28, 28).translated (0, -12));
    }
}

// ===== GrowEditor =====

GrowEditor::GrowEditor (GrowProcessor& p)
    : juce::AudioProcessorEditor (p),
      growProcessor (p),
      keyboard (p.keyboardState, juce::MidiKeyboardComponent::horizontalKeyboard)
{
    juce::LookAndFeel::setDefaultLookAndFeel (&lookAndFeel);
    setLookAndFeel (&lookAndFeel);

    title.setText ("grow", juce::dontSendNotification);
    title.setFont (uiFont (22.0f, true));
    title.setColour (juce::Label::textColourId, colours::text);
    addAndMakeVisible (title);

    refreshPresetList();
    presets.onChange = [this] { selectPreset (presets.getSelectedItemIndex()); };
    addAndMakeVisible (presets);

    previousPreset.setTitle (jp ("前のプリセット"));
    nextPreset.setTitle (jp ("次のプリセット"));
    previousPreset.onClick = [this] { selectPreset ((growProcessor.getCurrentProgram() + numPresets() - 1) % numPresets()); };
    nextPreset.onClick     = [this] { selectPreset ((growProcessor.getCurrentProgram() + 1) % numPresets()); };
    addAndMakeVisible (previousPreset);
    addAndMakeVisible (nextPreset);

    hint.setText (jp ("画面の鍵盤をクリックして弾けます。鍵盤をクリックしたあとは PC の A S D F G H J K（白鍵）・"
                      "W E T Y U（黒鍵）でも弾けます。ノブはダブルクリックで初期値に戻ります。"),
                  juce::dontSendNotification);
    hint.setFont (uiFont (12.0f));
    hint.setColour (juce::Label::textColourId, colours::label);
    addAndMakeVisible (hint);

    auto& s = growProcessor.state;
    auto section = [&s] (const char* name, std::initializer_list<juce::String> parameterIds) {
        return std::make_unique<ParamSection> (s, jp (name), parameterIds);
    };
    auto row = [] (auto... sections) {
        std::vector<std::unique_ptr<ParamSection>> list;
        (list.push_back (std::move (sections)), ...);
        return list;
    };

    rows.push_back (row (
        section ("OSC 1", { osc (0, "wave"), osc (0, "octave"), osc (0, "semi"), osc (0, "fine"), osc (0, "level"),
                            osc (0, "unison"), osc (0, "detune"), osc (0, "width") }),
        section ("OSC 2", { osc (1, "wave"), osc (1, "octave"), osc (1, "semi"), osc (1, "fine"), osc (1, "level"),
                            osc (1, "unison"), osc (1, "detune"), osc (1, "width") })));
    rows.push_back (row (
        section ("サブ・ノイズ", { ids::subLevel, ids::noiseLevel }),
        section ("フィルター", { ids::filterType, ids::cutoff, ids::resonance, ids::filterEnvAmt, ids::keyTrack }),
        section ("フィルター EG", { ids::fenvA, ids::fenvD, ids::fenvS, ids::fenvR }),
        section ("アンプ EG", { ids::aenvA, ids::aenvD, ids::aenvS, ids::aenvR })));
    rows.push_back (row (
        section ("LFO", { ids::lfoWave, ids::lfoSync, ids::lfoRate, ids::lfoRetrigger, ids::lfoPitch, ids::lfoFilter,
                          ids::lfoAmp }),
        section ("ピッチ EG", { ids::pitchEnvAmt, ids::pitchEnvTime }),
        section ("ボイス", { ids::voiceMode, ids::glide, ids::velocity })));
    rows.push_back (row (
        section ("ドライブ", { ids::drive }),
        section ("コーラス", { ids::chorusMix, ids::chorusRate, ids::chorusDepth }),
        section ("ディレイ", { ids::delayMix, ids::delayTime, ids::delayFeedback, ids::delayPingPong }),
        section ("リバーブ", { ids::reverbMix, ids::reverbSize }),
        section ("出力", { ids::master })));

    auto contentWidth = 0;
    for (auto& r : rows)
    {
        auto width = gap * ((int) r.size() - 1);
        for (auto& sec : r)
        {
            width += sec->getPreferredWidth();
            addAndMakeVisible (*sec);
        }
        contentWidth = juce::jmax (contentWidth, width);
    }

    keyboard.setAvailableRange (keyboardLowest, keyboardHighest);
    keyboard.setKeyPressBaseOctave (5);  // PC の A キー = C4（ノート番号 60）
    keyboard.setColour (juce::MidiKeyboardComponent::keyDownOverlayColourId, colours::accent);
    keyboard.setColour (juce::MidiKeyboardComponent::mouseOverKeyOverlayColourId, colours::accent.withAlpha (0.3f));
    addAndMakeVisible (keyboard);

    const auto rowHeight = ParamSection::titleHeight + ParamSection::cellHeight;
    setSize (contentWidth + 2 * margin,
             margin + headerHeight + (int) rows.size() * (rowHeight + gap) + hintHeight + keyboardHeight + margin);
}

GrowEditor::~GrowEditor()
{
    setLookAndFeel (nullptr);
    juce::LookAndFeel::setDefaultLookAndFeel (nullptr);
}

void GrowEditor::refreshPresetList()
{
    presets.clear (juce::dontSendNotification);
    for (int i = 0; i < numPresets(); ++i)
        presets.addItem (presetName (i), i + 1);
    presets.setSelectedItemIndex (growProcessor.getCurrentProgram(), juce::dontSendNotification);
}

void GrowEditor::selectPreset (int index)
{
    if (! juce::isPositiveAndBelow (index, numPresets())) return;
    growProcessor.setCurrentProgram (index);
    presets.setSelectedItemIndex (index, juce::dontSendNotification);
}

void GrowEditor::paint (juce::Graphics& g)
{
    g.fillAll (colours::background);
}

void GrowEditor::resized()
{
    auto area = getLocalBounds().reduced (margin);

    auto header = area.removeFromTop (headerHeight).withTrimmedBottom (gap);
    title.setBounds (header.removeFromLeft (120));
    nextPreset.setBounds (header.removeFromRight (32));
    header.removeFromRight (4);
    presets.setBounds (header.removeFromRight (220));
    header.removeFromRight (4);
    previousPreset.setBounds (header.removeFromRight (32));

    const auto rowHeight = ParamSection::titleHeight + ParamSection::cellHeight;
    for (auto& r : rows)
    {
        auto rowArea = area.removeFromTop (rowHeight);
        area.removeFromTop (gap);

        // 余った幅は、つまみの数に合わせて各モジュールに配る
        juce::FlexBox flex;
        flex.flexDirection = juce::FlexBox::Direction::row;
        for (size_t i = 0; i < r.size(); ++i)
        {
            const auto preferred = (float) r[i]->getPreferredWidth();
            flex.items.add (juce::FlexItem (*r[i])
                                .withWidth (preferred)
                                .withHeight ((float) rowHeight)
                                .withFlex (preferred, 1.0f)
                                .withMargin (juce::FlexItem::Margin (0.0f, i + 1 < r.size() ? (float) gap : 0.0f, 0.0f, 0.0f)));
        }
        flex.performLayout (rowArea);
    }

    hint.setBounds (area.removeFromTop (hintHeight));
    auto keys = area.removeFromTop (keyboardHeight);
    keyboard.setBounds (keys);
    keyboard.setKeyWidth ((float) keys.getWidth() / (float) keyboardWhiteKeys);
}
} // namespace grow
