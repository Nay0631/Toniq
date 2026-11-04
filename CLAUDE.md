# CLAUDE.md

Toniq — ルールベース自動作曲アプリ（Electron + Vite + TypeScript + Tone.js）。
ジャンルと雰囲気を選ぶと、JSON のパターンDBからコード進行・ドラムを選び、ベース／アルペジオ／パッド／メロディを自動生成してループ再生する。

## コマンド

```bash
npm run dev             # ブラウザで開発（Vite, http://localhost:5173）
npm run electron:dev    # Electron で開発起動
npm run build           # tsc + vite build
npm run electron:build  # インストーラ作成（release/）
```

テスト・Lint は未導入。変更後は `npx tsc --noEmit` で型チェックする。

## ディレクトリ構成

```
electron/main.ts        Electron メインプロセス（ウィンドウ生成のみ）
index.html              UI。ヘッダー＋画面ごとの <section data-screen="…">（menu / simple / custom / musiclist / quiz）
src/main.ts             エントリ。初期状態の解決と各画面の初期化
src/ui/
  Router.ts               画面・タブ切り替え（showScreen / showTab / render / onRender）。AppState.screen / tab
  SimpleScreen.ts         シンプルモード画面（設定→生成→結果、差し替え、書き出し）
  CustomScreen.ts         カスタムモード画面の設定タブ（基本設定／スケール・キー＋コード進行／ドラム・パッド/アルペジオ・パート別音量の3列）とアレンジャータブ下部（差し替え・音量・書き出し）
  ArrangerTab.ts          アレンジャーのタイムライン（パートごとのブロックの配置・移動・長さ変更・削除、再生位置）
  format.ts               表示用ヘルパー（スケール名、キーに合わせたコード名、時間）
  styles.css              デザイントークンと共通スタイル
src/data/               楽曲データとデータ型
  types.ts                ChordProgression / DrumPattern 型
  degree_resolver.ts      ディグリー → 実音の変換（resolveChord）、メロディ用のスケール音の役割（SCALE_TONES）
  chord_progressions.json コード進行DB（ディグリー表記）
  drum_patterns.json      ドラムパターンDB（16ステップ）
  easy_mode_table.json    シンプルモード用：ジャンル×雰囲気 → BPM・候補ID
  tempo_presets.json      ジャンル別テンポプリセット（ゆっくり/普通/速い）
  melody_params.json      ジャンル別メロディ生成パラメータ（リズムテンプレート・フレーズ形式・アクセント音の頻度・標準の音色 instrument など）
  bass_params.json        ジャンル別ベース設定（16ステップのパターン・音色）
  mix_presets.json        ジャンル別マスターエフェクト設定
src/engine/
  AppState.ts             アプリ状態の唯一の保持場所
  SimpleModeResolver.ts   シンプルモード：ジャンル×雰囲気からパターンを決定
  LayerManager.ts         パートのON/OFF・差し替え・再ロード
  LoopArranger.ts         アレンジ（ジャンル標準の LOOP_SCHEDULE、各パートが鳴る小節の判定 arrangementGate、周回表示）
  {Drum,Chord,Bass,Arp,Pad,Melody,Fx}Player/Engine.ts  各パートの Tone.Part 生成（Fx はループ末尾のライザーSE）
  MelodyGenerator.ts      メロディ生成（ペンタトニック中心＋アクセント音、リズムテンプレート、モチーフの反復）
  SynthFactory.ts         ドラム音源（ジャンル別キット DRUM_KITS ＋バス：高域カット→歪み→コンプ→持ち上げ）
  Playback.ts             再生・停止（AppState.bars 小節で自動停止）、再生位置、WAVレンダリング
  VolumeManager.ts        パート別 Volume ノード（0〜100 → dB）。オーディオコンテキストごとに保持
  MixerEngine.ts          マスターリバーブ／コンプ／リミッター
  Transport.ts / TapTempo.ts  BPM・再生制御、タップテンポ
  MidiExporter.ts         MIDI書き出し
  Exoporter.ts            旧WAV書き出し（全体コメントアウト済み・未使用。WAVは Playback.ts で実装）
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

- パート名は `"drum" | "chord" | "bass" | "arp" | "pad" | "melody" | "fx"`（`LayerName`）で統一。UI 表示名はドラム／コード／ベース／アルペジオ／パッド／メロディ／FX/SE。パート別音量の UI にはアルペジオも含める。
- 各パートモジュールは `init*Synth()` / `load*()` / `dispose*()` の形にそろえる。`load*` は既存の Part を破棄してから作り直す。
- ジャンル名は `EDM` / `8bit` / `ローファイ` / `ゲームBGM` / `テクノ`、雰囲気は `明るい` / `暗い` / `落ち着いた` / `切ない` / `激しい`。JSON のキー（`easy_mode_table` / `tempo_presets` / `melody_params` / `bass_params` / `mix_presets`）と完全に一致させる。見つからないときのフォールバックは `ローファイ` / `落ち着いた`。
- ジャンルは今後も追加・削除がありうる。追加するときは上の5つの JSON と `LoopArranger.ts` の `LOOP_SCHEDULE` にそろえて追加する。ドラムの音作りは `SynthFactory.ts` の `DRUM_KITS`（なければ標準キットで鳴る）。
- ドラムのトラック名は `kick` / `snare` / `hihat_closed` / `hihat_open` / `clap` / `rim`。クローズドハイハットはオープンハイハットを止める（`DrumEngine.ts` の `CHOKES`）。周回の頭で読み込み直すとき、古いキットは鳴り終わるまで少し待ってから破棄する。
- メロディ生成の規則（`MelodyGenerator.ts`）：
  - 音はペンタトニックの5音が基本。残りの2音（アクセント音）は、1拍目・3拍目の頭以外で、休符を挟まず次の音が続く位置にだけ経過音・刺繍音として置き、次の音で解決先へ順次進行させる。コード構成音になるアクセント音は普通の音として扱う。
  - リズムは `melody_params.json` の `rhythmPatterns`（16ステップ表記。`x` = 発音、`-` = 伸ばす、`.` = 休符）から小節ごとに選ぶ。各小節の最初の音はコード構成音。
  - `phraseForms`（例 `"AAAB"`。1文字 = 1小節）で同じ文字の小節は同じモチーフを使う。最初の音が新しいコードの構成音になるようスケール上でずらして繰り返す（音域に収まらなければ同じリズムで音を選び直す）。形式より長い進行は形式を繰り返す。
  - 音価は `4n` などのほか付点（`8n.` など）や `0:拍:16分` 表記も出る。MIDI書き出しは `MidiExporter.ts` の `durationToBeats` で変換する。
- ベース（`BassPlayer.ts`）はジャンルごとに `bass_params.json` のパターンと音色で鳴らす。パターンは16ステップ表記（`R` = ルート、`F` = 5度、`O` = 1オクターブ上、`-` = 伸ばす、`.` = 休符）。`patterns` を小節ごとに順に使い、コード進行1周の最後の小節は `fill`。5度はコードの構成音から取る。音色はジャンルで決まり、Synth を作り直したとき（再生開始時）に反映される。
- 雰囲気「緊張感」は廃止。パターンDBの旧「緊張感」タグは「激しい」に置き換えた。
- 拍子の変更（3/4 など）は保留中。現状は 4/4・16ステップ前提。
- 「小節数」は曲全体の最大の長さを表す（コード進行1周の長さではない）。コード進行・ドラムはその長さに達するまでループし、アレンジャーのタイムラインと書き出しの長さもこの値に合わせる。
- アレンジ（`AppState.arrangement`）はパートごとのブロック（`start` / `length`、小節・0始まり）の並び。`null` はジャンルの標準アレンジで、`LOOP_SCHEDULE` をコード進行の長さで並べて自動で組む（ジャンル・コード進行・小節数の変更に追従）。アレンジャーで編集すると初めて AppState に書き込まれ、「標準に戻す」で `null` に戻る。シンプルモードの生成時も `null` に戻す。
- 読み取りは `getArrangement()`（`LoopArranger.ts`）を通す。`AppState.arrangement` を直接見ない。
- 再生時は ON のパートを先頭ですべて読み込み、各パートの Part / Sequence のコールバック先頭で `arrangementGate(part)` を呼んで、ブロックの外の小節では鳴らさない。新しいパートを足すときも同じ形にする。判定は再生中も AppState を見るので、アレンジの編集は再生し直さなくてもすぐ反映される。試聴（`Playback.preview`）は判定を外す。
- アレンジャーでは小節番号の目盛りをクリックして再生開始位置（`AppState.startBar`）を決める。アレンジャータブの再生はそこから始まり（`Playback.play({ fromBar })`）、他のタブでは先頭から。再生中に開始位置を変えると、その位置から再生し直す。
- アルペジオは初期状態で OFF（シンプルモード・カスタムモードとも）。
- Git のコミット・push はユーザーが自分で行う。Claude はコミット・push しない。
- ある程度まとまった作業（機能の追加・画面の作成・不具合修正など）が終わったら、作業報告の最後にコミットメッセージ案を日本語で提示する。1行目に変更の要約（`feat:` / `fix:` / `refactor:` / `docs:` などの接頭辞付き）、空行のあとに主な変更点を箇条書きにする。案を示すだけで、コミットは実行しない。
- コメント・ログは日本語。
- Claude の出力はすべて日本語で書く。ユーザーへの返答・作業報告に加え、ツール実行時の説明（権限確認で表示される description）、ユーザーへの質問（選択肢を含む）、計画の提示も日本語にする。

## 既知の問題（修正時に注意）

- タップテンポは `AppState.bpm` を更新するが、`main.ts` 側では Transport の BPM を直接書き換えている。
- `npm run dev` は Electron も起動し、Electron を閉じると Vite も終了する。VS Code の拡張機能など `ELECTRON_RUN_AS_NODE=1` が設定された環境から起動すると Electron が起動に失敗する。
- カスタムモード画面のピアノロールのタブは未実装（準備中表示）。
- MIDI書き出しはアレンジに未対応（コード進行1周分のコードとメロディだけ）。ベースもジャンル別パターンに未対応（コードごとのルート音の全音符）。
- カスタムモードの「雰囲気」はコード進行の「カテゴリ」として選ぶ。スケールは `chordPattern.base_scale` から決まり（別に持たない）、スケールを選ぶとそのスケールのコード進行に切り替わる。
- コードのリズム（`chordRhythm`）・コードの音色（`chordInstrument`）・メロディの音色（`melodyInstrument`）は ChordPlayer / MelodyPlayer が AppState から読む。音色の定義は各 Player の `INSTRUMENTS`。メロディの音色は初期値 `auto`（ジャンルの標準。`melody_params.json` の `instrument`）で、MelodyPlayer の `INSTRUMENTS` は Synth とエフェクト（ビブラート・ディレイなど）の組で定義する。ジャンルを追加するときは `instrument` も指定する。音色は Synth を作り直したとき（再生開始時）に反映される。MIDI書き出しはコードのリズムに未対応。
- パートの ON/OFF は `setLayerEnabled` で切り替える（OFF で破棄、再生中に ON にするとすぐ読み込み、アレンジ上ブロックのある小節から鳴る）。アレンジャーで OFF のパートにブロックを置くと ON になる。
- シンプルモードの曲の長さは「コード進行の長さ × 全パートがそろうまでの周回数（4）」。
- シンプルモードの「生成された楽曲」の波形は実際の音声ではなく、周回ごとのパート数とドラムの強さから描いた表示用のもの。
- 各パートの Synth はモジュールに1つずつ。WAV書き出し（Tone.Offline）は再生を止めて Synth を作り直し、終わったら破棄する。再生中に書き出すと再生は止まる。
- `chord_progressions.json` の `chord_005`（`Im_bassG` などベース指定のディグリー）、`chord_010`（major に `bVII` / `bVI`）、`chord_019`（minor に `IIdim`）は `SCALE_INTERVALS` に定義がなく `resolveChord` が例外になる。これらが選ばれるとメロディ生成・再生ができない。
- `Playback.play()` は開始時点の AppState で各パートを読み込むので、再生中に曲の内容（コード進行・ドラム・メロディ・キーなど）を変えたら先頭から再生し直す（アレンジの編集だけは再生し直さなくてよい）。
