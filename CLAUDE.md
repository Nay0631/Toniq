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
index.html              UI。ヘッダー＋画面ごとの <section data-screen="…">（menu / simple / custom / musiclist / quiz / settings）
src/main.ts             エントリ。初期状態の解決と各画面の初期化
src/ui/
  Router.ts               画面・タブ切り替え（showScreen / showTab / render / onRender）。AppState.screen / tab
  SimpleScreen.ts         シンプルモード画面（設定→生成→結果、差し替え、書き出し、ジャンルのサンプル試聴）
  CustomScreen.ts         カスタムモード画面の設定タブ（基本設定／スケール・キー＋コード進行／ドラム・パッド/アルペジオの3列＋書き出し）とアレンジャータブ下部（差し替え・書き出し）
  ArrangerTab.ts          アレンジャーのタイムライン（セクションの行、パートごとのブロックの配置・移動・長さ変更・削除、再生位置）と、テスト中の機能の ON/OFF・自動チェックの欄
  MixerPanel.ts           ミキサー（アレンジャータブのみ。パートごとの ON/OFF・音量のフェーダー・レベルメーター、マスターのメーター）
  PianoRollTab.ts         ピアノロール（メロディの入力・編集。シンプルモード／カスタムモードの両画面で共通）
  MusicListScreen.ts      ミュージックリスト画面（検索・並び替え・お気に入り・ジャンルの絞り込み、曲ごとの再生・⋮メニュー）と両モードの「♪ 保存」ボタン
  QuizScreen.ts           音楽クイズ画面（カテゴリ・出題モードの切り替え、出題・採点、鍵盤／選択肢での回答、出題設定）
  Controls.ts             シンセサイザー風のノブ（attachKnob）・縦フェーダー（attachFader。ミキサー）・セレクトの ◀▶（attachStepper）。値は隠した range／select に持たせ input／change イベントで通知
  ExportProgress.ts       音声の書き出し（WAV / MP3）の進み具合のダイアログ（目安の説明・段階・進み具合・経過時間。両モード共通の exportAudioWithProgress）
  format.ts               表示用ヘルパー（スケール名、キーに合わせたコード名、時間）
  HistoryControls.ts      元に戻す／やり直すのボタン（両モードの情報バー）とショートカット（Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y）、戻したあとの再生への反映
  Glossary.ts             用語のツールチップ（data-term を付けた要素に初心者向けの短い説明を出す。説明は TERMS）
  SettingsScreen.ts       設定画面（配色・カスタムモードのスキン・音名の表記・ループ再生・ドラムの音源・Toniq シンセ・用語のツールチップの ON/OFF）
  Preferences.ts          端末ごとの設定（音名の表記 toniq.noteNames・ループ再生 toniq.loop・ドラムの音源 toniq.drumSource・テスト中の機能 toniq.test.*（Toniq シンセ toniq.test.toniqSynth を含む））の保存・読み込み
  ToniqSynthPanel.ts      Toniq シンセの音作りのパネル（カスタムモードの設定タブの下 #c-toniq。モジュールごとのノブ・セレクト、プリセット、試聴、「メロディに使う」）
  Theme.ts                ライト／ダーク／OS に合わせるの切り替え（ヘッダー右端のボタンと設定画面、<html data-theme>、localStorage の toniq.theme）と、カスタムモードのスキン（デフォルト／フラット／スタジオ／ポップ。設定画面で選ぶ。<html data-skin>、toniq.skin）
  styles.css              デザイントークン（ライト＋ダーク）と共通スタイル
src/quiz/               音楽クイズ
  QuizModes.ts            出題モードの定義（カテゴリ QUIZ_CATEGORIES、各モードの出題設定と問題の作り方）
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
  History.ts              元に戻す／やり直すの履歴（setState の直前に曲の内容のスナップショットを積む）
  SimpleModeResolver.ts   シンプルモード：ジャンル×雰囲気からパターンを決定
  LayerManager.ts         パートのON/OFF・差し替え・再ロード
  LoopArranger.ts         アレンジ（ジャンル標準の LOOP_SCHEDULE＝周回ごとのセクション・パート・gap / build、各パートが鳴る小節の判定 arrangementGate、周回表示）
  SongForm.ts             曲の構成（セクション Aメロ／サビ、曲全体のコード進行 songProgression・メロディ songMelody、エンディング、ドラムのフィルの小節、Aメロ・サビのメロディ生成）
  QualityCheck.ts         自動チェック（強拍のコード構成音・フレーズの終わり・跳躍・サビの高さ・抜き差し・DB の整合を数字で出す。アレンジャーのテスト中の機能の欄）
  Groove.ts               グルーヴ（スウィング applySwing・サイドチェイン sidechainHit。量はジャンルの標準か AppState.swing / sidechain）
  {Drum,Chord,Bass,Arp,Pad,Melody,Fx}Player/Engine.ts  各パートの Tone.Part 生成（Fx はループの継ぎ目の効果音。種類は FX_DEFS）
  SignaturePlayer.ts      シグネチャー（ジャンルごとに鳴り方が変わる追加パート。定義は SIGNATURES）
  ToniqSynth.ts           Toniq シンセ（テスト中。Toniq 専用の単音シンセ ToniqVoice、音作りの値 ToniqSynthParams・プリセット TONIQ_PRESETS・単位の変換）
  MelodyGenerator.ts      メロディ生成（ペンタトニック中心＋アクセント音、リズムテンプレート、モチーフの反復）
  SynthFactory.ts         ドラム音源（ジャンル別キット DRUM_KITS ＋バス：高域カット→歪み→コンプ→持ち上げ）。ワンショット音源で鳴らす音色もここ
  DrumSamples.ts          ドラムのワンショット音源の読み込み（public/samples/drums/<フォルダ>/<トラック名>.wav）
  Playback.ts             再生・停止（AppState.bars 小節で自動停止。ループ再生なら先頭へ戻る）、再生位置、WAV / MP3 レンダリング
  VolumeManager.ts        パート別 Volume ノード（0〜100 → dB）。オーディオコンテキストごとに保持
  MixerEngine.ts          マスター（入口→EQ→コンプ→持ち上げ→リミッター）とリバーブ送り。オーディオコンテキストごとに保持
  TapTempo.ts             タップテンポ（AppState.bpm を更新する。再生中の反映は呼び出し側が Playback.applyBpm()）
  Transport.ts            旧 BPM 設定（未使用。Transport の BPM は Playback.ts が AppState.bpm から設定する）
  Metronome.ts            BPM 試聴用のクリック音（Web Audio API で直接鳴らす）
  ScalePreview.ts         キー・スケールの試聴（スケールを順に鳴らして主音の和音で終わる。Web Audio API で直接鳴らす）
  MidiExporter.ts         MIDI書き出し（今の曲を曲全体の長さで。アレンジ・パートの ON/OFF・スウィングを反映）
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

- パート名は `"drum" | "chord" | "bass" | "arp" | "pad" | "signature" | "melody" | "fx"`（`LayerName`）で統一。UI 表示名はドラム／コード／ベース／アルペジオ／パッド／シグネチャー／メロディ／FX/SE。
- 各パートモジュールは `init*Synth()` / `load*()` / `dispose*()` の形にそろえる。`load*` は既存の Part を破棄してから作り直す。
- ジャンル名は `EDM` / `8bit` / `ローファイ` / `ゲームBGM` / `テクノ` / `ハウス` / `トランス` / `アンビエント`、雰囲気は `明るい` / `暗い` / `落ち着いた` / `切ない` / `激しい`。JSON のキー（`easy_mode_table` / `tempo_presets` / `melody_params` / `bass_params` / `arp_params` / `mix_presets`）と完全に一致させる。見つからないときのフォールバックは `ローファイ` / `落ち着いた`。
- ジャンルは今後も追加・削除がありうる。追加するときは上の6つの JSON と `LoopArranger.ts` の `LOOP_SCHEDULE`（周回ごとの `section` も）にそろえて追加する。ドラムのフィルは `DrumEngine.ts` の `FILLS`（なければローファイの定義）、ゴーストノートは `GHOST_RATE`（なければ入れない）、メロディの掛留の確率は `MelodyGenerator.ts` の `DEFAULT_SUSPENSION`（`melody_params.json` の `suspension` があればそちら）。ドラムの音作りは `SynthFactory.ts` の `DRUM_KITS`（なければ標準キットで鳴る）。シグネチャーの鳴り方は `SignaturePlayer.ts` の `SIGNATURES`（なければローファイの定義で鳴る）。FX の標準の種類は `FxPlayer.ts` の `GENRE_FX`（なければライザー）。
  - UI のジャンル一覧は `index.html` の3か所（シンプルモードのチップ `data-genre`、カスタムモードの `#c-genre`、曲一覧の `data-ml-genre`）と `CustomScreen.ts` の `APP_GENRES`（ドラムのカテゴリの並び順）、`SimpleScreen.ts` の `GENRE_DESCRIPTIONS`（ジャンルの一言の説明）と `MOOD_GENRES`（雰囲気ごとに選べるジャンル。どれか1つ以上の雰囲気に入れる）にも足す。
  - `chord_progressions.json` / `drum_patterns.json` の `genre` タグにも新ジャンルを付ける。シンプルモードの最初の候補は `easy_mode_table.json` の ID から、差し替え候補はそれに加えてジャンル・雰囲気のタグが一致するものから選ばれる。コード進行のディグリー・`type` が `degree_resolver.ts` に未定義だと鳴らすときに例外になるので、足したら確かめる。
  - 4/4・16ステップの前提で表せないジャンル（スウィング・3連符、32分のハイハットロール、3拍子など）は今の仕組みでは作れない。
- ドラムのトラック名は `kick` / `snare` / `hihat_closed` / `hihat_open` / `clap` / `rim`。クローズドハイハットはオープンハイハットを止める（`DrumEngine.ts` の `CHOKES`）。周回の頭で読み込み直すとき、古いキットは鳴り終わるまで少し待ってから破棄する。
- アレンジャーのドラムのブロックは1つずつパターンを持てる（`ArrangeBlock.drum` = パターン ID。ブロックのラベルのセレクトで選ぶ。今のジャンルのパターンを先に並べ、ほかのジャンルも選べる。なし = 曲の設定 `drumPattern`）。鳴らすときはステップごとに `arrangementBlockAt("drum")` でブロックを調べてパターンを決めるので、再生中の変更もすぐ反映される。キットはパターンを切り替えても音が欠けないよう、DB に出てくる全トラック分を作る。16ステップ・`16n` 以外のパターンを足すときは `DrumEngine.ts` の Sequence と `MidiExporter.ts` のドラムを見直す。
- Toniq シンセ（テスト中。`ToniqSynth.ts` / `ToniqSynthPanel.ts`）：Toniq 専用の単音シンセサイザーで、メロディの音色 `melodyInstrument: "toniq"` として鳴らす。
  - 使えるかどうかは `AppState.toniqSynthEnabled`（設定画面の「Toniq シンセ（テスト中）」、`Preferences.ts` が localStorage の `toniq.test.toniqSynth` に保存。初期値 OFF。曲の内容ではないので `SONG_FIELDS` には入れない）。OFF のあいだはインストの選択肢・音作りのパネルを隠し、`"toniq"` の曲もジャンルの標準の音色で鳴らす（`resolveMelodySound()`）。切り替えたときメロディの Synth があれば `refreshMelodySynth()` で作り直す。
  - 音作りの値は `AppState.toniqSynth`（`ToniqSynthParams`。`SONG_FIELDS` に含む。古い曲は `normalizeToniqSynth()` で初期値を補う）。ノブの値はすべて 0〜100 で持ち、Hz・秒などへの変換は `ToniqSynth.ts` の関数（`toSeconds` / `cutoffHz` など）で行う。波形・フィルターの種類・LFO の行き先・OSC2 のオクターブはセレクト。
  - 音の流れ：OSC1・OSC2（FatOscillator。ユニゾンの枚数・広がり）・サブ（1オクターブ下のサイン）・ノイズ → フィルター（`FrequencyEnvelope` ＋ LFO）→ アンプ（ADSR）→ 音量の LFO → ドライブ → コーラス → ディレイ → メロディの Volume。自前のリバーブは持たない（マスターのリバーブ送り）。オシレーターは鳴らしっぱなしにしてエンベロープで出し入れし、休符を挟まずに続く音だけグライドで滑らせる。
  - FatOscillator は重ねた音の位相をずらして鳴らすので、高さが同じだと打ち消し合って無音になる。ユニゾンで重ねるときは最低 8 セントずらす（`set()`）。重ねた枚数の音量の補正は FatOscillator 自身が行う。
  - パネルのノブを動かすと `applyToniqSynthLive()` で再生中のメロディ・試聴の音にすぐ当てる（Synth は作り直さない）。「▷ 試聴」は曲の再生を止め、今のキー・スケールの短いフレーズを別の音源で鳴らす。プリセットを足すときは `TONIQ_PRESETS` に足し、音量はシンセリード（`lead`）と RMS が同じくらいになるよう `level` で合わせる。
  - MIDI書き出しは他の音色と同じくメロディの音として書き出す（音色の再現はしない）。
- ドラムの音源（テスト中）：`AppState.drumSource` が `"synth"`（Tone.js のシンセ、初期値）か `"sample"`（ワンショット音源）。設定画面の「ドラムの音源」で切り替え、`Preferences.ts` が localStorage の `toniq.drumSource` に保存する。曲の内容ではないので `SONG_FIELDS` には入れない。再生中に切り替えたら（サンプル音源なら読み込みを待って）ドラムだけ読み込み直す。
  - 音源は `public/samples/drums/<フォルダ>/<トラック名>.wav`。フォルダはジャンルごと（`DrumSamples.ts` の `DRUM_SAMPLE_DIRS`：edm / 8bit / lofi / gamebgm / techno / house / trance / ambient）で、ない音は `default` フォルダ、それもなければそのトラックだけシンセで鳴る。ジャンルを追加したら `DRUM_SAMPLE_DIRS` にも足す。
  - 再生・試聴・WAV書き出しの前に `prepareDrumSamples(genre)` で読み込みを待つ（`Playback.ts` の `audioReady`）。読み込んだ AudioBuffer は Tone.Offline でもそのまま使う。file:// でも読めるよう XMLHttpRequest で相対パスから読む。
  - 音源はジャンルのドラムバス（高域カット→歪み→コンプ→持ち上げ）を通る。音源の音量は `SynthFactory.ts` の `SAMPLE_TRIM_DB` で下げており、`mix_presets.json` の `gain` はシンセのドラムで測った値のまま。
- 音の流れ：各パートの Volume ノード（`VolumeManager.createVolumeNode`）→ サイドチェイン用の Gain → `connectToMixer` でマスター入口とリバーブ送りにつなぐ。リバーブはマスターに直接かけず送りで混ぜる（送り量はパートごとに `MixerEngine.ts` の `REVERB_SENDS`、全体量は `mix_presets.json` の `reverb.wet`。ベースは送らない）。FX / SE はさらに、ジャンルによらない長い響きのロングリバーブ（`LONG_REVERB` / `LONG_REVERB_SENDS`）にも送る。マスター（`MixerEngine.ts`）はコンテキストごとに1つで作り直さない。WAV書き出しと再生開始前は `mixerReady()` でリバーブの準備を待つ。
- コード・パッド・アルペジオのボイシングは `voiceProgression(progression, key, VOICING_RANGES.*)`（`degree_resolver.ts`）で決める。最低音を範囲内に収め、前のコードから一番近い転回形を選ぶ（ループの継ぎ目も考慮。進行の `inversion` は動きが同じくらいなら優先）。パッドは `spread`（開離配置）。MIDI書き出しも同じボイシングを使う。各 Player は自前のリバーブを持たず（ローパス・コーラス・ディレイなどだけ）、エフェクトのノードは `dispose*` で一緒に破棄する。強さ（ベロシティ）は拍の位置で付けて少し揺らし、和音は数msずつずらして鳴らす（ストラム）。
- `mix_presets.json` の `gain` は全ジャンルでクリップしない（ピーク −1dB 以下）ように測って決めた値。音源やパートを大きく変えたら測り直す。
- グルーヴ（`Groove.ts`）：量は `AppState.swing` / `sidechain`（0〜100、`SONG_FIELDS` に含む。`null` = ジャンルの標準で、`mix_presets.json` の `swing` / `sidechain`）。カスタムモードの基本設定の「グルーヴ」のノブで決め、「標準」で `null` に戻す。シンプルモード・ジャンルのサンプルはジャンルの標準で鳴る。ジャンルを足すときは `mix_presets.json` に `swing` / `sidechain` も入れる。
  - スウィング：`applySwing()` が Transport の `swing`（`swingSubdivision` は `16n`。100 で `SWING_MAX` = 0.67 ≒ 3連のシャッフル）を設定する。再生・試聴・サンプル・WAV書き出し（Offline の Transport）の開始時と、量を変えたとき（再生中もすぐ反映）に呼ぶ。16分音符の裏拍に当たる全パートのイベントがずれる。MIDI書き出しも同じずらし方（8分音符の中の位置に応じた sin の形）で発音位置に反映する。
  - サイドチェイン：ドラムのキックが鳴るたびに `sidechainHit(time, velocity)` が、`SIDECHAIN_PARTS`（ベース・パッド 1、コード 0.8、アルペジオ・シグネチャー 0.6。メロディ・ドラム・FX は沈めない）のサイドチェイン用 Gain を数msで下げ（100 で 0.2 倍 ≒ −14dB）、拍の6割で戻す。量はキックのたびに AppState から読むので再生中の変更もすぐ反映される。ドラムが OFF・キックがない小節では沈まない。音量を下げるだけなので `gain` の測り直しは要らない。
- メロディ生成の規則（`MelodyGenerator.ts`。`generateMelody(progression, key, genre, { section, prevNote })`）：
  - 輪郭：フレーズ形式1回分を1つの形（`CONTOURS`：山型・上昇・下降・波）で動き、各音はその位置で狙う高さに近いほど選ばれやすい。音域のうち Aメロは低め〜中、サビ（`section: "B"`）は中〜高（`SECTION_SHAPE`）。`prevNote` は直前に鳴る音で、最初の音をその近くに置く。
  - 終止：進行の最後の音は主音（コードに合わなければ5度・3度などのコード構成音）にし、短ければ少し伸ばす。ループの頭の音からも離れすぎない高さを選ぶ。前半の最後の小節の最後の音は主音を避けて5度・2度などで止める（問いかけと答え）。
  - 強拍：小節の最初の音はコード構成音（直前の音から大きく跳ばないもの）。3拍目の頭も `STRONG_BEAT_CHORD_TONE` の確率でコード構成音にする。
  - 掛留：コードが変わる小節の頭で、前の音が新しいコードの構成音でなければ、確率（`DEFAULT_SUSPENSION`）で同じ音を弾き直し、次の音で1〜2半音下の構成音へ解決する。
  - 音はペンタトニックの5音が基本。残りの2音（アクセント音）は、1拍目・3拍目の頭以外で、休符を挟まず次の音が続く位置にだけ経過音・刺繍音として置き、次の音で解決先へ順次進行させる。コード構成音になるアクセント音は普通の音として扱う。
  - リズムは `melody_params.json` の `rhythmPatterns`（16ステップ表記。`x` = 発音、`-` = 伸ばす、`.` = 休符）から小節ごとに選ぶ。各小節の最初の音はコード構成音。
  - `phraseForms`（例 `"AAAB"`。1文字 = 1小節）で同じ文字の小節は同じモチーフを使う。最初の音が新しいコードの構成音になるようスケール上でずらして繰り返す（オクターブ違いを含む候補から、直前の音に近く輪郭の高さに合うもの。音域に収まらない・跳躍が大きすぎるなら同じリズムで音を選び直す）。くり返しは確率（`DEFAULT_VARIATION`）で最後の1〜2音だけ選び直す（A → A'）。形式より長い進行は形式を繰り返す。
  - 音価は `4n` などのほか付点（`8n.` など）や `0:拍:16分` 表記も出る。MIDI書き出しは `MidiExporter.ts` の `durationToBeats` で変換する。
- ベース（`BassPlayer.ts`）はジャンルごとに `bass_params.json` のパターンと音色で鳴らす。パターンは16ステップ表記（`R` = ルート、`F` = 5度、`O` = 1オクターブ上、`-` = 伸ばす、`.` = 休符）。`patterns` を小節ごとに順に使い、コード進行1周の最後の小節は `fill`（曲全体の並びでは `section_bars` ごと）。5度はコードの構成音から取る。音色はジャンルで決まり、Synth を作り直したとき（再生開始時）に反映される。
- アルペジオ（`ArpPlayer.ts`）はジャンルごとに `arp_params.json` で鳴らす。`instrument`（`pluck` / `square` / `keys` / `bell` / `blip`。定義は `ArpPlayer.ts` の `INSTRUMENTS`）、`step`（`16n` / `8n` / `4n`）、`pattern`（`up` / `down` / `updown` / `pedal` = 一番下の音と交互）、`octaves`（2 なら1オクターブ上を重ねる。ボイシングは `VOICING_RANGES.arpWide`）、`gate`（刻みに対する音の長さ）、`cutoff`、`delay`。パターンはコードが変わるたびに頭から。音の並びは `arpNotes()` で作り、MIDI書き出しも同じものを使う。音色・ローパス・ディレイは再生開始時に反映される。
- 雰囲気「緊張感」は廃止。パターンDBの旧「緊張感」タグは「激しい」に置き換えた。
- 拍子の変更（3/4 など）は保留中。現状は 4/4・16ステップ前提。
- 「小節数」は曲全体の最大の長さを表す（コード進行1周の長さではない）。コード進行・ドラムはその長さに達するまでループし、アレンジャーのタイムラインと書き出しの長さもこの値に合わせる。
- アレンジ（`AppState.arrangement`）はパートごとのブロック（`start` / `length`、小節・0始まり）の並び。`null` はジャンルの標準アレンジで、`LOOP_SCHEDULE` をコード進行の長さで並べて自動で組む（ジャンル・コード進行・小節数・セクションの変更に追従）。アレンジャーで編集すると初めて AppState に書き込まれ、「標準に戻す」で `null` に戻る（セクションも `null` に戻す）。シンプルモードの生成時も `null` に戻す。
  - `LOOP_SCHEDULE` は周回ごとの `{ section, parts, gap?, build? }`。パートは足すだけでなく、ブレイクで抜く周回もある（標準でも抜き差しがあるようにする。初期状態で OFF のパッド・アルペジオ・シグネチャーだけを抜いても聞こえないので、ドラム・ベースなどで作る）。`gap` は次がサビに変わる周回の最後の1小節だけ抜くパート（サビ前の空白）、`build` は周回の最後の1小節だけ足すパート（ブレイクの終わりにドラムを戻してフィルでつなぐ）。どちらもコード進行が2小節以上で、曲の最後の周回でないときだけ。定義（4周）より長い曲は2周目以降の定義をくり返す。
- 読み取りは `getArrangement()`（`LoopArranger.ts`）を通す。`AppState.arrangement` を直接見ない。
- セクション（`SongForm.ts`）：周回（コード進行1周）ごとに Aメロ（A）／サビ（B）を持つ（`AppState.sections`。`null` = `LOOP_SCHEDULE` の `section`。`SONG_FIELDS` に含む）。サビは `AppState.chorusPattern`（サビの進行）と `chorusMelodyNotes`（サビのメロディ）で鳴らす。
  - サビの進行は Aメロの進行と同じ長さ・`base_scale` のものだけ使う（`chorusFits`。合わない・`null` なら Aメロの進行で鳴らす）。候補は `chorusCandidates()`、自動の選び方は `pickChorus()`（`SimpleModeResolver.ts`。ジャンル・雰囲気が合うものから）。シンプルモードの生成・コード進行の差し替え・起動時・新規作成で選び、カスタムモードは「コード進行」欄の「サビ」で選ぶ（「なし」= `null`）。Aメロの進行を変えて合わなくなったら選び直す（「なし」ならそのまま）。DB に進行を足すときは、同じ長さ・スケールの相方があるようにする（自動チェックの「コード進行DB」で確かめられる）。
  - サビのメロディが空ならサビでも `melodyNotes` を鳴らす。自動生成は `generateSongMelodies()`（Aメロとサビを作る。サビは高めの音域で、Aメロの最後の音から大きく跳ばずに始める）、サビの進行を変えたときは `generateChorusMelody()` でサビだけ作り直す。
  - アレンジャーのいちばん上の「セクション」の行で、周回ごとにクリックして切り替える。ピアノロールはツールバーの「Aメロ／サビ」で編集するメロディを切り替える（サビはサビの進行のコードを表示し、`chorusMelodyNotes` を書き換える）。
  - 各パートには曲全体の並びを渡す：コード・ベース・アルペジオ・パッド・シグネチャーは `songProgression()`（周回ごとにセクションの進行を並べた、曲全体の長さの ChordProgression。`section_bars` = 元の1周の長さ、各コードに `section`・エンディングの主和音に `ending` が付く）、メロディは `songMelody()`。Part の `loopEnd` もこの長さ。読み込みは `LayerManager.reloadLayer`・WAV書き出し・MIDI書き出しで共通。FX はループの継ぎ目の効果音なので、コード進行1周（`chordPattern`）で読み込む。試聴・サンプル中（`isArrangementBypassed()`）はセクション・エンディング・フィルを使わず、コード進行1周をそのまま使う。
  - セクションの変更は読み込み直しが要るので、再生中なら再生し直す（`initArranger` の `onSongChange`）。
- テスト中の機能（アレンジャータブの「テスト中の機能」欄でまとめて ON/OFF。`AppState.endingEnabled` / `drumFill` / `drumHumanize`、初期値は ON。`Preferences.ts` の `setTestFeature` が localStorage の `toniq.test.*` に端末ごとに保存する。曲の内容ではないので `SONG_FIELDS` には入れない）：
  - エンディング：曲の最後の小節（`endingBar()`）を主和音（メジャーは I、それ以外は Im）の全音符にする。コード・パッドは1回だけ伸ばし、ベースはルートの全音符、メロディは直前の音にいちばん近い主音の全音符、ドラムは頭の1打（キック・スネア・オープンハイハット）だけ。アルペジオ・シグネチャー・FX は鳴らさない。ループ再生でなければ余韻のため1小節あとに止める。切り替えは再生中なら再生し直す。
  - ドラムのフィル：`isFillBar(bar)`（ドラムが鳴っている周回の最後の小節で、次がセクションの変わり目・編成が変わる所・8小節ごと、またはエンディングの直前）の小節で、`FILLS` の `from` ステップから元のパターン（`keep` 以外）を止めてフィルを鳴らす（小節の終わりへ強くなる）。
  - ドラムの揺らぎ：強さとタイミングを少し揺らす（ハイハットは裏の16分を弱く・最大 6ms、スネアなどは 4ms 遅らせる。キックはずらさない）。`GHOST_RATE` のジャンルではスネアのゴーストノートを確率で入れる。
  - フィル・エンディングの音は `drumStepHits()`（`DrumEngine.ts`）で決め、再生と MIDI書き出しで共通。揺らぎは再生だけ。フィル・揺らぎはドラムが1音ごとに AppState を読むので再生中もすぐ反映される。
- 自動チェック（`QualityCheck.ts` の `analyzeSong()`）はアレンジャーのテスト中の機能の欄に出す。項目：強拍（1・3拍目）のコード構成音の割合（75% 以上）、周回の最後の音が主音・構成音か、最大の跳躍（休符をはさまない音どうしで 9 半音以内）、サビの平均の高さが Aメロより高いか、セクション、アレンジの抜き差し（ON のパートが前の小節より減る所）、エンディング・フィルの回数、コード進行DB（全進行が実音にできるか・サビの相方があるか）。
- ベースとキック：ベースの強さは `bassVelocity(bar, step)`（`BassPlayer.ts`）で、キック（`kickAt()`。アレンジ・ブロックのパターン・フィルも反映）と同時の音を強く、それ以外は拍の頭 > 裏の順に弱くする。MIDI書き出しも同じ。
- 再生時は ON のパートを先頭ですべて読み込み、各パートの Part / Sequence のコールバック先頭で `arrangementGate(part)` を呼んで、ブロックの外の小節では鳴らさない。新しいパートを足すときも同じ形にする。判定は再生中も AppState を見るので、アレンジの編集は再生し直さなくてもすぐ反映される。試聴（`Playback.preview`）は判定を外す。
- アレンジャーでは小節番号の目盛りをクリックして再生開始位置（`AppState.startBar`）を決める。アレンジャータブの再生はそこから始まり（`Playback.play({ fromBar })`）、他のタブでは先頭から。再生中に開始位置を変えると、その位置から再生し直す。
- アレンジャーのブロックは右クリック・×ボタン・Delete キー（フォーカス中）で削除する（右クリックはピアノロールと同じ操作。ブラウザの右クリックメニューは出さない）。
- ドラム・FX のブロックのセレクト（`.arr-block-select`）の当たり判定は文字の幅（`field-sizing: content`）と1行分の高さだけにする。ブロックの残りの部分はドラッグ（移動）に使う。
- パッド・アルペジオ・シグネチャーは初期状態で OFF（シンプルモード・カスタムモードとも。`defaultState.parts`）。保存済みの曲は保存した ON/OFF のまま開く。
- シグネチャー（`SignaturePlayer.ts`）はジャンルの特徴を出す追加パート。EDM = オフビートのコードスタブ、テクノ = アシッド（16ステップ表記 R/O/F、大文字はアクセント）、8bit = 32分音符の高速アルペジオ、ローファイ = レコードノイズ（ヒス＋ランダムなプチプチ音）、ゲームBGM = FM のベル、ハウス = シンコペーションのピアノスタブ、トランス = スーパーソウのコードを16分で刻むトランスゲート、アンビエント = うねる風のノイズ。ジャンルごとに `label` / `create`（Synth とエフェクト）/ `events`（コードごとの発音）を定義する。音色はほかのパートと同じく再生開始時に反映される。MIDI書き出しは未対応。
- FX / SE（`FxPlayer.ts`）はループの継ぎ目を演出する効果音。種類は `AppState.fxType`（`SONG_FIELDS` に含む）で、`"auto"` はジャンルの標準（`GENRE_FX`）。カスタムモードのドラム欄の下の「FX / SE」で選び、「▷ 試聴」はループの終わりの盛り上げから次のループの頭の1小節まで鳴らす（`Playback.preview("fx")`）。
  - アレンジャーの FX のブロックは1つずつ種類を持てる（`ArrangeBlock.fx`。ブロックのラベルのセレクトで選ぶ。なし = 曲の設定 `fxType`）。鳴らすときは発音時刻にあるブロックを `arrangementBlockAt("fx")`（`LoopArranger.ts`）で調べて種類を決めるので、再生中の変更もすぐ反映される。音源は種類ごとに1つで、曲の設定とアレンジで使う種類を読み込み時に作る（WAV書き出しでは鳴らしている途中に作れないため）。再生中に新しい種類を選んだときは鳴らす直前に作る。
  - 種類（`FX_DEFS`）：`riser` = ライザー（ノイズのバンドパス掃き上げ＋2オクターブ上がる重ねたノコギリ波、トレモロ・オートパンが加速）、`build` = ライザー＋インパクト、`impact` = インパクト（沈むブーム＋閉じていくノイズ）、`downlifter` = ダウンリフター、`reverse` = リバースシンバル、`chip` = チップSE（8bit。矩形波の駆け上がり＋「ピュン」）。
  - 各種類は `rise`（ループの終わりに向けて鳴り、ループの頭ちょうどで終わる。`riseLen` が `bars` なら1小節＝8小節以上の進行は2小節、`2n` なら最後の2拍）と `hit`（ループの頭）の片方または両方を持つ。音量の山は `setValueCurveAtTime` の曲線でかけ、終わりは短いフェードでクリックを防ぐ。
  - 広がり：ノイズは左右別々のノイズ（`stereoNoise`）で鳴らし、各種類の音は `space()`（左右で揺れのずれたコーラス → 左右に跳ねるディレイ）を通す。インパクトの低音のブームは中央のまま広げない。チップSE はコーラスなし（ディレイだけ）。後ろの響きは自前のリバーブを持たず、マスターのリバーブ送りとロングリバーブで付ける。
  - 種類を足すときは `FxType`（`AppState.ts`）・`FX_DEFS`・`index.html` の `#c-fx-type` にそろえて足す。音色は再生開始時に反映される。
- パートを増やしたときは、保存済みの曲に新しいパートの項目がないので、`loadSong()`（`SongLibrary.ts`）で `parts` / `volumes` / `arrangement` を初期値で補っている。
- ピアノロール（`PianoRollTab.ts`）はコード進行1周分（メロディのループの長さ）を表示し、`AppState.melodyNotes`（サビを選んでいるときは `chorusMelodyNotes`）を直接編集する（鳴る音だけを持ち、休符は持たない）。編集中のセクションは表示上の一時的な状態としてモジュール内に持つ。「自動生成」は Aメロとサビの両方を作り直す。編集すると `melodyMethod` は `"manual"` になり、「自動生成」で `"auto"` に戻る。メロディは単音なので、重なる音は手前で切るか消す。再生中の編集はメロディだけ読み込み直して（`reloadLayer("melody")`）すぐ反映する。
- メロディは起動時・「＋ 新規作成」では作らず空のまま。自動生成ボタン（ピアノロールの「自動生成」、カスタムモードのメロディの差し替え ↻、シンプルモードで「自動生成」を選んで「生成する」／「↻ 再生成」）を押したときに初めて作る。`melodyMethod === "auto"` でも `melodyNotes` が空なら未作成として扱い、コード進行・キーを変えても自動では作らない（作成済みなら作り直す）。
- ピアノロールの入力設定（音符長 `pianoRollLength`・スケールロック `pianoRollScaleLock`・オクターブ `pianoRollOctave`）は AppState に置く。スケールロックはコード進行の `scaleLock` とは別。スケールの7音は `SCALE_TONES`（core＋accent）から作る。選択中の音と鍵盤入力の位置は表示上の一時的な状態としてモジュール内に持つ。
- ピアノロールの操作：クリックで配置（そのままドラッグで長さ）、音をドラッグで移動、右端で長さ変更、右クリック／Delete で削除、目盛りクリックで鍵盤入力の位置、A〜K（W E T Y U が黒鍵）で鍵盤入力、Z / X でオクターブ切替。
- ミュージックリスト（`SongLibrary.ts`）は曲の内容（`SONG_FIELDS`：モード・ジャンル・キー・BPM・小節数・パターン・メロディ・音色・アレンジ・パートON/OFF・音量）を localStorage に保存する。画面・タブ・ピアノロールの入力設定は保存しない。曲の内容に関わる項目を AppState に足したら `SONG_FIELDS`（`AppState.ts` に定義）にも足す。`SONG_FIELDS` は曲ファイルと元に戻す／やり直すの対象にもなる。
- 曲ファイル：ミュージックリストのツールバーの「ファイルを読み込む」「すべて書き出す」と、曲の ⋮ メニューの「ファイルに書き出す」。形式は `{ format: "toniq-song", version, exportedAt, songs: SavedSong[] }` の JSON（拡張子 `.toniq.json`）。読み込んだ曲は新しい ID で一覧に追加する（上書きしない）。コード進行・ドラムなど鳴らすのに必要な項目がない曲は飛ばし、足りない項目は `loadSong()` と同じく初期値で補う。形式を変えるときは `FILE_VERSION` を上げ、古い形式も読めるようにする。
- 元に戻す／やり直す（`History.ts`）：`setState` の直前（`onBeforeSetState`）に、`SONG_FIELDS`（モードを除く）が変わるなら変更前のスナップショットを積む（最大100）。押してから離すまで（ドラッグ・ノブ）と、操作が途切れるまで（600ms）の変更は1つにまとめる。シンプルモード・カスタムモードの画面でだけ使え、文字の入力欄ではブラウザ標準の元に戻すになる。
  - 表示用の一時的な差し替え（ジャンルのサンプル試聴など）は `withoutHistory()` で囲んで履歴に残さない。描画関数の中で曲の内容を `setState` しない（やり直しの履歴が消える）。
  - 曲を開いた（`loadSong`）・新規作成（`newSong`）・起動時は履歴を捨てる（`resetHistory`）。
  - 戻したとき再生中なら、アレンジ・音量・パートON/OFF・メロディだけの変更はその場で反映し、それ以外は各画面の `restartIfPlaying()` で再生し直す。
- 用語のツールチップ（`Glossary.ts`）：要素に `data-term="キー"` を付けると、カーソルを乗せる（キーボードならフォーカスする）と少し待って `TERMS` の説明を出す。`span` とアレンジャーのレーン名には点線の下線が付く。パート名（`LayerName`）はそのまま `TERMS` のキーとして使う（アレンジャー）。説明は初心者向けに1〜2文で、専門用語を重ねない。新しい用語を画面に出したら `TERMS` に足して `data-term` を付ける。
  - ON/OFF は設定画面で切り替える（`AppState.tooltips`、localStorage の `toniq.tooltips` = `on` / `off`、`<html data-tooltips>`。OFF では下線も出さない）。`<head>` でも描画前に `data-tooltips` を付ける。曲の内容ではないので `SONG_FIELDS` には入れない。
- 設定画面（`SettingsScreen.ts`、`data-screen="settings"`）はメニューの横長の「設定」カードから開く。端末ごとの設定（配色・スキン・音名の表記・ループ再生・ドラムの音源・ツールチップ）を集める。曲に保存する項目は置かない。設定を足すときは AppState に項目を足し、保存は担当のモジュールが localStorage（`toniq.*`）に行い、表示の切り替えは `<html data-*>` で行う。
- `AppState.songId` は今の曲がリストのどの曲か（`null` = 未保存）。リストから開いた・保存した曲は「上書き保存」になり、シンプルモードで生成し直すと `null` に戻って新しい曲として保存される。リストで再生・開くと、その曲を今の曲として読み込む（未保存の曲があれば確認する）。
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
- `styles.css` では色を直書きせず、`:root` のトークン（`var(--…)`）を使う。トークンを足すときは `:root[data-theme="dark"]` にもダーク用の値を足す。例外はパートの識別色（`.arr-*` / `.dot-*` のパステル）とアクセント色の上の白文字・クイズの黒鍵で、どちらのテーマでも同じ色を使う。
- カスタムモードの設定タブ・アレンジャータブ（`.hw`）と情報バー（`.hw-bar`）とタブ（`.hw-tabs`）はスキンで見た目が変わる。フラットスキンの形はシンセサイザーのプラグイン風（区切り線で仕切ったフラットなグレーの面、白いノブと細い色の弧、下線付きのドロップダウン、グレーの値の箱、情報バー・タブ・小節の目盛りは黒い帯、選択中はオレンジの枠）。色は `--hw-*` / `--knob-*` / `--slider-*` / `--track-*` のトークンを使う。BPM はノブ、コード進行・ドラムパターンは ◀▶ で切り替え（`Controls.ts`）。AppState から range の値を書き換えたら `syncControls()` で見た目をそろえる。
- ミキサー（`MixerPanel.ts`、`#c-arr-mixer`）はアレンジャータブのタイムラインの下にだけ置く（設定タブには置かない）。左端に dB 目盛り、パートごとのチャンネル（色・名前、ON/OFF ボタン、縦フェーダー `attachFader`＋レベルメーター、値 0〜100）、右端にマスターのメーターと dB。フェーダーは `VolumeManager.setVolume` で `AppState.volumes`（初期値は `defaultState.volumes`。曲に保存され、元に戻す／やり直すの対象）を書き換え、Volume ノードにもすぐ当てる。メーターは再生中だけ `Tone.Meter`（パートはサイドチェインの Gain のあと、マスターはリミッターのあと。WAV / MP3 書き出しのコンテキストには作らない）を読む。パートの ON/OFF はミキサーの ON ボタン、アレンジャーのレーンの ON ボタン、設定タブのパッド／アルペジオ／シグネチャーのボタンで切り替える。
- メニューへの導線は、メニュー以外のすべての画面の上部に出るパンくずの「メニューに戻る」ボタン。ヘッダーの「⋯」メニューとシンプル／カスタムの切り替えボタンは廃止した。
- カスタムモードには「生成する」ボタンを置かない（設定の変更はその場で反映され、メロディの作り直しはアレンジャータブの「レイヤー差し替え」で行う）。情報バーの主ボタンは「▷ 再生」。
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
  - コード進行1周（4小節未満なら4小節）を、ドラム・コード・ベース・パッド・シグネチャー・メロディをアレンジに関係なく同時に鳴らす。
  - 各パートは AppState から読むので、鳴らしている間だけ `chordPattern` / `drumPattern` / `melodyNotes` を差し替え、`Playback.stop()` で元に戻す（曲の内容は変わらない）。
  - サンプル中にジャンルを選び直すとそのジャンルのサンプルに切り替わり、テンポを変えるとすぐ反映される。画面の切り替え（`stopSample()`）・生成・ほかの再生で止まる。
- クイズの音は曲の再生（Tone.js）とは別のオーディオコンテキストで鳴らす。新しい音を鳴らす・次の問題へ進む・画面を離れると前の音を止める。クイズ画面に入ると曲の再生は止める。
- Git のコミット・push はユーザーが自分で行う。Claude はコミット・push しない。
- ある程度まとまった作業（機能の追加・画面の作成・不具合修正など）が終わったら、作業報告の最後にコミットメッセージ案を日本語で提示する。1行目に変更の要約（`feat:` / `fix:` / `refactor:` / `docs:` などの接頭辞付き）、空行のあとに主な変更点を箇条書きにする。案を示すだけで、コミットは実行しない。
- コメント・ログは日本語。
- Claude の出力はすべて日本語で書く。ユーザーへの返答・作業報告に加え、ツール実行時の説明（権限確認で表示される description）、ユーザーへの質問（選択肢を含む）、計画の提示も日本語にする。

## 既知の問題（修正時に注意）

- `npm run electron:dev` は、vite-plugin-electron が起動する Electron に加えて `concurrently` でもう1つ起動する。後者には `NODE_ENV` が渡らないので `electron/main.ts` の `isDev` が false になり、`dist/index.html` を開こうとする（未修正。開発は `npm run dev` を使う）。
- 曲の保存（`SongLibrary.ts` の `writeSongs`）は localStorage の容量を超えると例外になり、保存に失敗したことを画面に出さない。
- ドラムのワンショット音源は `public/samples/drums/default/` にしかなく（`rim` もない）、ジャンルのフォルダは空、`trance/` フォルダはない。
- `npm run dev` は Electron も起動し、Electron を閉じると Vite も終了する。VS Code の拡張機能など `ELECTRON_RUN_AS_NODE=1` が設定された環境から起動すると Electron が起動に失敗する。
- MIDI書き出し（`exportMidi()`。AppState を読む）は再生と同じ音の並びを使う：曲全体の並び（`songProgression()` / `songMelody()`。セクション・エンディング込み）から、メロディ・コード（`chordEvents()`。コードのリズム込み）・パッド（`padEvents()`）・アルペジオ（`arpNotes()`）・ベース（`bassNotes()`。ジャンル別パターン、強さは `bassVelocity()`）・ドラム（チャンネル10、GM の音の番号。ブロックごとのパターン・フィル・エンディングも反映。`drumStepHits()`）。曲全体（`AppState.bars` 小節）をループで埋め、アレンジのブロックの外・OFF のパートは書き出さない。シグネチャー・FX / SE は音色が特徴のパートなので書き出さない。音色（GM の番号）は目安。強さの揺らし・ストラムは入れない。
- カスタムモードの「雰囲気」はコード進行の「カテゴリ」として選ぶ。スケールは `chordPattern.base_scale` から決まり（別に持たない）、スケールを選ぶとそのスケールのコード進行に切り替わる。
- コードのリズム（`chordRhythm`）・コードの音色（`chordInstrument`）・メロディの音色（`melodyInstrument`）は ChordPlayer / MelodyPlayer が AppState から読む。音色の定義は各 Player の `INSTRUMENTS`（ChordPlayer は Synth・音色専用のエフェクト・共通ローパスの周波数・コーラス量の組）。メロディの音色は初期値 `auto`（ジャンルの標準。`melody_params.json` の `instrument`）で、MelodyPlayer の `INSTRUMENTS` は Synth とエフェクト（ビブラート・ディレイなど）の組で定義する。ジャンルを追加するときは `instrument` も指定する。音色は Synth を作り直したとき（再生開始時）に反映される。
- パートの ON/OFF は `setLayerEnabled` で切り替える（OFF で破棄、再生中に ON にするとすぐ読み込み、アレンジ上ブロックのある小節から鳴る）。アレンジャーで OFF のパートにブロックを置くと ON になる。
- シンプルモードの曲の長さは 32 小節（`SimpleScreen.ts` の `SIMPLE_SONG_BARS`。生成時・コード進行の差し替え時に設定する）。
- シンプルモードの「生成された楽曲」の波形は実際の音声ではなく、周回ごとのパート数とドラムの強さから描いた表示用のもの。
- 各パートの Synth はモジュールに1つずつ。WAV書き出しは再生を止めて Synth を作り直し、終わったら破棄する。再生中に書き出すと再生は止まる。
- WAV書き出し（`Playback.renderWav(onProgress)`）は進み具合を知らせる。Tone.Offline は途中経過を返さないので、`renderOffline` がブラウザ標準の `OfflineAudioContext` を `Tone.OfflineContext` で包んで同じ手順で描画し、合成の途中を `suspend()` で区切って（`RENDER_STEPS` 回）進み具合を知らせる。段階は `prepare`（準備）→ `schedule`（Tone.js が演奏の予定を組み立てる。`currentTime` で測る）→ `render`（音声の合成）→ `encode`（WAV に変換）で、全体の割合は `STAGE_SPAN`。失敗したとき・鳴らすパートがあるのに無音のときは Tone.Offline で描き直す（進み具合なし）。UI は `ExportProgress.ts` の `exportAudioWithProgress(format, …)` を使う。
- MP3書き出し（`Playback.renderMp3(onProgress)`）は WAV と同じ `renderSong()` で合成した音声を `@breezystack/lamejs`（純 JS の MP3 エンコーダ。ES モジュール対応版の lamejs）で 192kbps に変換する。エンコーダは書き出すときだけ動的に読み込む。変換は重いので `MP3_CHUNK` ごとに区切って画面に返し、`encode` の段階の進み具合を知らせる（全体の割合は `STAGE_SPAN.mp3`）。ボタンは両モードの書き出し欄（`s-export-mp3` / `c-export-mp3` / `c-arr-export-mp3`）。
- `Playback.play()` は開始時点の AppState で各パートを読み込むので、再生中に曲の内容（コード進行・ドラム・メロディ・キーなど）を変えたら先頭から再生し直す（アレンジの編集だけは再生し直さなくてよい）。
