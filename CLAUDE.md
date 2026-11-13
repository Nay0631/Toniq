# CLAUDE.md

Toniq — ルールベース自動作曲アプリ（Electron + Vite + TypeScript + Tone.js）。
ジャンルと雰囲気を選ぶと、JSON のパターンDBからコード進行・ドラムを選び、ベース／アルペジオ／パッド／メロディを自動生成してループ再生する。

## コマンド

```bash
npm run dev             # 開発起動（Vite, http://localhost:5173。vite-plugin-electron が Electron も起動する）
npm run electron:dev    # npm run dev と同じ（以前の名前）
npm run build           # tsc + vite build
npm test                # テスト（Vitest。tests/*.test.ts）
npm run lint            # Lint（Biome。biome.json）
npm run typecheck       # 型チェック（アプリとテスト）
npm run electron:build  # インストーラ作成（release/）
```

変更後は `npm run lint`・`npm run typecheck`・`npm test` を通す。GitHub に push すると `.github/workflows/test.yml` が同じ3つと `npm run quality -- --runs 20` を動かす。

- Lint は Biome（TypeScript 7 には typescript-eslint が対応していないため）。整形（formatter）は使わない。推奨の規則から、このコードの書き方に合わないもの（`!`・日本語のキーの `obj["…"]`・`??=` を含む式・forEach の式の本体・スキンの CSS の上書き）は `biome.json` で外している。`any` は警告だけ。

- テストは `tests/` に置く（`vitest.config.ts`。vite.config.ts（Electron の起動）は使わない）。Node で動かすので、Tone.js は `tests/stubs/tone.ts`（BPM 120・PPQ 192 の Transport の時刻変換と、音名の変換 `Frequency` だけ）に差し替え、Web Audio・DOM を使うモジュール（`VolumeManager` / `History` など）は `vi.mock` で外す。乱数を使う生成は `tests/helpers.ts` の `seededRandom` で `Math.random` を差し替えて固定し、localStorage は `MemoryStorage`（容量オーバーも再現できる）を `vi.stubGlobal` で入れる。
- 古い形式の読み替え（`songFields` の `LEGACY_*`・`presetIdFromSaved`）を変えたり、AppState に曲の項目を足したりしたら `tests/SongLibrary.test.ts` に古い曲の例を足す。
- `npm test` は `tools/test.mjs` から vitest を起動する。Windows で作業フォルダのドライブ文字が小文字（`c:\…`。VS Code のターミナルなど）だと vitest が自分を2回読み込んで「Cannot read properties of undefined (reading 'config')」で失敗するので、大文字にそろえてから起動している（`npx vitest` を直接使うときは `C:\…` で開いたターミナルから）。

メロディ・コード進行・アレンジの生成ルールを変えたら、`npm run quality` で前後を比べる（`tools/quality-report.mjs`）。シンプルモードの「生成する」と同じ手順で全ジャンル×雰囲気を100曲ずつ作り、自動チェックの合格率・総合点と多様さ（進行・メロディのリズムの種類、同じメロディが出ないか）を出す。乱数はシードで決まるので、変更前に `--save before`、変更後に `--compare before` で差が出る（`--detail` でジャンル×雰囲気ごと、`--genre` で絞り込み、`--seed` / `--runs` / `--key`。結果は `output/quality/`）。コード進行DB・メロディのリズムDB に誤りがあると終了コード 1 で終わる（CI で気づける）。

grow（内部シンセ。C++）は2通りにビルドする（詳しくは `grow/README.md`）：

```bash
npm run grow:wasm   # Toniq で鳴らす wasm（Emscripten の emcc が必要）→ public/grow/grow.wasm（Git に入れる）
cd grow && cmake -B build -G "Visual Studio 17 2022" && cmake --build build --config Release
                    # 単体版（JUCE の Standalone・VST3。Visual Studio 2022・CMake 3.22 以上）
```

grow のコア（`grow/core/`）を変えたら `npm run grow:wasm` でビルドし直す（Toniq は wasm を読むので、ビルドしないと変更が鳴らない）。GitHub に push すると `.github/workflows/grow-wasm.yml` が同じ版の Emscripten（7.0.0）でビルドし、全プリセットを確かめる（Git に入れた `grow.wasm` と違えば警告）。
ビルドしたら `npm run grow:render` で全プリセットを Node で鳴らして確かめる（無音・NaN・直流・余韻が消えない・音量。`--wav` で `output/grow/` に WAV、`--suggest` で音量をそろえる master の提案、`--analyze <WAV>` で書き出した曲のピーク・ラウドネス。詳しくは `grow/README.md`）。

## ディレクトリ構成

```
electron/main.ts        Electron メインプロセス（ウィンドウ生成と、出力フォルダ output/ への保存・フォルダを開く IPC。開発時かどうかは vite-plugin-electron が渡す VITE_DEV_SERVER_URL で判断する）
electron/preload.ts     画面側に window.toniqFiles を公開する（CJS の preload.cjs にビルド。型は src/toniq-files.d.ts）
grow/                   内部シンセ grow（C++。core/ = 音を作るコア（JUCE なし）、wasm/ = Toniq 用の WebAssembly、Source/ = JUCE の Standalone・VST3。構成は grow/README.md）
public/grow/grow.wasm   grow の wasm（npm run grow:wasm で作る。Grow.ts が読む）
output/                 曲の出力フォルダ（audio = WAV / MP3、midi = MIDI、quality = 一括計測の結果。中身は Git 管理外）
docs/                   詳しい仕様（generation / arrangement / sound / ui。下の「詳しい仕様」）
.github/workflows/      CI（test.yml = Lint・型チェック・テスト・一括計測、grow-wasm.yml = grow の wasm のビルドと確認）
biome.json              Lint（Biome）の設定
tests/                  テスト（Vitest。degree_resolver / MelodyGenerator / LoopArranger / SongLibrary / CounterPerc（カウンターメロディ・パーカッション）/ DrumFill（ドラムのフィル）/ SongMidi（曲全体の進行・ベース・MIDI書き出し・転調・シャッフル）。helpers.ts = 共通、stubs/tone.ts = Tone.js の代わり、tsconfig.json = テストの型チェック）
tools/test.mjs          npm test の起動（ドライブ文字を大文字にそろえて vitest run）
tools/quality-report.mjs 自動チェックの一括計測（npm run quality。Vite で src/engine/QualityBatch.ts を読む。tone は quality-tone-stub.mjs に差し替える）
index.html              UI。ヘッダー＋画面ごとの <section data-screen="…">（menu / simple / custom / musiclist / quiz / settings）
src/main.ts             エントリ。初期状態の解決と各画面の初期化
src/ui/
  Router.ts               画面・タブ切り替え（showScreen / showTab / render / onRender）。AppState.screen / tab
  SimpleScreen.ts         シンプルモード画面（設定→生成→結果、差し替え、書き出し、ジャンルのサンプル試聴）
  CustomScreen.ts         カスタムモード画面のイベントの登録と再生の操作（設定タブ：基本設定／スケール・キー＋コード進行／ドラム・パッド/アルペジオの3列＋書き出し、アレンジャータブ下部の書き出し、スペースキーの再生）
  CustomRender.ts         カスタムモード画面の表示（render。情報バー・設定タブの各欄、アレンジャー・ミキサーの描画を呼ぶ）
  CustomState.ts          カスタムモード画面の状態の更新（DOM を触らない。コード進行・サビの切り替えとメロディの作り直し、BPM、グルーヴ）と選択肢の元のデータ（APP_GENRES など）
  ArrangerTab.ts          アレンジャーのタイムライン（構成のプリセットの選択、セクションの行、セクションごとにパートを足す・抜く、変えた所の印、再生位置）
  MixerPanel.ts           ミキサー（アレンジャータブのみ。パートごとの ON/OFF・音量のフェーダー・レベルメーター、マスターのメーター）
  PianoRollTab.ts         ピアノロール（メロディの入力・編集。シンプルモード／カスタムモードの両画面で共通）
  MusicListScreen.ts      ミュージックリスト画面（検索・並び替え・お気に入り・ジャンルの絞り込み、曲ごとの再生・「編集」ボタン・⋮メニュー、「出力フォルダ」ボタン）と両モードの「♪ 保存」ボタン
  QuizScreen.ts           音楽クイズ画面（カテゴリ・出題モードの切り替え、出題・採点、鍵盤／選択肢での回答、出題設定）
  Controls.ts             シンセサイザー風のノブ（attachKnob）・縦フェーダー（attachFader。ミキサー）・セレクトの ◀▶（attachStepper）。値は隠した range／select に持たせ input／change イベントで通知
  ExportProgress.ts       音声の書き出し（WAV / MP3）の進み具合のダイアログ（目安の説明・段階・進み具合・経過時間。両モード共通の exportAudioWithProgress）
  FileNameDialog.ts       書き出すファイル名を決めるダイアログ（WAV / MP3 / MIDI。初期値はリストの曲名、未保存なら toniq_ジャンル_雰囲気（カスタムモードはキー））
  format.ts               表示用ヘルパー（スケール名、キーに合わせたコード名、時間）
  HistoryControls.ts      元に戻す／やり直すのボタン（両モードの情報バー）とショートカット（Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y）、戻したあとの再生への反映
  Glossary.ts             用語のツールチップ（data-term を付けた要素に初心者向けの短い説明を出す。説明は TERMS）
  SettingsScreen.ts       設定画面（配色・カスタムモードのスキン・音名の表記・ループ再生・ドラムの音源・用語のツールチップの ON/OFF）
  GrowPanel.ts            grow（テスト中）の音作りの暫定パネル（カスタムモードの設定タブの下 #c-grow。対象のパート、プリセット、コアの表から作るモジュールごとのつまみ）
  CustomMore.ts           カスタムモードの設定タブの「もっと調整」（標準のままでも鳴る項目を畳む欄。変更の数・変えた項目の印・欄ごとに標準に戻す・開閉の保存）
  Preferences.ts          端末ごとの設定（音名の表記 toniq.noteNames・ループ再生 toniq.loop・ドラムの音源 toniq.drumSource・テスト中の機能 toniq.test.*）の保存・読み込み
  Theme.ts                ライト／ダーク／OS に合わせるの切り替え（ヘッダー右端のボタンと設定画面、<html data-theme>、localStorage の toniq.theme）と、カスタムモードのスキン（デフォルト／フラット／スタジオ／ポップ。設定画面で選ぶ。<html data-skin>、toniq.skin）
  styles.css              デザイントークン（ライト＋ダーク）と共通スタイル
src/quiz/               音楽クイズ
  QuizModes.ts            カテゴリの並び（QUIZ_CATEGORIES）。画面が使う型・音名もここから再エクスポートする
  QuizCore.ts             型・音名・出題に使うデータ（音程・コード・スケール・進行など）・ヘルパー
  modes/                  カテゴリごとの出題モード（PitchModes = 音の高さ、ChordScaleModes = コード・スケール、RhythmSoundModes = リズム・音響、TermModes = 用語。各モードの出題設定と問題の作り方）
  QuizAudio.ts            クイズの音（Web Audio API で直接鳴らす。音の高さは MIDI ノート番号）
src/data/               楽曲データとデータ型
  types.ts                ChordProgression / DrumPattern 型
  degree_resolver.ts      ディグリー → 実音の変換（resolveChord）、メロディ用のスケール音の役割（SCALE_TONES）
  chord_progressions.json コード進行DB（ディグリー表記）
  drum_patterns.json      ドラムパターンDB（16ステップ。全ジャンル×雰囲気に1件以上）
  easy_mode_table.json    シンプルモード用：ジャンル×雰囲気 → BPM・候補ID
  tempo_presets.json      ジャンル別テンポプリセット（ゆっくり/普通/速い）
  melody_params.json      ジャンル別メロディ生成パラメータ（リズムテンプレート・フレーズ形式・アクセント音の頻度・標準の音色 instrument など）
  bass_params.json        ジャンル別ベース設定（16ステップのパターン・音色）
  arp_params.json         ジャンル別アルペジオ設定（音色・刻み・パターン・オクターブ数・音の長さ・ローパス・ディレイ）
  mix_presets.json        ジャンル別マスターエフェクト設定（リバーブ送り量・EQ・コンプ・リミッター・持ち上げ gain）
src/engine/
  AppState.ts             アプリ状態の唯一の保持場所
  SongLibrary.ts          ミュージックリストの保存・読み込み（localStorage の toniq.songs）と曲ファイル（.toniq.json）の書き出し・読み込み
  OutputFiles.ts          書き出したファイルの保存先（Electron は output/<種類>/ に直接保存、ブラウザはダウンロード。saveOutput）
  History.ts              元に戻す／やり直すの履歴（setState の直前に曲の内容のスナップショットを積む）
  SimpleModeResolver.ts   シンプルモード：ジャンル×雰囲気からパターンを決定
  LayerManager.ts         パートのON/OFF・差し替え・再ロード
  LoopArranger.ts         アレンジ（ジャンル標準の LOOP_SCHEDULE＝8小節のセクションごと（A A サビ A）のパート・add / drop / gap / build、構成のプリセット ARRANGE_PRESETS、変えた所 ArrangeEdit の当て直し、以前のブロックの並びからの読み替え editsFromLegacy、各パートが鳴る小節の判定 arrangementGate、周回表示）
  SongForm.ts             曲の構成（セクション Aメロ／サビ、曲全体のコード進行 songProgression・メロディ songMelody、エンディング、ドラムのフィルの小節、Aメロ・サビのメロディ生成）
  QualityCheck.ts         自動チェック（強拍のコード構成音・フレーズの終わり・跳躍・サビの高さ・抜き差し・DB の整合を数字で出す。画面には出さず npm run quality だけで使う。数値 songMetrics と合否の基準 QUALITY_RULES は一括計測と共通）
  QualityBatch.ts         自動チェックの一括計測（npm run quality が Node から呼ぶ。アプリからは使わない。シードを決めて全ジャンル×雰囲気の曲を生成し、合格率と多様さを集める）
  Groove.ts               グルーヴ（スウィング applySwing・MIDI書き出し用のずらし方 swungBeats・サイドチェイン sidechainHit。量はジャンルの標準か AppState.swing / sidechain、単位は AppState.swingUnit）
  {Drum,Chord,Bass,Arp,Pad,Melody,Fx}Player/Engine.ts  各パートの Tone.Part 生成（Fx はループの継ぎ目の効果音。種類は FX_DEFS）
  SignaturePlayer.ts      シグネチャー（ジャンルごとに鳴り方が変わる追加パート。定義は SIGNATURES）
  CounterPlayer.ts        カウンターメロディ（メロディとコード進行から作る。サビはハモり、Aメロは合いの手。counterNotes）
  PercPlayer.ts           パーカッション（シェイカー・タンバリン・コンガ・ライド。ジャンル×セクションのパターン PERC_PATTERNS）
  MelodyGenerator.ts      メロディ生成（ペンタトニック中心＋アクセント音、リズムテンプレート、モチーフの反復）
  Grow.ts                 grow（C++ のコアの wasm）を鳴らす：wasm の読み込み・表とプリセット、AudioWorklet の登録、各パートの音色 GrowInstrument（同じタスクで作ったものを1つのノードにまとめるマルチティンバー）
  growWorklet.js          grow の AudioWorklet（1つのノードで最大16の音色を鳴らす。wasm を 128 サンプルずつ描く。音符・時刻を決めたパラメーターは AudioParam の合図で受ける）
  SynthFactory.ts         ドラム音源（ジャンル別キット DRUM_KITS ＋バス：高域カット→歪み→コンプ→持ち上げ）。grow（GROW_DRUMS）・ワンショット音源で鳴らす音色もここ
  DrumSamples.ts          ドラムのワンショット音源の読み込み（public/samples/drums/<フォルダ>/<トラック名>.wav）
  Playback.ts             再生・停止（AppState.bars 小節で自動停止。ループ再生なら先頭へ戻る）、再生位置、WAV / MP3 レンダリング
  VolumeManager.ts        パート別 Volume ノード（0〜100 → dB）。オーディオコンテキストごとに保持
  MixerEngine.ts          マスター（入口→EQ→コンプ→持ち上げ→リミッター）とリバーブ送り。オーディオコンテキストごとに保持
  TapTempo.ts             タップテンポ（AppState.bpm を更新する。再生中の反映は呼び出し側が Playback.applyBpm()）
  Metronome.ts            BPM 試聴用のクリック音（Web Audio API で直接鳴らす）
  ScalePreview.ts         キー・スケールの試聴（スケールを順に鳴らして主音の和音で終わる。Web Audio API で直接鳴らす）
  MidiExporter.ts         MIDI書き出し（今の曲を曲全体の長さで。アレンジ・パートの ON/OFF・スウィングを反映）
```

## 設計ルール

### 1. モード名は「シンプルモード」「カスタムモード」で統一

- UI 表示・コメント・ログ・ドキュメントでは必ず **シンプルモード** / **カスタムモード** と書く。「かんたん」「詳細」「Easy」「Advanced」などの別名は使わない。
- コード上の識別子は `simple` / `custom`（`AppState.mode: "simple" | "custom"`、`SimpleModeResolver`、`applySimpleToCustom`）。
- シンプルモード → カスタムモードへは `applySimpleToCustom()` で状態を引き継ぐ（シンプルモードで決めた値はそのまま残す）。
- 既存の `easy_mode_table.json` / `easyTable` は旧名の名残。新規コードで `easy` という名前を増やさないこと。

### 2. コード進行はディグリーで管理する

- `chord_progressions.json` には実音（`Am`, `F` など）を書かず、ディグリー（`Im`, `bVI`, `IV` …）＋ `type` ＋ `inversion` ＋ `base_scale` で記述する。
- 実音への変換はキーが確定した再生・書き出し時点で `resolveChord(degree, type, inversion, key, scale, octave)`（`src/data/degree_resolver.ts`）を通して行う。各 Player や Generator で独自に音名を計算しない。
- 新しいディグリーやスケールを使う場合は、`degree_resolver.ts` の `SCALE_INTERVALS`（必要なら `CHORD_INTERVALS`）にも追加する。未定義だと実行時に例外になる。スケールを追加するときは、同じファイルの `SCALE_TONES`（メロディ用のペンタトニック5音とアクセント2音）にも追加する。ない場合、メロディは minor として生成される。
- キー変更は `AppState.key` を変えて再ロードするだけで済む状態を保つ。

### 3. 状態は AppState.ts で一元管理する

- 表示中の画面・モード・ジャンル・雰囲気・キー・BPM・テンポプリセット・選択中パターン・メロディ・パートON/OFF・音量は、すべて `AppState` に置く。
- 読み取りは `getState()`、更新は `setState(partial)` のみ。モジュール内に同じ値のコピーを持たない（`let currentBpm` のような変数を作らない）。
- 各 engine モジュールが持ってよいのは Tone.js のオブジェクト（Synth / Part / Volume ノード）だけ。
- `setState` はシャローマージなので、`parts` / `volumes` などのネストしたオブジェクトはスプレッドで丸ごと渡す：
  `setState({ parts: { ...getState().parts, arp: false } })`
- AppState に項目を追加するときは、インターフェースと `defaultState` の両方を更新する。


## その他の決まりごと

- パート名は `"drum" | "perc" | "chord" | "bass" | "arp" | "pad" | "signature" | "melody" | "counter" | "fx"`（`LayerName`）で統一。UI 表示名はドラム／パーカッション／コード／ベース／アルペジオ／パッド／シグネチャー／メロディ／カウンターメロディ（アレンジャー・ミキサーでは「カウンター」）／FX/SE。並びは `LoopArranger.ts` の `LAYERS`（LayerManager などもこれを使う。循環 import になるので LayerManager 側に値を置かない）。
- 各パートモジュールは `init*Synth()` / `load*()` / `dispose*()` の形にそろえる。`load*` は既存の Part を破棄してから作り直す。
- ジャンル名は `EDM` / `8bit` / `ローファイ` / `ゲームBGM` / `テクノ` / `ハウス` / `トランス` / `アンビエント`、雰囲気は `明るい` / `暗い` / `落ち着いた` / `切ない` / `激しい`。JSON のキー（`easy_mode_table` / `tempo_presets` / `melody_params` / `bass_params` / `arp_params` / `mix_presets`）と完全に一致させる。見つからないときのフォールバックは `ローファイ` / `落ち着いた`。
- ジャンルは今後も追加・削除がありうる。追加するときは上の6つの JSON と `LoopArranger.ts` の `LOOP_SCHEDULE`（A A サビ A の4セクション。`section` も）にそろえて追加する。ドラムのフィルは `DrumEngine.ts` の `FILLS`（小・中・大の3つ。なければローファイの定義）、ゴーストノートは `GHOST_RATE`（なければ入れない）、メロディの掛留の確率は `MelodyGenerator.ts` の `DEFAULT_SUSPENSION`（`melody_params.json` の `suspension` があればそちら）。ドラムの音作りは `SynthFactory.ts` の `DRUM_KITS`（なければ標準キットで鳴る）。シグネチャーの鳴り方は `SignaturePlayer.ts` の `SIGNATURES`（なければローファイの定義で鳴る）。FX の標準の種類は `FxPlayer.ts` の `GENRE_FX`（なければライザー）。パーカッションのパターンは `PercPlayer.ts` の `PERC_PATTERNS`（なければローファイの定義）。
  - UI のジャンル一覧は `index.html` の3か所（シンプルモードのチップ `data-genre`、カスタムモードの `#c-genre`、曲一覧の `data-ml-genre`）と `CustomState.ts` の `APP_GENRES`（ドラムのカテゴリの並び順）、`SimpleScreen.ts` の `GENRE_DESCRIPTIONS`（ジャンルの一言の説明）と `MOOD_GENRES`（雰囲気ごとに選べるジャンル。どれか1つ以上の雰囲気に入れる）にも足す。
  - `chord_progressions.json` / `drum_patterns.json` の `genre` タグにも新ジャンルを付ける。シンプルモードの最初の候補は `easy_mode_table.json` の ID から、差し替え候補はそれに加えてジャンル・雰囲気のタグが一致するものから選ばれる。コード進行のディグリー・`type` が `degree_resolver.ts` に未定義だと鳴らすときに例外になるので、足したら確かめる。
  - 4/4・16ステップの前提で表せないジャンル（3連符の音符、32分のハイハットロール、3拍子など）は今の仕組みでは作れない（跳ねたノリはスウィング・8分のシャッフル（`swingUnit`）で出せる）。
- ドラムのトラック名は `kick` / `snare` / `hihat_closed` / `hihat_open` / `clap` / `rim`。クローズドハイハットはオープンハイハットを止める（`DrumEngine.ts` の `CHOKES`）。周回の頭で読み込み直すとき、古いキットは鳴り終わるまで少し待ってから破棄する。
- 雰囲気「緊張感」は廃止。パターンDBの旧「緊張感」タグは「激しい」に置き換えた。
- 拍子の変更（3/4 など）と3連符の音符は保留中。現状は 4/4・16ステップ前提（カスタムモードの「拍子」の 3/4 は「準備中」で選べない）。
- 「小節数」は曲全体の最大の長さを表す（コード進行1周の長さではない）。コード進行・ドラムはその長さに達するまでループし、アレンジャーのタイムラインと書き出しの長さもこの値に合わせる。
- パートは初期状態ですべて ON（シンプルモード・カスタムモードとも。`defaultState.parts`）。保存済みの曲は保存した ON/OFF のまま開く。
- 曲の長さ（`defaultState.bars`）の初期値は 32 小節（カスタムモードの起動時・新規作成。シンプルモードは生成時に `SIMPLE_SONG_BARS` = 32 にする）。
- パートを増やしたときは、保存済みの曲に新しいパートの項目がないので、`loadSong()`（`SongLibrary.ts`）で `parts` / `volumes` を初期値で補っている（アレンジは組み立て直すので補う必要はない）。
- Git のコミット・push はユーザーが自分で行う。Claude はコミット・push しない。
- ある程度まとまった作業（機能の追加・画面の作成・不具合修正など）が終わったら、作業報告の最後にコミットメッセージ案を日本語で提示する。1行目に変更の要約（`feat:` / `fix:` / `refactor:` / `docs:` などの接頭辞付き）、空行のあとに主な変更点を箇条書きにする。案を示すだけで、コミットは実行しない。
- コメント・ログは日本語。
- Claude の出力はすべて日本語で書く。ユーザーへの返答・作業報告に加え、ツール実行時の説明（権限確認で表示される description）、ユーザーへの質問（選択肢を含む）、計画の提示も日本語にする。

## 詳しい仕様（docs/）

決まりごとの細部は `docs/` に分けてある。該当する所を触る前に読み、仕様を変えたらそちらも直す。

- [docs/generation.md](docs/generation.md) — 自動生成とパート：メロディの生成規則（跳躍の直し方・音域）、コード進行の選び方、ベース・アルペジオ・サブベース、カウンターメロディ・パーカッション・シグネチャー・FX / SE、自動チェック
- [docs/arrangement.md](docs/arrangement.md) — 曲の構成：アレンジ（構成のプリセット＋変えた所）、セクション（Aメロ／サビ）・転調・エンディング・フィル、アレンジャーの操作、再生（arrangementGate・再生し直す条件・ループ再生）
- [docs/sound.md](docs/sound.md) — 音：grow（内部シンセ）の組み込み、ドラムの音源、音の流れ・ボイシング・音量（`gain` の測り方）、グルーヴ（スウィング・シャッフル・サイドチェイン）、書き出し（WAV / MP3 / MIDI）
- [docs/ui.md](docs/ui.md) — 画面：シンプルモード・カスタムモード（スキン・「もっと調整」・ミキサー）、ピアノロール、ミュージックリスト・曲ファイル・出力フォルダ、元に戻す／やり直す、設定画面、試聴、音楽クイズ
- [grow/README.md](grow/README.md) — grow（C++ のシンセ）の作り・ビルド・測定

## 既知の問題（修正時に注意）

- ドラムのワンショット音源は `public/samples/drums/default/` にしかなく（`rim` もない）、ジャンルのフォルダは空、`trance/` フォルダはない。
- `npm run dev` は Electron も起動し、Electron を閉じると Vite も終了する。VS Code の拡張機能など `ELECTRON_RUN_AS_NODE=1` が設定された環境から起動すると Electron が起動に失敗する。
