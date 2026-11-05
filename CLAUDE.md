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
  CustomScreen.ts         カスタムモード画面の設定タブ（基本設定／スケール・キー＋コード進行／ドラム・パッド/アルペジオの3列＋ミキサー）とアレンジャータブ下部（ミキサー・差し替え・書き出し）
  ArrangerTab.ts          アレンジャーのタイムライン（パートごとのブロックの配置・移動・長さ変更・削除、再生位置）
  PianoRollTab.ts         ピアノロール（メロディの入力・編集。シンプルモード／カスタムモードの両画面で共通）
  MusicListScreen.ts      ミュージックリスト画面（検索・並び替え・お気に入り・ジャンルの絞り込み、曲ごとの再生・⋮メニュー）と両モードの「♪ 保存」ボタン
  QuizScreen.ts           音楽クイズ画面（カテゴリ・出題モードの切り替え、出題・採点、鍵盤／選択肢での回答、出題設定）
  Controls.ts             シンセサイザー風のノブ（attachKnob）・縦フェーダー（attachFader）・セレクトの ◀▶（attachStepper）。値は隠した range／select に持たせ input／change イベントで通知
  MixerPanel.ts           ミキサー（設定タブとアレンジャータブ）。パートごとのチャンネルストリップ（電源＝ON/OFF・フェーダー・レベルメーター）とマスターのメーター
  format.ts               表示用ヘルパー（スケール名、キーに合わせたコード名、時間）
  Theme.ts                ライト／ダークの切り替え（ヘッダー右端のボタン、<html data-theme>、localStorage の toniq.theme）と、カスタムモードのスキン（デフォルト／フラット／スタジオ／ポップ。情報バーのボタン、<html data-skin>、toniq.skin）
  styles.css              デザイントークン（ライト＋ダーク）と共通スタイル
src/quiz/               音楽クイズ
  QuizModes.ts            出題モードの定義（カテゴリ QUIZ_CATEGORIES、各モードの出題設定と問題の作り方）
  QuizAudio.ts            クイズの音（Web Audio API で直接鳴らす。音の高さは MIDI ノート番号）
src/data/               楽曲データとデータ型
  types.ts                ChordProgression / DrumPattern 型
  degree_resolver.ts      ディグリー → 実音の変換（resolveChord）、メロディ用のスケール音の役割（SCALE_TONES）
  chord_progressions.json コード進行DB（ディグリー表記）
  drum_patterns.json      ドラムパターンDB（16ステップ）
  easy_mode_table.json    シンプルモード用：ジャンル×雰囲気 → BPM・候補ID
  tempo_presets.json      ジャンル別テンポプリセット（ゆっくり/普通/速い）
  melody_params.json      ジャンル別メロディ生成パラメータ（リズムテンプレート・フレーズ形式・アクセント音の頻度・標準の音色 instrument など）
  bass_params.json        ジャンル別ベース設定（16ステップのパターン・音色）
  mix_presets.json        ジャンル別マスターエフェクト設定（リバーブ送り量・EQ・コンプ・リミッター・持ち上げ gain）
src/engine/
  AppState.ts             アプリ状態の唯一の保持場所
  SongLibrary.ts          ミュージックリストの保存・読み込み（localStorage の toniq.songs）
  SimpleModeResolver.ts   シンプルモード：ジャンル×雰囲気からパターンを決定
  LayerManager.ts         パートのON/OFF・差し替え・再ロード
  LoopArranger.ts         アレンジ（ジャンル標準の LOOP_SCHEDULE、各パートが鳴る小節の判定 arrangementGate、周回表示）
  {Drum,Chord,Bass,Arp,Pad,Melody,Fx}Player/Engine.ts  各パートの Tone.Part 生成（Fx はループ末尾のライザーSE）
  SignaturePlayer.ts      シグネチャー（ジャンルごとに鳴り方が変わる追加パート。定義は SIGNATURES）
  MelodyGenerator.ts      メロディ生成（ペンタトニック中心＋アクセント音、リズムテンプレート、モチーフの反復）
  SynthFactory.ts         ドラム音源（ジャンル別キット DRUM_KITS ＋バス：高域カット→歪み→コンプ→持ち上げ）
  Playback.ts             再生・停止（AppState.bars 小節で自動停止）、再生位置、WAVレンダリング
  VolumeManager.ts        パート別 Volume ノード（0〜100 → dB）。オーディオコンテキストごとに保持
  MixerEngine.ts          マスター（入口→EQ→コンプ→持ち上げ→リミッター）とリバーブ送り。オーディオコンテキストごとに保持
  Transport.ts / TapTempo.ts  BPM・再生制御、タップテンポ
  Metronome.ts            BPM 試聴用のクリック音（Web Audio API で直接鳴らす）
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

- パート名は `"drum" | "chord" | "bass" | "arp" | "pad" | "signature" | "melody" | "fx"`（`LayerName`）で統一。UI 表示名はドラム／コード／ベース／アルペジオ／パッド／シグネチャー／メロディ／FX/SE。パート別音量の UI にはアルペジオ・シグネチャーも含める。
- 各パートモジュールは `init*Synth()` / `load*()` / `dispose*()` の形にそろえる。`load*` は既存の Part を破棄してから作り直す。
- ジャンル名は `EDM` / `8bit` / `ローファイ` / `ゲームBGM` / `テクノ` / `ハウス` / `アンビエント`、雰囲気は `明るい` / `暗い` / `落ち着いた` / `切ない` / `激しい`。JSON のキー（`easy_mode_table` / `tempo_presets` / `melody_params` / `bass_params` / `mix_presets`）と完全に一致させる。見つからないときのフォールバックは `ローファイ` / `落ち着いた`。
- ジャンルは今後も追加・削除がありうる。追加するときは上の5つの JSON と `LoopArranger.ts` の `LOOP_SCHEDULE` にそろえて追加する。ドラムの音作りは `SynthFactory.ts` の `DRUM_KITS`（なければ標準キットで鳴る）。シグネチャーの鳴り方は `SignaturePlayer.ts` の `SIGNATURES`（なければローファイの定義で鳴る）。
  - UI のジャンル一覧は `index.html` の3か所（シンプルモードのチップ `data-genre`、カスタムモードの `#c-genre`、曲一覧の `data-ml-genre`）と `CustomScreen.ts` の `APP_GENRES`（ドラムのカテゴリの並び順）にも足す。
  - `chord_progressions.json` / `drum_patterns.json` の `genre` タグにも新ジャンルを付ける。シンプルモードの差し替え候補は、`easy_mode_table.json` の ID に加えてジャンル・雰囲気のタグが一致するものから選ばれる。下の既知の問題にある、例外になるコード進行はタグに含めない。
  - 4/4・16ステップの前提で表せないジャンル（スウィング・3連符、32分のハイハットロール、3拍子など）は今の仕組みでは作れない。
- ドラムのトラック名は `kick` / `snare` / `hihat_closed` / `hihat_open` / `clap` / `rim`。クローズドハイハットはオープンハイハットを止める（`DrumEngine.ts` の `CHOKES`）。周回の頭で読み込み直すとき、古いキットは鳴り終わるまで少し待ってから破棄する。
- 音の流れ：各パートの Volume ノード（`VolumeManager.createVolumeNode`）→ `connectToMixer` でマスター入口とリバーブ送りにつなぐ。リバーブはマスターに直接かけず送りで混ぜる（送り量はパートごとに `MixerEngine.ts` の `REVERB_SENDS`、全体量は `mix_presets.json` の `reverb.wet`。ベースは送らない）。ミキサーはコンテキストごとに1つで作り直さない。WAV書き出しと再生開始前は `mixerReady()` でリバーブの準備を待つ。
- `mix_presets.json` の `gain` は全ジャンルでクリップしない（ピーク −1dB 以下）ように測って決めた値。音源やパートを大きく変えたら測り直す。
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
- アルペジオ・シグネチャーは初期状態で OFF（シンプルモード・カスタムモードとも）。
- シグネチャー（`SignaturePlayer.ts`）はジャンルの特徴を出す追加パート。EDM = オフビートのコードスタブ、テクノ = アシッド（16ステップ表記 R/O/F、大文字はアクセント）、8bit = 32分音符の高速アルペジオ、ローファイ = レコードノイズ（ヒス＋ランダムなプチプチ音）、ゲームBGM = FM のベル、ハウス = シンコペーションのピアノスタブ、アンビエント = うねる風のノイズ。ジャンルごとに `label` / `create`（Synth とエフェクト）/ `events`（コードごとの発音）を定義する。音色はほかのパートと同じく再生開始時に反映される。MIDI書き出しは未対応。
- パートを増やしたときは、保存済みの曲に新しいパートの項目がないので、`loadSong()`（`SongLibrary.ts`）で `parts` / `volumes` / `arrangement` を初期値で補っている。
- ピアノロール（`PianoRollTab.ts`）はコード進行1周分（メロディのループの長さ）を表示し、`AppState.melodyNotes` を直接編集する（鳴る音だけを持ち、休符は持たない）。編集すると `melodyMethod` は `"manual"` になり、「自動生成」で `"auto"` に戻る。メロディは単音なので、重なる音は手前で切るか消す。再生中の編集はメロディだけ読み込み直して（`reloadLayer("melody")`）すぐ反映する。
- メロディは起動時・「＋ 新規作成」では作らず空のまま。自動生成ボタン（ピアノロールの「自動生成」、カスタムモードのメロディの差し替え ↻、シンプルモードで「自動生成」を選んで「生成する」／「↻ 再生成」）を押したときに初めて作る。`melodyMethod === "auto"` でも `melodyNotes` が空なら未作成として扱い、コード進行・キーを変えても自動では作らない（作成済みなら作り直す）。
- ピアノロールの入力設定（音符長 `pianoRollLength`・スケールロック `pianoRollScaleLock`・オクターブ `pianoRollOctave`）は AppState に置く。スケールロックはコード進行の `scaleLock` とは別。スケールの7音は `SCALE_TONES`（core＋accent）から作る。選択中の音と鍵盤入力の位置は表示上の一時的な状態としてモジュール内に持つ。
- ピアノロールの操作：クリックで配置（そのままドラッグで長さ）、音をドラッグで移動、右端で長さ変更、右クリック／Delete で削除、目盛りクリックで鍵盤入力の位置、A〜K（W E T Y U が黒鍵）で鍵盤入力、Z / X でオクターブ切替。
- ミュージックリスト（`SongLibrary.ts`）は曲の内容（`SONG_FIELDS`：モード・ジャンル・キー・BPM・小節数・パターン・メロディ・音色・アレンジ・パートON/OFF・音量）を localStorage に保存する。画面・タブ・ピアノロールの入力設定は保存しない。曲の内容に関わる項目を AppState に足したら `SONG_FIELDS` にも足す。
- `AppState.songId` は今の曲がリストのどの曲か（`null` = 未保存）。リストから開いた・保存した曲は「上書き保存」になり、シンプルモードで生成し直すと `null` に戻って新しい曲として保存される。リストで再生・開くと、その曲を今の曲として読み込む（未保存の曲があれば確認する）。
- 両モードの情報バーの「＋ 新規作成」は、確認のうえ再生を止めて `newSong()`（`SongLibrary.ts`）で曲の内容（`SONG_FIELDS`）を `defaultState` に戻し、`songId` を `null` にする。モードはそのまま、シンプルモードは設定画面（`generated: false`）に戻る。パターンは起動時と同じく初期のジャンル・雰囲気で決め直す（メロディは空にする）。
- 配色（ライト／ダーク）は `AppState.theme` に置き、`Theme.ts` が `<html data-theme>` に反映して localStorage の `toniq.theme` に保存する（未保存なら OS の設定に合わせる。曲の内容ではないので `SONG_FIELDS` には入れない）。`index.html` の `<head>` でも同じキーを読んで描画前に `data-theme` を付ける。
- カスタムモードのスキン（`AppState.skin`。UI 表示名は デフォルト／フラット／スタジオ／ポップ）：
  - `"default"` = メニュー・シンプルモード・ミュージックリストと同じ見た目（初期値）、`"flat"` = フラットなプラグイン風、`"studio"` = 少し暗い制作スタジオ（DAW）風、`"pop"` = クリーム色の地に色分けしたグルーヴボックス風。
  - `Theme.ts` が `<html data-skin>` に反映し、localStorage の `toniq.skin` に保存する（`SONG_FIELDS` には入れない。`<head>` でも描画前に付ける）。旧名の `plugin` / `daw` は `flat` / `studio` として読む。
  - `styles.css` の `:root`（ライト）／`:root[data-theme="dark"]` の `--hw-*` などの値と、`.hw …` の無印のスタイルはフラットスキン。ほかのスキンは後ろでトークンと形を上書きする。
  - デフォルトスキンは `:root[data-skin="default"]` でトークンをアプリ共通のトークン（`--surface` / `--border` / `--custom` など）に向けるので、ライト／ダークにそのまま追従する。形（カード・下線のタブ・枠付きのセレクトなど）は `[data-skin="default"] …` で戻す。
  - スタジオスキンは `:root[data-skin="studio"]`（ダークは `:root[data-theme="dark"][data-skin="studio"]`）でトークンを上書きし、形の違い（見出しの帯・箱型のドロップダウン・クリップ風のブロック）だけ `[data-skin="studio"] .hw …` で足す。
  - ポップスキンは `:root[data-skin="pop"]` のトークンに加え、モジュールの色 `--mod`（設定タブの列・ミキサー・アレンジャーごと）とパートの色 `--part`（`--pop-*`。ミキサーとアレンジャーのブロック）で塗り分け、色の上の文字は白にする。
  - トークンを足すときはフラット（ライト／ダーク）・デフォルト・スタジオ・ポップの各スキンに値を入れる。
- `styles.css` では色を直書きせず、`:root` のトークン（`var(--…)`）を使う。トークンを足すときは `:root[data-theme="dark"]` にもダーク用の値を足す。例外はパートの識別色（`.arr-*` / `.dot-*` のパステル）とアクセント色の上の白文字・クイズの黒鍵で、どちらのテーマでも同じ色を使う。
- カスタムモードの設定タブ・アレンジャータブ（`.hw`）と情報バー（`.hw-bar`）とタブ（`.hw-tabs`）はスキンで見た目が変わる。フラットスキンの形はシンセサイザーのプラグイン風（区切り線で仕切ったフラットなグレーの面、白いノブと細い色の弧、下線付きのドロップダウン、グレーの値の箱、情報バー・タブ・小節の目盛り・ミキサーの見出しは黒い帯、選択中はオレンジの枠）。色は `--hw-*` / `--knob-*` / `--slider-*` / `--meter-*` / `--track-*` のトークンを使う。BPM はノブ、コード進行・ドラムパターンは ◀▶ で切り替え（`Controls.ts`）。AppState から range の値を書き換えたら `syncControls()` で見た目をそろえる。
- ミキサー（`MixerPanel.ts`）は両タブの全幅に置く。電源ボタンは `setLayerEnabled` でパートを ON/OFF する。レベルメーターは再生中だけ動き、パートは `VolumeManager.getPartLevels()`（各 Volume ノードの後ろの Tone.Meter）、マスターは `MixerEngine.getMasterLevel()`（リミッターの後ろ）を読む。メーターは再生用のコンテキストだけに作る（WAV書き出しの Tone.Offline では作らない）。チャンネル上端の色はアレンジャーのブロックと同じパートの識別色（`.mix-*`）。
- メニューへの導線は、メニュー以外のすべての画面の上部に出るパンくずの「メニューに戻る」ボタン。ヘッダーの「⋯」メニューとシンプル／カスタムの切り替えボタンは廃止した。
- カスタムモードには「生成する」ボタンを置かない（設定の変更はその場で反映され、メロディの作り直しはアレンジャータブの「レイヤー差し替え」で行う）。情報バーの主ボタンは「▷ 再生」。
- ミュージックリストの絞り込み・並び順（`musicListQuery` / `musicListGenre` / `musicListFavorites` / `musicListSort`）は AppState に置く。⋮ メニューを開いている曲・名前を変更中の曲は表示上の一時的な状態としてモジュール内に持つ。お気に入りは曲データ（`SavedSong.favorite`）に保存する。
- 音楽クイズは初心者向け。カテゴリは「音の高さ」「コード・スケール」「リズム・音響」「用語」の4つで、各カテゴリの中はやさしい順に並べる。上級者向けの内容（テンション・転回形・ミックスの聴き分けなど）は足さない。
- 音楽クイズ：選んでいる出題モード（`quizMode`）と音名の表記（`quizNoteNames`：CDE／ドレミ）は AppState に置く。出題中の問題・成績（正解数・連続）は表示上の一時的な状態として `QuizScreen.ts` に、出題設定は各モード（`QuizModes.ts`）に持つ（どちらも保存しない）。モードを足すときは `QuizMode`（`settings` と `question()`、必要なら出題設定に出すおすすめ `hint`）を作って `QUIZ_CATEGORIES` に加える。問題は回答方法（`choice` 選択肢／`notes` 鍵盤で複数選択／`key` 鍵盤を1つ押す）、回答後の一言の解説（`explain`）、再生ボタン（`sounds`、`afterAnswer` で回答後だけ表示）で表す。
- クイズの音名の表記：単音・構成音は `displayNote` で今の表記にする。コード名・キー名は CDE 表記のまま。`notes` / `key` の正解は CDE 表記（`NOTES`）で持ち、表示するときに変換する。表記を切り替えると新しい問題を出す。
- BPM の試聴（`Metronome.ts`。シンプルモードの「♪ クリックで試聴」、カスタムモードの BPM ノブ横の「♪ 試聴」）は、曲の再生（Tone.js）とは別のオーディオコンテキストで 4/4 のクリック音（1拍目は高い音）を鳴らす。拍ごとに `AppState.bpm` を読むので、鳴らしたまま BPM を変えるとすぐ反映される。鳴っているかどうかは表示上の一時的な状態としてモジュール内に持つ（保存しない）。曲の再生・試聴の開始、画面の切り替え、シンプルモードの生成で止める。
- クイズの音は曲の再生（Tone.js）とは別のオーディオコンテキストで鳴らす。新しい音を鳴らす・次の問題へ進む・画面を離れると前の音を止める。クイズ画面に入ると曲の再生は止める。
- Git のコミット・push はユーザーが自分で行う。Claude はコミット・push しない。
- ある程度まとまった作業（機能の追加・画面の作成・不具合修正など）が終わったら、作業報告の最後にコミットメッセージ案を日本語で提示する。1行目に変更の要約（`feat:` / `fix:` / `refactor:` / `docs:` などの接頭辞付き）、空行のあとに主な変更点を箇条書きにする。案を示すだけで、コミットは実行しない。
- コメント・ログは日本語。
- Claude の出力はすべて日本語で書く。ユーザーへの返答・作業報告に加え、ツール実行時の説明（権限確認で表示される description）、ユーザーへの質問（選択肢を含む）、計画の提示も日本語にする。

## 既知の問題（修正時に注意）

- タップテンポは `AppState.bpm` を更新するが、`main.ts` 側では Transport の BPM を直接書き換えている。
- `npm run dev` は Electron も起動し、Electron を閉じると Vite も終了する。VS Code の拡張機能など `ELECTRON_RUN_AS_NODE=1` が設定された環境から起動すると Electron が起動に失敗する。
- MIDI書き出しはアレンジに未対応（コード進行1周分のコードとメロディだけ）。ベースもジャンル別パターンに未対応（コードごとのルート音の全音符）。
- カスタムモードの「雰囲気」はコード進行の「カテゴリ」として選ぶ。スケールは `chordPattern.base_scale` から決まり（別に持たない）、スケールを選ぶとそのスケールのコード進行に切り替わる。
- コードのリズム（`chordRhythm`）・コードの音色（`chordInstrument`）・メロディの音色（`melodyInstrument`）は ChordPlayer / MelodyPlayer が AppState から読む。音色の定義は各 Player の `INSTRUMENTS`。メロディの音色は初期値 `auto`（ジャンルの標準。`melody_params.json` の `instrument`）で、MelodyPlayer の `INSTRUMENTS` は Synth とエフェクト（ビブラート・ディレイなど）の組で定義する。ジャンルを追加するときは `instrument` も指定する。音色は Synth を作り直したとき（再生開始時）に反映される。MIDI書き出しはコードのリズムに未対応。
- パートの ON/OFF は `setLayerEnabled` で切り替える（OFF で破棄、再生中に ON にするとすぐ読み込み、アレンジ上ブロックのある小節から鳴る）。アレンジャーで OFF のパートにブロックを置くと ON になる。
- シンプルモードの曲の長さは「コード進行の長さ × 全パートがそろうまでの周回数（4）」。
- シンプルモードの「生成された楽曲」の波形は実際の音声ではなく、周回ごとのパート数とドラムの強さから描いた表示用のもの。
- 各パートの Synth はモジュールに1つずつ。WAV書き出し（Tone.Offline）は再生を止めて Synth を作り直し、終わったら破棄する。再生中に書き出すと再生は止まる。
- `Playback.play()` は開始時点の AppState で各パートを読み込むので、再生中に曲の内容（コード進行・ドラム・メロディ・キーなど）を変えたら先頭から再生し直す（アレンジの編集だけは再生し直さなくてよい）。
