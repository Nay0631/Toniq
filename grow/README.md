# grow

Toniq の内部シンセサイザー。C++ で作り、同じ「コア」から2つの形で動く。

- **Toniq の中**：コアを WebAssembly にして AudioWorklet で鳴らす（メロディの音色「grow（テスト中）」）。再生・ミキサー・WAV / MP3 書き出しにそのまま入る。
- **単体**：[JUCE](https://juce.com/) で **Standalone（grow.exe）** と **VST3 プラグイン** にする。

JUCE は WebAssembly に公式対応していないので、音を作る部分（`core/`）は JUCE を使わない C++ で書き、JUCE は単体版の画面とホストとのやり取りだけに使う。

## ファイル

```
core/                     音を作るコア（JUCE なし。単体版・wasm 版で共通）
  GrowParams.h/.cpp         パラメーターの表（ID・モジュール名・表示名・範囲・初期値・表示）と、音を作る側が読む GrowParams
  GrowPresets.h/.cpp        工場出荷のプリセット（初期値から変える値だけを書く）
  GrowDsp.h                 部品（指数カーブの ADSR・ステートバリアブルフィルター・PolyBLEP のオシレーター・乱数・スムーザー・デノーマル対策）
  GrowVoice.h/.cpp          1音分のシンセ（OSC・フィルター・EG・LFO・グライド・差し替え時のフェード）
  GrowFx.h/.cpp             エフェクト（ドライブ・コーラス・ディレイ・リバーブ（Freeverb）・マスター・DC カット・ソフトクリップ・リミッター）
  GrowEngine.h/.cpp         本体（パラメーターの値・ボイスの割り当て（ポリ／モノ／レガート）・エフェクト）
wasm/
  grow_wasm.cpp             wasm 版の入口（C の関数。Toniq の src/engine/growWorklet.js・Grow.ts が呼ぶ）
  build.mjs                 wasm のビルド（npm run grow:wasm → public/grow/grow.wasm）
Source/                   JUCE の単体版
  PluginProcessor.h/.cpp    コアの表から JUCE のパラメーターを作り、MIDI の位置でブロックを区切ってエンジンに渡す
  PluginEditor.h/.cpp       画面（コアの表のモジュールごとにノブ・セレクトを並べる、プリセット、鍵盤）
  GrowLookAndFeel.h/.cpp    見た目（色・ノブの描き方・日本語のフォント）
  Text.h                    日本語の文字列（jp()）
CMakeLists.txt            単体版のビルド
```

## ビルド

### wasm 版（Toniq で鳴らす）

[Emscripten](https://emscripten.org/docs/getting_started/downloads.html) を入れ、`emsdk_env` で `emcc` に PATH を通してから、Toniq のフォルダで：

```bash
npm run grow:wasm   # → public/grow/grow.wasm
```

できた `public/grow/grow.wasm` は Git に入れる（Toniq を動かすだけの人が Emscripten を入れなくて済むように）。
コアを変えたらビルドし直す。wasm がないと、Toniq では grow を選んでもジャンルの標準の音色で鳴る。

### 単体版（JUCE）

Visual Studio 2022（「C++ によるデスクトップ開発」）・CMake 3.22 以上・Git が必要。

```bash
cd grow
cmake -B build -G "Visual Studio 17 2022"
cmake --build build --config Release
```

最初の構成で JUCE 8.0.4 を GitHub から取得する（手元の JUCE は `-DGROW_JUCE_DIR=C:/path/to/JUCE`）。
できあがるのは `build/grow_artefacts/Release/Standalone/grow.exe` と `build/grow_artefacts/Release/VST3/grow.vst3`。
JUCE のライセンス（AGPLv3 か商用ライセンス）に注意する。

## 音の流れ

```
OSC 1・OSC 2（ユニゾンで最大7枚重ね、左右に広げる）＋サブ（1オクターブ下のサイン）＋ノイズ（左右別々）
  → フィルター（ローパス 12 / 24・ハイパス・バンドパス。フィルター EG・LFO・キー追従でカットオフを動かす）
  → アンプ（ADSR・ベロシティ・LFO）
  → 8音を足す → ドライブ → コーラス → ディレイ（テンポ同期・左右に跳ねる）→ リバーブ → マスター → DC カット → ソフトクリップ → リミッター
```

- ユニゾン：デチューンは外側ほど大きく（位置の 1.5 乗）、真ん中の音（偶数枚なら内側の2枚）は真ん中に置いてずらさない。外側の音の大きさはデチューンが小さいほど控えめで、全体のパワーは枚数・デチューンによらずそろえる。
- EG は指数カーブ（アタックは上に膨らみ、ディケイ・リリースは dB が一定の速さで下がる）。各段の時間ちょうどで次の段へ進む。
- ボイスのモード：ポリ（8音）／モノ／レガート（押したまま次を押すと EG を掛け直さずにつなぐ）。グライドは前に弾いた音から滑らせる。
- LFO：波形（サイン・三角・ノコギリ・矩形・ランダム）、速さは Hz かテンポ同期。行き先は高さ・フィルター・音量に別々の量で送る。
- テンポ：単体版はホストの BPM（Standalone は 120）、Toniq では曲の BPM。

## Toniq とのつなぎ方（wasm 版）

- `src/engine/Grow.ts`：wasm を読み込み（`public/grow/grow.wasm`）、画面のスレッドにも1つインスタンスを作って、パラメーターの表・プリセット・値の表示に使う。AudioWorklet はオーディオコンテキストごとに登録する（再生用と書き出し用）。
- `src/engine/growWorklet.js`：AudioWorklet。wasm をインスタンス化して 128 サンプルずつ描く。
- 音符は AudioParam（`on` / `off`）の1サンプルだけの合図で渡す（`on` = ノート番号 + 1 + 強さ × 0.5、`off` = ノート番号 + 1）。port のメッセージは書き出しのときに届くのが遅れることがあるので、音符には使わない。パラメーター・BPM は port で送る。
- 音の終わりの合図は 2ms 遅らせ、すき間なく続く音が重なるようにする（レガートでつながる）。同じ高さの音が続くときは、ワークレットが前の音の終わりを無視する。
- Toniq ではメロディ・コード（音色が grow のとき）とパッド・アルペジオ・シグネチャー（いつも）を grow で鳴らす。和音は同じサンプルに重なる合図を2サンプルずつずらして渡す。
- 曲に保存するのはパートごとのプリセットの番号と変えた値（ID → 値。null = プリセットのまま）：メロディ `AppState.growPreset` / `growParams`、コード `growChordPreset` / `growChordParams`、パッド・アルペジオ・シグネチャー `growSounds`（プリセットの null = ジャンルの標準）。
- パッド・アルペジオ・シグネチャーのジャンルの標準は、`src/engine/Grow.ts` の `GROW_STANDARD` がプリセットを **名前** で探す（候補を前から順に。今の wasm にない名前は飛ばす）。Toniq 向けのプリセット（ソフトパッド〜ウィンド）の名前を変えるときは `GROW_STANDARD` と `SignaturePlayer.ts`（レコードプチ）もそろえる。

## 決まりごと

- パラメーターを足すときは `core/GrowParams.h` の `Param` と `GrowParams`、`core/GrowParams.cpp` の `table`（並びは `Param` と同じ）と `makeParams()` に足す。単体版の画面・Toniq の暫定のパネルは表から作るので、新しいモジュール名を足したときだけ `Source/PluginEditor.cpp` の `layoutRows` にも足す。ID は一度出したら変えない（保存した状態・曲・ホストのオートメーションが読めなくなる）。
- プリセットの並びを変えると、曲に保存した `growPreset`（番号）が別のプリセットを指す。足すときは後ろに足す。
- つまみの値は段差で当てない（ジッパーノイズになる）。音量・カットオフ・レゾナンス・ユニゾン・エフェクトの量などは `Smoother`（`GrowDsp.h`。時定数 `smoothSeconds`）か、ブロックの中で直線につなぐ形で滑らかに変える。新しく鳴らす音は今の値から始める（`snapNext`）。連続的なパラメーターを足したら同じようにする。
- 鳴っている音をいきなり止めない（クリックになる）。差し替えは `Voice::steal`（約 4ms フェードしてから鳴らす）、まとめて止めるときは `Voice::fadeOut`。すぐ止める `allNotesOff` は再生の停止・初期化だけに使う。
- wasm には FTZ / DAZ がないので、フィードバック・減衰で 0 に近づく状態（フィルター・コム・オールパス・ディレイ・EG など）は `flushDenormal` を通す（極小の値で計算が10倍ほど遅くなる）。
- コアはオーディオスレッドで確保しない（バッファは `prepare` で確保する）。例外・RTTI は使わない（wasm は `-fno-exceptions -fno-rtti`）。
- 日本語の文字列はコアでは UTF-8 の `const char*` のまま持ち、JUCE では `jp("…")` を通す（`juce::String (const char*)` は ASCII 前提）。ソースは UTF-8 で保存する（MSVC は `/utf-8`）。
- wasm に関数を足すときは `wasm/grow_wasm.cpp`（`GROW_EXPORT`）と `wasm/build.mjs` の `exported` の両方に足す。
