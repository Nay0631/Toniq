# 音・lidless・ミックス・書き出し

詳しい仕様。CLAUDE.md の「詳しい仕様」から参照される（要点・決まりごとは CLAUDE.md）。

## lidless（内部シンセ）

- Toniq の内部シンセサイザーの名称は **lidless**（グロウ）とする。UI 表示・コメント・ドキュメントでは「lidless」と呼ぶ。
- lidless（`grow/`）は C++ のシンセサイザー。音を作るコア（`grow/core/`。JUCE なし）を、Toniq では WebAssembly＋AudioWorklet で、単体では JUCE の Standalone・VST3 で鳴らす。作り・決まりごとは `grow/README.md`。
  - Toniq ではメロディ・コード・ベース・パッド・アルペジオ・シグネチャー・カウンターメロディ・FX / SE はいつも lidless で鳴らす（ドラムは音源 `drumSource` が `"grow"` のとき）（準備ができていない・wasm がないときは各 Player の Tone.js の音色。シグネチャーは `SIGNATURES` の `create`）。シグネチャーはジャンルの鳴り方（`events`）のまま、音だけ lidless で出す（`growTrigger`。ノイズのイベントは `NOISE_NOTE`。レコードノイズはプチプチ音をプリセット「レコードプチ」の2台目で鳴らす `growCreate`）。コードは16音ポリで和音を鳴らし、`GrowInstrument` は同じサンプルに重なる合図（和音の発音・消音）を2サンプルずつずらして渡す。準備ができていない・wasm がないとき、コードはソフトパッドで鳴る。`Grow.ts` が `public/grow/grow.wasm` を読み込み、AudioWorklet（`growWorklet.js`。`?raw` で読み込んで Blob の URL で登録）をオーディオコンテキストごとに登録する。再生・試聴・サンプルは `Playback.audioReady`、WAV / MP3 書き出しは `renderSong` の `schedule` で、`prepareGrowContext()` を待つ（パッドなどはいつも lidless なので毎回）。準備ができていない・wasm がないときは `resolveMelodySound()` が予備の Tone.js の音色（`INSTRUMENTS`）のうちジャンルの標準にする。Tone.js の音色は画面では選べない（以前はカスタムモードの「インスト」で選べた。その曲は `loadSong()` が近い lidless のプリセットに読み替える）。
  - `GrowInstrument`（`Grow.ts`）はほかの音色の Synth と同じ `triggerAttackRelease` で鳴らす。音符は AudioParam（`on` / `off`）の1サンプルの合図で渡す（書き出しでも合う）。時刻を決めて当てるパラメーターも `setParamAtTime(ID, 値, 時刻)` で AudioParam（`pidx` / `pval`）の合図で渡す。音の終わりは 2ms 遅らせてレガートでつながるようにし、同じ高さが続くときはワークレットが前の音の終わりを無視する。自前のエフェクト（リバーブを含む）を持つので、各パートの Volume に直接つなぐ。同じタスクで作った `GrowInstrument` はマイクロタスクでまとめて1つの AudioWorkletNode（1つの wasm。最大16スロット）にする（`flush`）。スロットの最初の値は `processorOptions` で渡し、ノードができる前の発音・パラメーターはためておいて当てる。
  - コードの音色は lidless のプリセットだけ（`chordInstrument` はいつも `"grow"`。Tone.js の音色は wasm がないときのソフトパッドだけ）。カスタムモードの「コード進行」欄の「音色」は「ジャンルに合わせる（〇〇）」と、コードのパートで選べるカテゴリ（`Grow.ts` の `PART_CATEGORIES`。和音・パッド）のプリセットをカテゴリの見出し（`<optgroup>`）ごとに並べたもの（lidless の音作りのパネルでほかのカテゴリのプリセットを選んでいたら「その他」に足す）で、`growChordPreset` を書き換える（選び直すと `growChordParams` は捨てる）。以前の Tone.js の音色（`soft` / `epiano` / `strings` / `organ` / `square` / `supersaw`）を保存した曲は、`loadSong()`（`songFields`）が同じ音の lidless のプリセット（`LEGACY_CHORD_PRESETS`）に読み替える。
  - 音作りの値はメロディが `AppState.growPreset`（コアのプリセットの ID。初期値 `null` = ジャンルの標準 `MELODY_STANDARD`：EDM = シンセリード、8bit = チップリード、ローファイ = キーズ、ゲームBGM = ベル、テクノ = シンクリード、ハウス = プラック、トランス = トランスリード、アンビエント = ソフトパッド。以前の初期値 `"lead"` を保存した曲はそのまま）と `growParams`（変えた値。パラメーターの ID → 値。`null` = プリセットのまま）、コードが `growChordPreset`（初期値 `null` = ジャンルの標準 `CHORD_STANDARD`。パッドのパートのパッド系の音と重ならない和音の音：EDM・トランス = スーパーソウ、8bit = スクエア、ローファイ = エレピ、ゲームBGM・アンビエント = ストリングス、テクノ・ハウス = オルガン）と `growChordParams`、ベース・パッド・アルペジオ・シグネチャー・カウンターメロディが `growSounds`（`{ preset, params }`。`preset` の `null` = ジャンルの標準。パッドは `PAD_STANDARD`（EDM・トランス・アンビエント = ワイドパッド、テクノ = ゲートパッド、ほか = ソフトパッド）、アルペジオは `arp_params.json` の `instrument` → `ARP_STANDARD`（ジャンルで上書きするときは `ARP_GENRE_STANDARD`。ローファイ = ローファイキーズ）、シグネチャーは `SIGNATURE_STANDARD`、カウンターメロディは `COUNTER_STANDARD`。同じジャンルの中ではパートどうしで同じプリセットを使わない（8bit のコードとアルペジオのスクエアだけ例外）。`GROW_STANDARD`（`Grow.ts`）がプリセットを ID で探し、今の wasm にない ID は後ろの候補の既存のプリセットにする）。プリセットは曲に ID で保存する（以前は番号。番号で保存した古い曲は `loadSong()`（`songFields`）が `LEGACY_PRESET_IDS` で ID に読み替える。曲ファイルの `FILE_VERSION` は 2）。保存した ID が今の wasm にないときはジャンルの標準で鳴らす。どれも `SONG_FIELDS` に含む。パートごとの値は `currentGrowValues(part)`（`GrowPart`）で読み、書き換えは `setGrowSound()`。`GrowInstrument` には値を返す関数（`growValues(part)`）を渡す。ジャンルを足すときは `GROW_STANDARD` のメロディ（`MELODY_STANDARD`）・コード（`CHORD_STANDARD`）・ベース（`BASS_STANDARD`）・パッド（`PAD_STANDARD`）・シグネチャー（`SIGNATURE_STANDARD`）・カウンターメロディ（`COUNTER_STANDARD`）にも足す（なければローファイの定義）。パラメーターの表・プリセット・値の表示はコア（wasm）から読み、TypeScript 側では持たない。
  - 音作りのパネル（`GrowPanel.ts`、カスタムモードの設定タブの下 `#c-grow`。いつも出す。「対象」で編集するパートを選ぶ。プリセットは、そのパートで選べるカテゴリ（`PART_CATEGORIES`）の行ごとにチップで並べた一覧から選ぶ。先頭の行は「ジャンルの標準」、ほかのカテゴリのプリセットを選んでいる曲はその音を「その他」の行に出す。チップを押すと選んで1音鳴らし（`previewGrowSound`）、選んでいるチップをもう一度押すと鳴らすだけ（つまみで変えた値は消さない）。チップにフォーカスがあるときは ←→ で前後のプリセットへ送る（↑↓ は試し弾きのオクターブ）。マウスを乗せると `TERMS` の `sound.<ID>` の説明を出す）はテスト用の暫定。最終的にはプリセットを選ぶだけにする予定。値を変えると `applyGrowLive()`（`Grow.ts`）で鳴っている lidless（全パート）にすぐ当てる（作り直さない）。BPM の変更も `Playback.applyBpm()` から当てる。
  - 以前の Tone.js 版（`ToniqSynth.ts` / `ToniqSynthPanel.ts`、`AppState.toniqSynth` / `toniqSynthEnabled`、メロディの音色 `"toniq"`、localStorage の `toniq.test.toniqSynth`）は廃止した。保存済みの曲の `toniqSynth` は読み捨て、`melodyInstrument: "toniq"` は `loadSong()`（`songFields`）で lidless のジャンルの標準にして読む。
  - MIDI書き出しはほかの音色と同じくメロディの音として書き出す（音色の再現はしない）。

## ドラムの音源

- ドラムの音源（テスト中）：`AppState.drumSource` が `"grow"`（lidless）か `"sample"`（ワンショット音源、初期値）。設定画面の「ドラムの音源」で切り替え、`Preferences.ts` が localStorage の `toniq.drumSource` に保存する（保存がなければサンプル音源。lidless を選んで保存した端末はそのまま。以前選べたシンセ（`"synth"`）を保存した端末はサンプル音源にする）。ファイルがないドラムの音（今は `rim`）は lidless で鳴る（lidless を鳴らせなければ Tone.js のシンセ）。`"synth"`（Tone.js のシンセ）は画面では選べず、`npm run mix:measure -- --drum synth` で測るときだけ使う。曲の内容ではないので `SONG_FIELDS` には入れない。パーカッションも同じ音源に合わせて鳴らす（ワンショット音源でファイルがないパーカッションは lidless）。再生中に切り替えたら（サンプル音源なら読み込みを待って）ドラムとパーカッションだけ読み込み直す。
  - lidless：トラックごとに lidless を1台ずつ鳴らす（`SynthFactory.ts` の `createGrowVoice`。コアの「ドラム …」のプリセット、ID は `drum_…`。トラック名 → ID は `GROW_DRUMS`）。ジャンルのキット（`DRUM_KITS`）の値（キックの高さ・ピッチの下がり方・長さ・クリック、スネアの高さ・長さ・響き線の帯域、ハイハットの長さ・帯域）は `growDrumSound()` がプリセットの値に上書きして当てる。どの音もサスティン 0 で鳴り終わるので発音の合図だけ送り（`GrowInstrument.triggerAttack`）、オープンハイハットのチョークだけ消音の合図（`triggerRelease`）を送る。クラップは短い音を3回重ねてから余韻を鳴らす。lidless を鳴らせない（準備ができていない・プリセットのない古い wasm）トラックはシンセで鳴る。
  - lidless のドラムは強さ 1 のピークが −6dB 前後で出るので、`GROW_TRIM_DB` で1打の聞こえる大きさをシンセのドラムにそろえている（差は全ジャンルで ±1dB ほど。2026-11-12 に測定）。プリセット・`DRUM_KITS` を変えたら測り直す。
  - 音源は `public/samples/drums/<フォルダ>/<トラック名>.wav`。フォルダはジャンルごと（`DrumSamples.ts` の `DRUM_SAMPLE_DIRS`：edm / 8bit / lofi / gamebgm / techno / house / trance / ambient）で、ない音は `default` フォルダ、それもなければそのトラックだけシンセで鳴る。ジャンルを追加したら `DRUM_SAMPLE_DIRS` にも足す。
  - 再生・試聴・WAV書き出しの前に `prepareDrumSamples(genre)` で読み込みを待つ（`Playback.ts` の `audioReady`）。読み込んだ AudioBuffer は Tone.Offline でもそのまま使う。file:// でも読めるよう XMLHttpRequest で相対パスから読む。
  - 音源はジャンルのドラムバス（高域カット→歪み→コンプ→持ち上げ）を通る。音源の音量は `SynthFactory.ts` の `SAMPLE_TRIM_DB` で下げており、`mix_presets.json` の `gain` はシンセのドラムで測った値のまま。

## 音の流れ・ボイシング・音量

- 音の流れ：各パートの Volume ノード（`VolumeManager.createVolumeNode`。フェーダーの値 → dB は `VolumeCurve.ts`：75 で 0dB、100 で +5dB）→ サイドチェイン用の Gain → `connectToMixer`（`MixerEngine.ts`）がパートの EQ（低域カット → 中域のへこみ）→ 定位（パン。`Tone.Panner`。左右の広がりを残すため2チャンネルで受ける）とつなぎ、そこからマスター入口とリバーブ送りに出す。マスターは 入口 → EQ → コンプ → 持ち上げ（`gain`）→ リミッター → フェード（ジャンルのサンプルの終わりのフェードアウト用。ふだんは 1 で素通し。docs/ui.md）。マスター（`MixerEngine.ts`）はコンテキストごとに1つで作り直さない。WAV書き出しと再生開始前は `mixerReady()` でリバーブの準備を待つ。
  - パートの低域カット（`PART_LOW_CUT`。12dB/oct のハイパス）：コード・パッド 140Hz、アルペジオ 200Hz、メロディ 150Hz、カウンターメロディ 160Hz、シグネチャー 90Hz（テクノのアシッドが低い音を鳴らすので浅く）。どれもそのパートの最低音（`VOICING_RANGES` など）より下に置き、キック・ベースの帯域に和音やメロディの低い成分を重ねない。ドラム・ベース・FX / SE（インパクトの低いブーム）は削らない。パーカッションは自分のキットの中で 150Hz から削る。
  - 伴奏の中域のへこみ（`PART_MID_DIP`）：コード・パッドの 2kHz（Q 0.8）を 2dB 引いて、メロディのいちばん聞こえる帯域を空ける（ボイシングでメロディを避けるのと同じねらい）。
  - 定位（`AppState.pans`。−100 = 左 〜 100 = 右。`SONG_FIELDS` に含む。ミキサーのパンのノブ）：初期値はアルペジオ L30・カウンターメロディ R30、ほか（ドラム・ベース・メロディ・コード・パッドなど）は中央。パーカッションはキットの中で楽器ごとにも振る（`SynthFactory.ts` の `PERC_PAN`：シェイカー右・ライド左・タンバリン左・コンガは高いほうが右、低いほうが左。パート全体のパンはその上にかかる）。MIDI書き出しには入れない。
  - リバーブはマスターに直接かけず送りで混ぜる（定位のあとから送る。全体量は `mix_presets.json` の `reverb.wet`、長さ `decay`、響き始めるまでの間 `preDelay`（なければ 0.02 秒。長いほど元の音が前に出る））。送り量はパートごとの標準が `MixerEngine.ts` の `REVERB_SENDS`（ベースは送らない）で、ジャンルで変えるパートだけ `mix_presets.json` の `reverb.sends` に書く（8bit はメロディ・コード・アルペジオなどを乾いた音に、アンビエントはドラム・パーカッション・メロディも深く、テクノ・ハウスはパーカッションを多めに、トランスはメロディ・アルペジオを多めに、ローファイはドラムを多めに）。送りのゲインはパートをつないだときに作り、`applyMixPreset` がジャンルの量に書き換える。
  - リバーブの戻りはコンプを通さない：戻り →（キックで沈めるゲイン）→ 戻りの EQ（マスターの EQ と同じ設定の別の EQ）→ 持ち上げ → リミッター。以前はマスター入口に戻していたので、ドラムでコンプが動くたびに響きも一緒に沈んで揺れていた（響きの長いアンビエント・ローファイで目立つ）。サイドチェインのうねりは、沈めた音を送ること・戻りを沈めることで別に付く。
  - FX / SE はさらに、ジャンルによらない長い響きのロングリバーブ（`LONG_REVERB` / `LONG_REVERB_SENDS`）にも送る（戻りは同じく戻りの EQ へ。キックでは沈めない）。
- コード・パッド・アルペジオのボイシングは `voiceProgression(progression, key, VOICING_RANGES.*)`（`degree_resolver.ts`）で決める。最低音を範囲内に収め、進行全体（ループの継ぎ目の 最後 → 最初 も含む1周）で合計が最小になる転回形の組み合わせを選ぶ（ボイスリーディング。1つずつ近いものを選ぶのではなく、全部の組み合わせから求める）。コードの間は、各音の動きの合計が小さい・同じ高さのまま保てる共通音が多い・最高音の動きが小さい並べ方を選び、進行の `inversion` は動きが同じくらいなら優先する（重みは `VOICE_COST`）。コード（`chordEvents`）はメロディ（`songMelody()`。メロディが OFF・未作成なら見ない）も渡し、最高音がメロディより上に出る・メロディと半音でとなり合う・短9度下に入る転回形を、その音の長さに応じて避ける（同じ高さは避けない。範囲は変えないので、避けきれない所は残る。2026-11-17 の計測で、最高音がメロディより上に出る時間は 38% → 14%、半音のぶつかりは 18% → 10%、コードの間の動きは変わらず）。メロディを読み込み直す（`reloadLayer("melody")`。ピアノロールの編集など）とコードも読み込み直す。パッド・アルペジオはメロディを見ない。パッドは `spread`（開離配置）。MIDI書き出しも同じボイシングを使う。各 Player は自前のリバーブを持たず（ローパス・コーラス・ディレイなどだけ）、エフェクトのノードは `dispose*` で一緒に破棄する。強さ（ベロシティ）は拍の位置で付けて少し揺らし、和音は数msずつずらして鳴らす（ストラム）。
- 音量（`mix_presets.json` の `gain`）：全ジャンルの聞こえる大きさ（統合ラウドネス）を **−16.5 LUFS** にそろえ、ピークは −1dB 以下に収める。`npm run mix:measure`（`tools/mix-measure.mjs`）で全ジャンル×雰囲気の曲を書き出して測り、`gain` の提案（今の `gain` ＋ 目標との差）を出す。音源・パート・ミックスを変えたら測り直す（`--save before` → `--compare before`）。
  - 2026-11-17 に決め直した値（全パート ON・32小節・ドラムは lidless・雰囲気は 激しい／落ち着いた）。以前はピークだけで決めていて、ジャンル間の差が 8.0 LU あった（テクノ −14.3 〜 アンビエント −22.3）：

    | ジャンル | `gain` | 統合ラウドネス | ピーク |
    |---|---|---|---|
    | EDM | −4.5 | −16.4 LUFS | −1.4dB |
    | 8bit | −4.5 | −17.1 | −1.7 |
    | ローファイ | −2 | −16.6 | −1.3 |
    | ゲームBGM | −4 | −17.5 | −1.3 |
    | テクノ | −5 | −16.3 | −2.7 |
    | ハウス | −5 | −16.6 | −3.2 |
    | トランス | −5 | −16.4 | −2.1 |
    | アンビエント | 0 | −20.4 | −2.0 |
    | ワルツ | −1 | −19.1 | −1.2 |
    | 6/8バラード | 0 | −16.9 | −1.3 |
    | シャッフル | −2 | −17.8 | −1.6 |

    別の条件（シード 2・雰囲気 明るい／暗い）でもピークはすべて −1.2dB 以下。
  - シャッフル（2026-11-18 に追加。5つの雰囲気＋シード 2 で測った）：ワルツと同じく1拍目でキックとベース（ブギウギ）が重なるのでピークが出やすい。ドラムのキットの持ち上げを下げてコンプを深くし（`makeup` 1、`compress` −21）、ピークが −1dB を超えない `gain` −2 にした（目標より 1.3 LU 小さい）。測っている途中、ドラム＋パーカッションだけが約 +5 dB 大きく出る回がしばらく続いたが（ドラムが二重に鳴ったときの大きさ）、その後は同じ条件で 12 回以上測っても再現しなかったので、測定環境の揺れとみて値には使っていない。
  - ワルツ・6/8バラード（2026-11-18 に追加。5つの雰囲気すべてで測った）：最初はドラムのピークが鋭く（ドラムだけで −0.6dB）、キットの持ち上げを下げてコンプを深くした（`DRUM_KITS` の `makeup` 3・2、`compress` −20）。マスターもコンプ `threshold` −20・`ratio` 2.5、`limiter.threshold` −2。ワルツは毎小節の1拍目でキックとベースが重なってピークになるので（ドラム −4.7dB とベース −10.7dB が合わさって −2.0dB）、`gain` −1 で止めている（目標より 2.6 LU 小さい。サイドチェイン 25・キックを短くするのも試したが 0.2〜0.3dB しか下がらなかった）。
  - 目標に届かないジャンル：ゲームBGM と 8bit は瞬間のピークが大きく、−16.5 まで上げるとピークが −1dB を超える（ゲームBGM は `gain` −3 で −0.3dB、8bit は −4 で −0.9dB）ので、収まる所で止めている。アンビエントは曲の大半が静かで盛り上がる所だけ大きく、統合ラウドネスを合わせると瞬間の大きさ（400ms の窓の最大）がほかのジャンルより大きくなるので、瞬間の大きさがほかと同じくらい（−14 LUFS 前後）になる所までにしている。
  - `gain`（持ち上げ）はコンプのあと・リミッターの前なので、リミッターに当たらない範囲では足した分だけ大きくなる。コンプ・リミッター（Web Audio の DynamicsCompressor）は設定に応じて自動で持ち上げるので、`threshold` / `ratio` を変えると大きさも変わる（アンビエントで `threshold` −28・`ratio` 3 にしたら 5〜9 LU 上がった）。変えたら必ず測り直す。
  - リミッター（`Tone.Limiter`）は速い立ち上がりを通すので、`threshold` より上に 0.5〜1dB はみ出す。ピークが −1dB に近いジャンル（EDM・8bit・ゲームBGM・アンビエント）は `limiter.threshold` を −2 にしている。アンビエントはコンプも少し深くした（`threshold` −20 → −24、`ratio` 2 → 2.5、`attack` 0.05 → 0.02。静かな所との差を縮めて全体を持ち上げる）。
  - 書き出した WAV は `npm run grow:render -- --analyze <WAV>` でも測れる（16bit に丸めたあとの音。`mix:measure` は丸める前を測る）。
- 以前の測定の記録：lidless のプリセットは聞こえる大きさを −18 LUFS にそろえてある（`grow/README.md`）。lidless にしたあと（2026-11-11）、全ジャンル・全パート ON・32小節・ドラムはシンセ／サンプルで測り直し、ピークはすべて −1.5dB 以下だった。アンビエントだけ統合ラウドネスがほかより 6〜10dB 小さかったので、`gain` を −4 → 1 に上げた（ほかのジャンルはそのまま）。そのあと lidless を作り直した（モジュレーション・エフェクト・マルチティンバー、コードの標準の音色）ので測り直し、アンビエントのシンセのドラムが −0.6dB になったため `gain` を −1 にした（全ジャンルのピークは −1.6dB 以下）。ドラムの音源を lidless にしたとき（2026-11-12）も、全ジャンル・全パート ON・32小節・雰囲気「激しい」で測り、ピークはすべて −1.2dB 以下、統合ラウドネスはシンセのドラムと ±1.5dB 以内だったので `gain` はそのまま。

## グルーヴ（スウィング・サイドチェイン）

- グルーヴ（`Groove.ts`）：量は `AppState.swing` / `sidechain`（0〜100、`SONG_FIELDS` に含む。`null` = ジャンルの標準で、`mix_presets.json` の `swing` / `sidechain`）。カスタムモードの基本設定の「グルーヴ」のノブで決め、「標準」で `null` に戻す。シンプルモード・ジャンルのサンプルはジャンルの標準で鳴る。ジャンルを足すときは `mix_presets.json` に `swing` / `sidechain` も入れる。
  - スウィング：`applySwing()` が Transport の `swing`（100 で `SWING_MAX` = 0.67）と `swingSubdivision`（跳ねる単位 `AppState.swingUnit`：`16n`（初期値）= 裏の16分音符、`8n` = 裏の8分音符のシャッフル。`SONG_FIELDS` に含む。カスタムモードの基本設定の「もっと調整」の「跳ねる単位」）を設定する。再生・試聴・サンプル・WAV書き出し（Offline の Transport）の開始時と、量・単位を変えたとき（再生中もすぐ反映）に呼ぶ。裏拍に当たる全パートのイベントがずれる。MIDI書き出しも同じずらし方（`swungBeats`。単位の2倍の中の位置に応じた sin の形で、いちばん大きい所で「単位の2倍 ÷ 3 × 量」）で発音位置に反映する。音符そのものを3連符にする仕組みはない（16ステップ前提）。
  - サイドチェイン：ドラムのキックが鳴るたびに `sidechainHit(time, velocity)` が、`SIDECHAIN_PARTS`（ベース・パッド 1、コード 0.8、アルペジオ・シグネチャー 0.6。メロディ・ドラム・FX は沈めない）のサイドチェイン用 Gain を数msで下げ（100 で 0.2 倍 ≒ −14dB）、拍の6割で戻す。戻りは dB で見て一定の速さ（`exponentialRampToValueAtTime`。コンプレッサーのリリースと同じ形）：キックが鳴っている間は沈んだままで、あとから膨らむように戻る（以前は音量の直線で、dB では最初の 1/4 で半分近く戻ってキックに重なっていた）。リバーブの戻りも同じ形で軽く沈める（`REVERB_DUCK_WEIGHT` = 0.5。`MixerEngine.reverbDuckGain()`）。量はキックのたびに AppState から読むので再生中の変更もすぐ反映される。ドラムが OFF・キックがない小節では沈まない。音量を下げるだけなので `gain` の測り直しは要らない。

## 音色

- コードのリズム（`chordRhythm`）・コードの音色（`growChordPreset`）・メロディの音色（`melodyInstrument`）は ChordPlayer / MelodyPlayer が AppState から読む。コードの音色は lidless のプリセット（ChordPlayer の Tone.js の音色は wasm がないときの `FALLBACK` だけ）。メロディの音色の定義は MelodyPlayer の `INSTRUMENTS`。メロディの音色は初期値 `auto`（ジャンルの標準。`melody_params.json` の `instrument`）で、MelodyPlayer の `INSTRUMENTS` は Synth とエフェクト（ビブラート・ディレイなど）の組で定義する。ジャンルを追加するときは `instrument` も指定する。音色は Synth を作り直したとき（再生開始時）に反映される。

## 書き出し（WAV / MP3 / MIDI）

- 各パートの Synth はモジュールに1つずつ。WAV書き出しは再生を止めて Synth を作り直し、終わったら破棄する。再生中に書き出すと再生は止まる。
- 書き出す長さは曲（`getSongSeconds()`。拍子の拍の数で計算する）＋余韻 `renderTailSeconds()`（2 秒。エンディングを使うときは1小節以上。BPM 60 なら 4 秒）。
- WAV書き出し（`Playback.renderWav(onProgress)`）は進み具合を知らせる。Tone.Offline は途中経過を返さないので、`renderOffline` がブラウザ標準の `OfflineAudioContext` を `Tone.OfflineContext` で包んで同じ手順で描画し、合成の途中を `suspend()` で区切って（`RENDER_STEPS` 回）進み具合を知らせる。段階は `prepare`（準備）→ `schedule`（Tone.js が演奏の予定を組み立てる。`currentTime` で測る）→ `render`（音声の合成）→ `encode`（WAV に変換）で、全体の割合は `STAGE_SPAN`。失敗したとき・鳴らすパートがあるのに無音のときは Tone.Offline で描き直す（進み具合なし）。UI は `ExportProgress.ts` の `exportAudioWithProgress(format, …)` を使う。
- MP3書き出し（`Playback.renderMp3(onProgress)`）は WAV と同じ `renderSong()` で合成した音声を `@breezystack/lamejs`（純 JS の MP3 エンコーダ。ES モジュール対応版の lamejs）で 192kbps に変換する。エンコーダは書き出すときだけ動的に読み込む。変換は重いので `MP3_CHUNK` ごとに区切って画面に返し、`encode` の段階の進み具合を知らせる（全体の割合は `STAGE_SPAN.mp3`）。ボタンは両モードの書き出し欄（`s-export-mp3` / `c-export-mp3` / `c-arr-export-mp3`）。
- MIDI書き出し（`exportMidi()`。AppState を読む）は再生と同じ音の並びを使う：曲全体の並び（`songProgression()` / `songMelody()`。セクション・エンディング込み）から、メロディ・コード（`chordEvents()`。コードのリズム込み）・パッド（`padEvents()`）・アルペジオ（`arpNotes()`）・ベース（`bassNotes()`。ジャンル別パターン、強さは `bassVelocity()`）・ドラム（チャンネル10、GM の音の番号。ブロックごとのパターン・フィル・エンディングも反映。`drumStepHits()`）。曲全体（`AppState.bars` 小節）をループで埋め、アレンジのブロックの外・OFF のパートは書き出さない。シグネチャー・FX / SE は音色が特徴のパートなので書き出さない。音色（GM の番号）は目安。強さの揺らし・ストラムは入れない。
