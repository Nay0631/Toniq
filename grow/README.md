# grow

Toniq の内部シンセサイザー。C++ と [JUCE](https://juce.com/) で作り、**Standalone（単体のアプリ）** と **VST3 プラグイン** として動く。
Toniq 本体（Electron + Tone.js）とは別のプログラムで、今は Toniq の曲の再生・書き出しにはつながっていない。

## ビルド

必要なもの（Windows）：

- Visual Studio 2022（「C++ によるデスクトップ開発」）
- CMake 3.22 以上
- Git（JUCE を取得するため）

```bash
cd grow
cmake -B build -G "Visual Studio 17 2022"
cmake --build build --config Release
```

最初の構成で JUCE 8.0.4 を GitHub から取得する。手元の JUCE を使うときは `-DGROW_JUCE_DIR=C:/path/to/JUCE` を付ける。

できあがるもの：

- `build/grow_artefacts/Release/Standalone/grow.exe`
- `build/grow_artefacts/Release/VST3/grow.vst3`（DAW の VST3 フォルダに入れて使う）

JUCE のライセンス（AGPLv3 か商用ライセンス）に注意する。

## 音の流れ

```
OSC 1・OSC 2（ユニゾンで最大7枚重ね、左右に広げる）＋サブ（1オクターブ下のサイン）＋ノイズ（左右別々）
  → フィルター（ローパス 12 / 24・ハイパス・バンドパス。フィルター EG・LFO・キー追従でカットオフを動かす）
  → アンプ（ADSR・ベロシティ・LFO）
  → 8音を足す → ドライブ → コーラス → ディレイ（テンポ同期・左右に跳ねる）→ リバーブ → マスター → リミッター
```

- ボイスのモード：ポリ（8音）／モノ／レガート（押したまま次を押すと EG を掛け直さずにつなぐ）。グライドは前に弾いた音から滑らせる。
- LFO：波形（サイン・三角・ノコギリ・矩形・ランダム）、速さは Hz かテンポ同期（ホストの BPM。Standalone は 120）。行き先は高さ・フィルター・音量に別々の量で送る。
- ピッチ EG：発音の瞬間に高さをずらし、「時間」で 0 に戻す。

## ファイル

```
CMakeLists.txt          ビルドの設定（JUCE の取得・プラグインの形式）
Source/
  Parameters.h/.cpp     パラメーターの定義（ID・名前・範囲・表示）と、ブロックごとのスナップショット GrowParams
  Oscillator.h          波形（PolyBLEP のノコギリ・矩形）と音の高さの変換
  GrowVoice.h/.cpp      1音分のシンセ（OSC・フィルター・EG・LFO・グライド）
  GrowSynth.h/.cpp      ボイスの割り当て（ポリ／モノ／レガート）
  FxChain.h/.cpp        エフェクトとマスター
  Presets.h/.cpp        工場出荷のプリセット
  PluginProcessor.h/.cpp  本体（MIDI → ボイス → エフェクト、状態の保存）
  PluginEditor.h/.cpp   画面（モジュールごとのノブ・セレクト、プリセット、鍵盤）
  GrowLookAndFeel.h/.cpp  見た目（色・ノブの描き方・日本語のフォント）
  Text.h                日本語の文字列（jp()）
```

## 決まりごと

- 日本語の表示文字列は必ず `jp("…")` を通す（`juce::String (const char*)` は ASCII 前提）。ソースは UTF-8 で保存する（MSVC は `/utf-8`）。
- パラメーターを足すときは `Parameters.h` の `ids` と `GrowParams`、`Parameters.cpp` の `createParameterLayout()` と `readParams()`、画面に出すなら `PluginEditor.cpp` のモジュールに足す。ID は一度出したら変えない（保存した状態・ホストのオートメーションが読めなくなる）。
- 音を作る側（`GrowVoice` / `FxChain`）は APVTS を直接読まず、ブロックの頭に作る `GrowParams` だけを読む。
- プリセットは `Presets.cpp` に足す（初期値から変える値だけを書く）。
