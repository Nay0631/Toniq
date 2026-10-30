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
index.html              UI（現状はボタン・スライダーのみの検証用画面）
src/main.ts             エントリ。UIイベント → AppState 更新 → engine 呼び出し、WAV書き出し
src/data/               楽曲データとデータ型
  types.ts                ChordProgression / DrumPattern 型
  degree_resolver.ts      ディグリー → 実音の変換（resolveChord）
  chord_progressions.json コード進行DB（ディグリー表記）
  drum_patterns.json      ドラムパターンDB（16ステップ）
  easy_mode_table.json    シンプルモード用：ジャンル×雰囲気 → BPM・候補ID
  tempo_presets.json      ジャンル別テンポプリセット（ゆっくり/普通/速い）
  melody_params.json      ジャンル別メロディ生成パラメータ
  mix_presets.json        ジャンル別マスターエフェクト設定
src/engine/
  AppState.ts             アプリ状態の唯一の保持場所
  SimpleModeResolver.ts   シンプルモード：ジャンル×雰囲気からパターンを決定
  LayerManager.ts         パートのON/OFF・差し替え・再ロード
  LoopArranger.ts         周回ごとにパートを増やしていくアレンジ
  {Drum,Chord,Bass,Arp,Pad,Melody}Player/Engine.ts  各パートの Tone.Part 生成
  MelodyGenerator.ts      コード構成音・スケールに基づくメロディ生成
  SynthFactory.ts         ドラム音源
  VolumeManager.ts        パート別 Volume ノード（0〜100 → dB）
  MixerEngine.ts          マスターリバーブ／コンプ／リミッター
  Transport.ts / TapTempo.ts  BPM・再生制御、タップテンポ
  MidiExporter.ts         MIDI書き出し
  Exoporter.ts            旧WAV書き出し（全体コメントアウト済み・未使用。WAVは main.ts で実装）
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
- 新しいディグリーやスケールを使う場合は、`degree_resolver.ts` の `SCALE_INTERVALS`（必要なら `CHORD_INTERVALS`）にも追加する。未定義だと実行時に例外になる。
- キー変更は `AppState.key` を変えて再ロードするだけで済む状態を保つ。

### 3. 状態は AppState.ts で一元管理する

- モード・ジャンル・雰囲気・キー・BPM・テンポプリセット・選択中パターン・メロディ・パートON/OFF・音量は、すべて `AppState` に置く。
- 読み取りは `getState()`、更新は `setState(partial)` のみ。モジュール内に同じ値のコピーを持たない（`let currentBpm` のような変数を作らない）。
- 各 engine モジュールが持ってよいのは Tone.js のオブジェクト（Synth / Part / Volume ノード）だけ。
- `setState` はシャローマージなので、`parts` / `volumes` などのネストしたオブジェクトはスプレッドで丸ごと渡す：
  `setState({ parts: { ...getState().parts, arp: false } })`
- AppState に項目を追加するときは、インターフェースと `defaultState` の両方を更新する。

## その他の決まりごと

- パート名は `"drum" | "chord" | "bass" | "arp" | "pad" | "melody"`（`LayerName`）で統一。
- 各パートモジュールは `init*Synth()` / `load*()` / `dispose*()` の形にそろえる。`load*` は既存の Part を破棄してから作り直す。
- ジャンル名は `EDM` / `8bit` / `ローファイ` / `ゲームBGM`、雰囲気は `明るい` / `暗い` / `落ち着いた` / `緊張感` / `切ない` / `激しい`。JSON のキーと完全に一致させる。見つからないときのフォールバックは `ローファイ` / `落ち着いた`。
- コメント・ログは日本語。

## 既知の問題（修正時に注意）

- `AppState.ts` に `interface AppState` が2回宣言されている（宣言マージで動いているだけ）。`tempoPreset` は2つ目にしかないので、1つにまとめること。
- `melody_params.json` のキーは `edm` / `lofi` / `game_bgm` / `8bit` だが、`main.ts` ではジャンル名を `toLowerCase()` して渡している。そのため `ローファイ` と `ゲームBGM` はどちらも `lofi` にフォールバックしている。
- タップテンポは `AppState.bpm` を更新するが、`main.ts` 側では Transport の BPM を直接書き換えている。
- `dist-electron/` がリポジトリに含まれている（ビルド成果物）。
