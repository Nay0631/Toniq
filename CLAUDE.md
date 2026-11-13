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
  PianoRollTab.ts         ピアノロール（メロディの入力・編集。シンプルモード／カスタムモードの両画面で共通。ツールバーの「メロディ／ドラム」で切り替える）
  DrumRoll.ts             ピアノロールのドラム（行 = キック・スネアなど、列 = 16分音符のマスでオリジナルのドラムパターンを作る。1・2・4小節）
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
- カウンターメロディ（`CounterPlayer.ts`）はメロディに寄り添うもう1本の旋律。曲全体の並び（`songProgression()` / `songMelody()`）から `counterNotes()` で毎回同じ形に作る（AppState には持たない。メロディを編集すれば追従する。`reloadLayer("melody")` はカウンターメロディも読み込み直す）。
  - サビ（コードの `section` が B）はハモり：メロディの各音と同じ位置・長さで、3度下（なければ6度下・4度下）のスケール音。強拍（1・3拍目）はコード構成音を強く好む。G3 より下になる音は休む。
  - Aメロ（それ以外。試聴・サンプルも）は合いの手（オブリガート）：次の発音まで半小節以上空く所に、発音の1拍あとから8分音符2〜4音のフレーズを G4〜C6 のペンタトニックで入れる（最初と最後はコード構成音、鳴っているメロディと短2度・長7度でぶつけない、次のメロディの発音の前に終わる、サビに食い込まない）。1小節に1つまでで、続く小節には入れない。メロディが細かいジャンル（8bit・テクノ）では Aメロではほとんど鳴らないので、標準アレンジでは主にサビ（とメロディの間が空くジャンルの Aメロ）に置く。
  - 音は grow（`growSounds.counter`。ジャンルの標準は `Grow.ts` の `COUNTER_STANDARD`）。MIDI書き出しも同じ音。ジャンルを足すときは `COUNTER_STANDARD` にも足す（なければローファイの定義）。
- パーカッション（`PercPlayer.ts`）はドラムに重ねる小さな打楽器（`shaker` / `tambourine` / `conga_high` / `conga_low` / `ride`）。ジャンルごとに Aメロ・サビ（`sectionAt(bar)`）の16ステップのパターン（`PERC_PATTERNS`。`X` = 強く、`x` = 普通、`o` = 弱く、`.` = 休み。ないジャンルはローファイ）で鳴らし、サビのほうをにぎやかにする。音はドラムの音源に合わせ、`"grow"` なら grow の「パーカッション …」のプリセット（`SynthFactory.ts` の `GROW_PERC`）、それ以外はシンセ（ワンショット音源はない）。ドラムのバスは通さず、150Hz から下を削ってジャンルのキットの高域カット（11kHz より下げない `PERC_LOWPASS_MIN`）だけ通し、全体を `PERC_TRIM_DB`（−6dB）下げる（`createPercKit`）。エンディングの小節では鳴らさず、揺らぎはドラムの揺らぎ（`drumHumanize`）に合わせる。サイドチェインでは沈めない。MIDI書き出しはチャンネル10の別トラック（GM の音の番号。シェイカーは Maracas）。ジャンルを足すときは `PERC_PATTERNS` にも足す。
- サブベース（`AppState.bassSub`。`null` = ジャンルの標準で `bass_params.json` の `sub`。EDM・トランス・テクノが ON。`SONG_FIELDS` に含む）：ベースの各音を E1〜D#2 にたたんだ高さ（`subMidi`。オクターブ上の `O` もルートになる）で、grow の「サブベース」（なければ Tone.js のサイン）を −6dB（`SUB_LEVEL_DB`）で重ね、本体のベースは 90Hz から下を削る（`BassPlayer.ts`）。カスタムモードの設定タブの「追加パート」欄で選ぶ。音色と同じく再生開始時に反映される（再生中に変えたら再生し直す）。MIDI書き出しはしない。ジャンルを足すときは `bass_params.json` に `sub` も入れる。
- シグネチャー（`SignaturePlayer.ts`）はジャンルの特徴を出す追加パート。EDM = オフビートのコードスタブ、テクノ = アシッド（16ステップ表記 R/O/F、大文字はアクセント）、8bit = 32分音符の高速アルペジオ、ローファイ = レコードノイズ（ヒス＋ランダムなプチプチ音）、ゲームBGM = ブラス、ハウス = シンコペーションのピアノスタブ、トランス = スーパーソウのコードを16分で刻むトランスゲート、アンビエント = うねる風のノイズ。ジャンルごとに `label` / `create`（Synth とエフェクト）/ `events`（コードごとの発音）を定義する。音色はほかのパートと同じく再生開始時に反映される。MIDI書き出しは未対応。
- FX / SE（`FxPlayer.ts`）はループの継ぎ目を演出する効果音。種類は `AppState.fxType`（`SONG_FIELDS` に含む）で、`"auto"` はジャンルの標準（`GENRE_FX`）。カスタムモードのドラム欄の下の「FX / SE」で選び、「▷ 試聴」はループの終わりの盛り上げから次のループの頭の1小節まで鳴らす（`Playback.preview("fx")`）。
  - アレンジャーの FX のブロックは1つずつ種類を持てる（`ArrangeBlock.fx`。ブロックのラベルのセレクトで選ぶ。なし = 曲の設定 `fxType`）。鳴らすときは発音時刻にあるブロックを `arrangementBlockAt("fx")`（`LoopArranger.ts`）で調べて種類を決めるので、再生中の変更もすぐ反映される。音源は種類ごとに1つで、曲の設定とアレンジで使う種類を読み込み時に作る（WAV書き出しでは鳴らしている途中に作れないため）。再生中に新しい種類を選んだときは鳴らす直前に作る。
  - 種類（`FX_DEFS`）：`riser` = ライザー（ノイズのバンドパス掃き上げ＋2オクターブ上がる重ねたノコギリ波、トレモロ・オートパンが加速）、`build` = ライザー＋インパクト、`impact` = インパクト（沈むブーム＋閉じていくノイズ）、`downlifter` = ダウンリフター、`reverse` = リバースシンバル、`chip` = チップSE（8bit。矩形波の駆け上がり＋「ピュン」）。
  - 各種類は `rise`（ループの終わりに向けて鳴り、ループの頭ちょうどで終わる。`riseLen` が `bars` なら1小節＝8小節以上の進行は2小節、`2n` なら最後の2拍）と `hit`（ループの頭）の片方または両方を持つ。音量の山は `setValueCurveAtTime` の曲線でかけ、終わりは短いフェードでクリックを防ぐ。
  - 広がり：ノイズは左右別々のノイズ（`stereoNoise`）で鳴らし、各種類の音は `space()`（左右で揺れのずれたコーラス → 左右に跳ねるディレイ）を通す。インパクトの低音のブームは中央のまま広げない。チップSE はコーラスなし（ディレイだけ）。後ろの響きは自前のリバーブを持たず、マスターのリバーブ送りとロングリバーブで付ける。
  - 音は grow で出す（`GROW_FX`。コアの「FX …」のプリセット（ID は `fx_…`）を ID で探し、長さで変わる EG の時間などは、鳴らすたびに `GrowInstrument.setParamAtTime` で発音の少し前（`PARAM_LEAD`）に当てる。AudioParam の合図なので書き出しでもサンプル単位で合う）。grow の準備ができていない・プリセットがない（wasm が古い）ときは `FX_DEFS`（Tone.js）で鳴らす。ライザー・ダウンリフターの音程は、ピッチ EG を直線のカーブにし、時間を長さいっぱいにして一定の速さで動かす（2オクターブ下から上がる／3オクターブ上から下がる）。
  - 種類を足すときは `FxType`（`AppState.ts`）・`FX_DEFS`・`GROW_FX`・`index.html` の `#c-fx-type` にそろえて足す。音色は再生開始時に反映される。
- パートを増やしたときは、保存済みの曲に新しいパートの項目がないので、`loadSong()`（`SongLibrary.ts`）で `parts` / `volumes` / `arrangement` を初期値で補っている。
- ピアノロール（`PianoRollTab.ts`）はコード進行1周分（メロディのループの長さ）を表示し、`AppState.melodyNotes`（サビを選んでいるときは `chorusMelodyNotes`）を直接編集する（鳴る音だけを持ち、休符は持たない）。編集中のセクションは表示上の一時的な状態としてモジュール内に持つ。「自動生成」は Aメロとサビの両方を作り直す。編集すると `melodyMethod` は `"manual"` になり、「自動生成」で `"auto"` に戻る。メロディは単音なので、重なる音は手前で切るか消す。再生中の編集はメロディだけ読み込み直して（`reloadLayer("melody")`）すぐ反映する。
- メロディは起動時・「＋ 新規作成」では作らず空のまま。自動生成ボタン（ピアノロールの「自動生成」、シンプルモードで「自動生成」を選んで「生成する」／「↻ 再生成」）を押したときに初めて作る。`melodyMethod === "auto"` でも `melodyNotes` が空なら未作成として扱い、コード進行・キーを変えても自動では作らない（作成済みなら作り直す）。
- ピアノロールの入力設定（音符長 `pianoRollLength`・スケールロック `pianoRollScaleLock`・オクターブ `pianoRollOctave`）は AppState に置く。スケールロックはコード進行の `scaleLock` とは別。スケールの7音は `SCALE_TONES`（core＋accent）から作る。選択中の音と鍵盤入力の位置は表示上の一時的な状態としてモジュール内に持つ。
- ピアノロールの操作：クリックで配置（そのままドラッグで長さ）、音をドラッグで移動、右端で長さ変更、右クリック／Delete で削除、目盛りクリックで鍵盤入力の位置、A〜K（W E T Y U が黒鍵）で鍵盤入力、Z / X でオクターブ切替。
- ミュージックリスト（`SongLibrary.ts`）は曲の内容（`SONG_FIELDS`：モード・ジャンル・キー・BPM・小節数・パターン・メロディ・音色・アレンジ・パートON/OFF・音量）を localStorage に保存する。画面・タブ・ピアノロールの入力設定は保存しない。曲の内容に関わる項目を AppState に足したら `SONG_FIELDS`（`AppState.ts` に定義）にも足す。`SONG_FIELDS` は曲ファイルと元に戻す／やり直すの対象にもなる。
  - localStorage に書き込めない（容量オーバーなど）と `writeSongs` が `SongStorageError`（`quota` = 容量オーバーか）を投げ、一覧は書き込む前のまま残る（`saveCurrentSong` は `songId` も変えない）。画面側（`MusicListScreen.ts`）は `saveToList`（「♪ 保存」。編集中の曲は消えないので、整理してから保存し直すよう知らせる）と `withStorage`（名前の変更・お気に入り・削除）で受けて知らせる。曲ファイルの読み込みは今までどおりファイルごとのエラーとして出す。ミュージックリストを書き換える操作を足すときも、どちらかで囲む。
- 曲ファイル：ミュージックリストのツールバーの「ファイルを読み込む」「すべて書き出す」と、曲の ⋮ メニューの「ファイルに書き出す」。形式は `{ format: "toniq-song", version, exportedAt, songs: SavedSong[] }` の JSON（拡張子 `.toniq.json`）。読み込んだ曲は新しい ID で一覧に追加する（上書きしない）。コード進行・ドラムなど鳴らすのに必要な項目がない曲は飛ばし、足りない項目は `loadSong()` と同じく初期値で補う。形式を変えるときは `FILE_VERSION` を上げ、古い形式も読めるようにする。
- 元に戻す／やり直す（`History.ts`）：`setState` の直前（`onBeforeSetState`）に、`SONG_FIELDS`（モードを除く）が変わるなら変更前のスナップショットを積む（最大100）。押してから離すまで（ドラッグ・ノブ）と、操作が途切れるまで（600ms）の変更は1つにまとめる。シンプルモード・カスタムモードの画面でだけ使え、文字の入力欄ではブラウザ標準の元に戻すになる。
  - 表示用の一時的な差し替え（ジャンルのサンプル試聴など）は `withoutHistory()` で囲んで履歴に残さない。描画関数の中で曲の内容を `setState` しない（やり直しの履歴が消える）。
  - 曲を開いた（`loadSong`）・新規作成（`newSong`）・起動時は履歴を捨てる（`resetHistory`）。
  - 戻したとき再生中なら、アレンジ・音量・パートON/OFF・メロディだけの変更はその場で反映し、それ以外は各画面の `restartIfPlaying()` で再生し直す。
- 用語のツールチップ（`Glossary.ts`）：要素に `data-term="キー"` を付けると、カーソルを乗せる（キーボードならフォーカスする）と少し待って `TERMS` の説明を出す。`span` とアレンジャーのレーン名には点線の下線が付く。パート名（`LayerName`）はそのまま `TERMS` のキーとして使う（アレンジャー）。説明は初心者向けに1〜2文で、専門用語を重ねない。新しい用語を画面に出したら `TERMS` に足して `data-term` を付ける。
  - ドロップダウンの選択肢（`<option>`）にも `data-term` を付けられる（キーは `scale.<スケール>`・`chordRhythm.<リズム>`・`fx.<種類>`・`sound.<grow のプリセット ID>`・`melodySound.<メロディの音色>` の形）。リストの項目にカーソルを乗せる（キーボードで選ぶ）とリストの横に出す。リストはトップレイヤーに描かれるので、ツールチップは popover（`popover="manual"`）で出し直して上に重ねる。`TERMS` にないキーの選択肢は何も出さない（grow のプリセットは説明を足したものだけ出る）。
  - ON/OFF は設定画面で切り替える（`AppState.tooltips`、localStorage の `toniq.tooltips` = `on` / `off`、`<html data-tooltips>`。OFF では下線も出さない）。`<head>` でも描画前に `data-tooltips` を付ける。曲の内容ではないので `SONG_FIELDS` には入れない。
- 設定画面（`SettingsScreen.ts`、`data-screen="settings"`）はメニューの横長の「設定」カードから開く。端末ごとの設定（配色・スキン・音名の表記・ループ再生・ドラムの音源・ツールチップ）を集める。曲に保存する項目は置かない。設定を足すときは AppState に項目を足し、保存は担当のモジュールが localStorage（`toniq.*`）に行い、表示の切り替えは `<html data-*>` で行う。
  - 最後の「ヘルプ」欄（`index.html` の `.settings-help`。`<details>` の開閉式で、JS はなし）に、見ただけではわかりにくい操作（ピアノロール・アレンジャーのマウス・キー操作、ノブの Shift・ホイール、タップテンポ、元に戻すのショートカット、保存の種類、試聴、テスト中の機能）を書いている。操作を足す・変えたらここも直す。
- 作業ファイル（今の曲1曲分を .toniq.json に保存・開く機能。情報バーの「⇩ 作業ファイル」・メニューの「作業ファイルを開く」・`AppState.projectPath`・`output/projects`）は、ミュージックリストへの保存とほぼ同じなので廃止した。曲をファイルで移すときはミュージックリストの曲ファイル（「ファイルに書き出す」「すべて書き出す」「ファイルを読み込む」）を使う。
- 出力フォルダ：
  - Electron では WAV / MP3 / MIDI を、書き出す前に `askFileName()`（`FileNameDialog.ts`。Electron では `prompt()` が使えないので自前のダイアログ）でファイル名を決め、`saveOutput()`（`OutputFiles.ts`）で `output/audio` / `output/midi` に直接保存し（同名なら「 (2)」を付けて上書きしない）、保存後にフォルダを開くか聞く。
  - 出力フォルダの場所は開発時が toniq フォルダの `output/`、インストール版は Toniq.exe と同じ場所の `output/`（書き込めなければ「ドキュメント/Toniq/output」）。起動時に作る。 ミュージックリストのツールバーの「出力フォルダ」ボタン（`MusicListScreen.ts`）で開く。
  - ブラウザで開いたとき（`window.toniqFiles` がない）は、書き出しはダウンロードになり、「出力フォルダ」ボタンは隠す。
- `AppState.songId` は今の曲がリストのどの曲か（`null` = 未保存）。リストから開いた・保存した曲は「上書き保存」になり、シンプルモードで生成し直すと `null` に戻って新しい曲として保存される。リストで再生・開くと、その曲を今の曲として読み込む（未保存の曲があれば確認する）。 ミュージックリストの曲の行には「編集」ボタン（`data-action="open"`。曲のモードで開く）を出す（以前は ⋮ メニューの中にあって気づきにくかったため。曲名のダブルクリックでも開く）。⋮ メニューは名前の変更・ファイルに書き出す・削除。
- 両モードの情報バーの「＋ 新規作成」は、確認のうえ再生を止めて `newSong()`（`SongLibrary.ts`）で曲の内容（`SONG_FIELDS`）を `defaultState` に戻し、`songId` を `null` にする。モードはそのまま、シンプルモードは設定画面（`generated: false`）に戻る。パターンは起動時と同じく初期のジャンル・雰囲気で決め直す（メロディは空にする）。
- 配色は選び方を `AppState.themeMode`（`light` / `dark` / `system` = OS に合わせる）、実際の配色を `AppState.theme` に置き、`Theme.ts` が `<html data-theme>` に反映して localStorage の `toniq.theme` に保存する（未保存か `system` なら OS の設定に合わせ、OS の配色が変わったら追従する。ヘッダーのボタンはライト／ダークを明示的に選ぶ。曲の内容ではないので `SONG_FIELDS` には入れない）。`index.html` の `<head>` でも同じキーを読んで描画前に `data-theme` を付ける。
- カスタムモードのスキン（`AppState.skin`。UI 表示名は デフォルト／フラット／スタジオ／ポップ）：
  - `"default"` = メニュー・シンプルモード・ミュージックリストと同じ見た目（初期値）、`"flat"` = フラットなプラグイン風、`"studio"` = 少し暗い制作スタジオ（DAW）風、`"pop"` = クリーム色の地に色分けしたグルーヴボックス風。
  - 選ぶのは設定画面だけ（カスタムモードの情報バーの切り替えボタンは廃止した）。`Theme.ts` が `<html data-skin>` に反映し、localStorage の `toniq.skin` に保存する（`SONG_FIELDS` には入れない。`<head>` でも描画前に付ける）。旧名の `plugin` / `daw` は `flat` / `studio` として読む。
  - `styles.css` の `:root`（ライト）／`:root[data-theme="dark"]` の `--hw-*` などの値と、`.hw …` の無印のスタイルはフラットスキン。ほかのスキンは後ろでトークンと形を上書きする。
  - デフォルトスキンは `:root[data-skin="default"]` でトークンをアプリ共通のトークン（`--surface` / `--border` / `--custom` など）に向けるので、ライト／ダークにそのまま追従する。形（カード・下線のタブ・枠付きのセレクトなど）は `[data-skin="default"] …` で戻す。
  - スタジオスキンは `:root[data-skin="studio"]`（ダークは `:root[data-theme="dark"][data-skin="studio"]`）でトークンを上書きし、形の違い（見出しの帯・箱型のドロップダウン・クリップ風のブロック）だけ `[data-skin="studio"] .hw …` で足す。
  - ポップスキンは `:root[data-skin="pop"]` のトークンに加え、モジュールの色 `--mod`（設定タブの列・アレンジャーごと）とパートの色 `--part`（`--pop-*`。アレンジャーのブロック）で塗り分け、色の上の文字は白にする。
  - トークンを足すときはフラット（ライト／ダーク）・デフォルト・スタジオ・ポップの各スキンに値を入れる。
- ドロップダウン（`<select>`）は `appearance: base-select`（customizable select）でリストをページの中に描く（`styles.css` の末尾）。Electron（Windows）ではネイティブのリスト（OS の別ウィンドウ）が再生の有無に関係なく 30 秒ほど開かないことがあったため（Chrome では起きない）。各スキンの `.hw .select` などが `appearance` を上書きするので、そこだけ `!important`。▾ を背景で描いているセレクトはブラウザの ▾（`::picker-icon`）を消す。リストの色は `::picker(select)` と `option` にトークンで付ける。
- `styles.css` では色を直書きせず、`:root` のトークン（`var(--…)`）を使う。トークンを足すときは `:root[data-theme="dark"]` にもダーク用の値を足す。例外はパートの識別色（`.arr-*` / `.dot-*` のパステル）とアクセント色の上の白文字・クイズの黒鍵で、どちらのテーマでも同じ色を使う。
- カスタムモードの設定タブ・アレンジャータブ（`.hw`）と情報バー（`.hw-bar`）とタブ（`.hw-tabs`）はスキンで見た目が変わる。フラットスキンの形はシンセサイザーのプラグイン風（区切り線で仕切ったフラットなグレーの面、白いノブと細い色の弧、下線付きのドロップダウン、グレーの値の箱、情報バー・タブ・小節の目盛りは黒い帯、選択中はオレンジの枠）。色は `--hw-*` / `--knob-*` / `--slider-*` / `--track-*` のトークンを使う。BPM はノブ、コード進行・ドラムパターンは ◀▶ で切り替え（`Controls.ts`）。AppState から range の値を書き換えたら `syncControls()` で見た目をそろえる。
- ミキサー（`MixerPanel.ts`、`#c-arr-mixer`）はアレンジャータブのタイムラインの下にだけ置く（設定タブには置かない）。左端に dB 目盛り、パートごとのチャンネル（色・名前、ON/OFF ボタン、縦フェーダー `attachFader`＋レベルメーター、値 0〜100）、右端にマスターのメーターと dB。フェーダーは `VolumeManager.setVolume` で `AppState.volumes`（初期値は `defaultState.volumes`。曲に保存され、元に戻す／やり直すの対象）を書き換え、Volume ノードにもすぐ当てる。メーターは再生中だけ `Tone.Meter`（パートはサイドチェインの Gain のあと、マスターはリミッターのあと。WAV / MP3 書き出しのコンテキストには作らない）を読む。パートの ON/OFF はミキサーの ON ボタン、アレンジャーのレーンの ON ボタン、設定タブの「追加パート」欄（パッド／アルペジオ／シグネチャー／カウンターメロディ／パーカッション）のボタンで切り替える。
- メニューへの導線は、メニュー以外のすべての画面の上部に出るパンくずの「メニューに戻る」ボタン。ヘッダーの「⋯」メニューとシンプル／カスタムの切り替えボタンは廃止した。
- カスタムモードには「生成する」ボタンを置かない（設定の変更はその場で反映され、メロディの作り直しはピアノロールの「自動生成」で行う）。情報バーの主ボタンは「▷ 再生」。
- ミュージックリストの絞り込み・並び順（`musicListQuery` / `musicListGenre` / `musicListFavorites` / `musicListSort`）は AppState に置く。⋮ メニューを開いている曲・名前を変更中の曲は表示上の一時的な状態としてモジュール内に持つ。お気に入りは曲データ（`SavedSong.favorite`）に保存する。
- 音楽クイズは初心者向け。カテゴリは「音の高さ」「コード・スケール」「リズム・音響」「用語」の4つで、各カテゴリの中はやさしい順に並べる。上級者向けの内容（テンション・転回形・ミックスの聴き分けなど）は足さない。
- 音名の表記（`AppState.noteNames`：`cde` / `doremi`）はアプリ全体の設定。設定画面と音楽クイズのツールバーのどちらでも切り替えられ、`Preferences.ts` が `toniq.noteNames` に保存する。表示は `format.ts` の `displayNote`（`"C#4"` のようなオクターブ付きも可）で変える。単音（ピアノロールの鍵盤・音符、クイズの単音・構成音）だけを変え、コード名・キー名は CDE 表記のまま（カスタムモードのルート音の選択肢は、ドレミ表記なら `A（ラ）` のように読みを添える）。
- ループ再生（`AppState.loopPlayback`、設定画面、`toniq.loop`）：ON なら `Playback.play()` が自動停止の代わりに Transport を曲全体（先頭〜`AppState.bars` 小節）でループさせる（`applyLoopPlayback`。再生中に切り替えてもすぐ反映）。周回の表示は発音時刻の小節から求めるので、先頭へ戻ると1周目から数え直す。試聴・サンプル・WAV書き出しはループしない。
- 音楽クイズ：選んでいる出題モード（`quizMode`）は AppState に置く。出題中の問題・成績（正解数・連続）は表示上の一時的な状態として `QuizScreen.ts` に、出題設定は各モード（`QuizModes.ts`）に持つ（どちらも保存しない）。モードを足すときは `QuizMode`（`settings` と `question()`、必要なら出題設定に出すおすすめ `hint`）を作って `QUIZ_CATEGORIES` に加える。問題は回答方法（`choice` 選択肢／`notes` 鍵盤で複数選択／`key` 鍵盤を1つ押す）、回答後の一言の解説（`explain`）、再生ボタン（`sounds`、`afterAnswer` で回答後だけ表示）で表す。
- クイズの音名の表記：単音・構成音は `displayNote`（`format.ts`。`QuizModes.ts` から再エクスポート）で今の表記にする。コード名・キー名は CDE 表記のまま。`notes` / `key` の正解は CDE 表記（`NOTES`）で持ち、表示するときに変換する。表記を切り替えると新しい問題を出す。
- BPM の試聴（`Metronome.ts`。シンプルモードの「♪ クリックで試聴」、カスタムモードの BPM ノブ横の「♪ 試聴」）は、曲の再生（Tone.js）とは別のオーディオコンテキストで 4/4 のクリック音（1拍目は高い音）を鳴らす。拍ごとに `AppState.bpm` を読むので、鳴らしたまま BPM を変えるとすぐ反映される。鳴っているかどうかは表示上の一時的な状態としてモジュール内に持つ（保存しない）。曲の再生・試聴の開始、画面の切り替え、シンプルモードの生成で止める。
- キー・スケールの試聴（`ScalePreview.ts`。カスタムモードの「スケール・キー」欄の「響き」の「▷ 試聴」）は、今のキー（`AppState.key`）とスケール（`chordPattern.base_scale`）で、主音から1オクターブ上までの8音（主音は A3〜G#4）を順に鳴らし、最後に主音の和音を鳴らす。スケールの7音は `scaleSemitones()`（`degree_resolver.ts`。`SCALE_TONES` から作る。ピアノロールのスケールロックと共通）。曲の再生とは別のオーディオコンテキストで鳴らし、欄に並べた音名（`displayNote` で今の表記）のうち鳴っている音を光らせる。鳴っている・何音目かは表示上の一時的な状態としてモジュール内に持つ。鳴らしたままキー・スケールを変えると鳴らし直す。曲の再生・試聴・サンプルの開始、BPM のクリック音、画面の切り替えで止める。
- ジャンルの試聴（シンプルモードの設定画面、ジャンルのチップの下の「▷ ○○ のサンプルを聴く」と一言の説明 `GENRE_DESCRIPTIONS`）：
  - ジャンルのチップは雰囲気で絞り込む（`MOOD_GENRES` の順に並べ、合わないジャンルは隠す。開いた曲のジャンルが外れていても選んでいるジャンルは出す）。雰囲気を選び直して今のジャンルが合わなければ、合うジャンルの先頭に切り替える（テンポのプリセットもそのジャンルの BPM に）。
  - 説明文は `{TERMS のキー:文字}` と書いた所を用語のツールチップ付きの span にして表示する（`renderGenreDesc`）。
  - 選んでいるジャンル・雰囲気から `resolveSimpleMode` でパターンを選び、メロディを自動生成して `Playback.playSample()` で鳴らす。
  - コード進行1周（4小節未満なら4小節）を、ドラム・パーカッション・コード・ベース・パッド・シグネチャー・メロディをアレンジに関係なく同時に鳴らす（`Playback.ts` の `SAMPLE_LAYERS`。FX / SE・カウンターメロディは鳴らさない）。
  - 各パートは AppState から読むので、鳴らしている間だけ `chordPattern` / `drumPattern` / `melodyNotes` を差し替え、`Playback.stop()` で元に戻す（曲の内容は変わらない）。
  - サンプル中にジャンルを選び直すとそのジャンルのサンプルに切り替わり、テンポを変えるとすぐ反映される。画面の切り替え（`stopSample()`）・生成・ほかの再生で止まる。
- クイズの音は曲の再生（Tone.js）とは別のオーディオコンテキストで鳴らす。新しい音を鳴らす・次の問題へ進む・画面を離れると前の音を止める。クイズ画面に入ると曲の再生は止める。
- 基本設計書（仕様書・図）を作る・直すときは `docs/基本設計書/基本設計書の作成手順.md` に従う。仕様書.md の更新・図の作成と更新・docx の作成は、それぞれスキル `update-spec` / `update-diagrams` / `build-design-doc`（`.claude/skills/`）の手順で行う。コードは `git fetch origin` のあと `origin/main` を見る（ローカルの `main` は古いことがある）。
- 設計書の図（PlantUML。`docs/基本設計書/図/`）を作る・直すときは、`docs/基本設計書/図/CLAUDE.md` の決まりに従う。
- Git のコミット・push はユーザーが自分で行う。Claude はコミット・push しない。
- ある程度まとまった作業（機能の追加・画面の作成・不具合修正など）が終わったら、作業報告の最後にコミットメッセージ案を日本語で提示する。1行目に変更の要約（`feat:` / `fix:` / `refactor:` / `docs:` などの接頭辞付き）、空行のあとに主な変更点を箇条書きにする。
  続けてプルリクエストの説明文案も日本語で提示する。見出しは「概要」（何をなぜ変えたかを1〜3文）・「変更内容」（箇条書き）・「動作確認」（型チェックの結果と、画面で確かめる手順のチェックリスト）・「補足」（注意点・未対応の点。なければ「なし」）。
  どちらも案を示すだけで、コミット・PR の作成は実行しない。
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
- MIDI書き出し（`exportMidi()`。AppState を読む）は再生と同じ音の並びを使う：曲全体の並び（`songProgression()` / `songMelody()`。セクション・エンディング込み）から、メロディ・コード（`chordEvents()`。コードのリズム込み）・パッド（`padEvents()`）・アルペジオ（`arpNotes()`）・ベース（`bassNotes()`。ジャンル別パターン、強さは `bassVelocity()`）・カウンターメロディ（`counterNotes()`）・ドラム（チャンネル10、GM の音の番号。ブロックごとのパターン・フィル・エンディングも反映。`drumStepHits()`）・パーカッション（チャンネル10 の別トラック。`percStepHits()`）。曲全体（`AppState.bars` 小節）をループで埋め、アレンジのブロックの外・OFF のパートは書き出さない。シグネチャー・FX / SE は音色が特徴のパートなので書き出さない。サブベースはベースと同じ音なので書き出さない。音色（GM の番号）は目安。強さの揺らし・ストラムは入れない。
- カスタムモードの「雰囲気」はコード進行の「カテゴリ」として選ぶ。スケールは `chordPattern.base_scale` から決まり（別に持たない）、スケールを選ぶとそのスケールのコード進行に切り替わる。
- コードのリズム（`chordRhythm`）・コードの音色（`growChordPreset`）・メロディの音色（`melodyInstrument`）は ChordPlayer / MelodyPlayer が AppState から読む。コードの音色は grow のプリセット（ChordPlayer の Tone.js の音色は wasm がないときの `FALLBACK` だけ）。メロディの音色の定義は MelodyPlayer の `INSTRUMENTS`。メロディの音色は初期値 `auto`（ジャンルの標準。`melody_params.json` の `instrument`）で、MelodyPlayer の `INSTRUMENTS` は Synth とエフェクト（ビブラート・ディレイなど）の組で定義する。ジャンルを追加するときは `instrument` も指定する。音色は Synth を作り直したとき（再生開始時）に反映される。
- パートの ON/OFF は `setLayerEnabled` で切り替える（OFF で破棄、再生中に ON にするとすぐ読み込み、アレンジ上ブロックのある小節から鳴る）。アレンジャーで OFF のパートにブロックを置くと ON になる。
- シンプルモードの曲の長さは 32 小節（`SimpleScreen.ts` の `SIMPLE_SONG_BARS`。生成時・コード進行の差し替え時に設定する）。
- シンプルモードの「生成された楽曲」の波形は実際の音声ではなく、周回ごとのパート数とドラムの強さから描いた表示用のもの。
- 各パートの Synth はモジュールに1つずつ。WAV書き出しは再生を止めて Synth を作り直し、終わったら破棄する。再生中に書き出すと再生は止まる。
- WAV書き出し（`Playback.renderWav(onProgress)`）は進み具合を知らせる。Tone.Offline は途中経過を返さないので、`renderOffline` がブラウザ標準の `OfflineAudioContext` を `Tone.OfflineContext` で包んで同じ手順で描画し、合成の途中を `suspend()` で区切って（`RENDER_STEPS` 回）進み具合を知らせる。段階は `prepare`（準備）→ `schedule`（Tone.js が演奏の予定を組み立てる。`currentTime` で測る）→ `render`（音声の合成）→ `encode`（WAV に変換）で、全体の割合は `STAGE_SPAN`。失敗したとき・鳴らすパートがあるのに無音のときは Tone.Offline で描き直す（進み具合なし）。UI は `ExportProgress.ts` の `exportAudioWithProgress(format, …)` を使う。
- MP3書き出し（`Playback.renderMp3(onProgress)`）は WAV と同じ `renderSong()` で合成した音声を `@breezystack/lamejs`（純 JS の MP3 エンコーダ。ES モジュール対応版の lamejs）で 192kbps に変換する。エンコーダは書き出すときだけ動的に読み込む。変換は重いので `MP3_CHUNK` ごとに区切って画面に返し、`encode` の段階の進み具合を知らせる（全体の割合は `STAGE_SPAN.mp3`）。ボタンは両モードの書き出し欄（`s-export-mp3` / `c-export-mp3` / `c-arr-export-mp3`）。
- `Playback.play()` は開始時点の AppState で各パートを読み込むので、再生中に曲の内容（コード進行・ドラム・メロディ・キーなど）を変えたら先頭から再生し直す（アレンジの編集だけは再生し直さなくてよい）。
