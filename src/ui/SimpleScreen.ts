import { getState, setState } from "../engine/AppState";
import { resolveSimpleMode, resolveTempoPreset, rerollChord, rerollDrum, pickChorus } from "../engine/SimpleModeResolver";
import { chorusProgression, generateSongMelodies } from "../engine/SongForm";
import { generateMelody } from "../engine/MelodyGenerator";
import { isArrangedAt, LAYERS } from "../engine/LoopArranger";
import { tap, resetTap } from "../engine/TapTempo";
import { isMetronomeOn, onMetronomeChange, stopMetronome, toggleMetronome } from "../engine/Metronome";
import * as Playback from "../engine/Playback";
import { onRender, showTab } from "./Router";
import { formatTime } from "./format";
import { chordNameSpans, keyScaleSpan } from "./ChordTips";
import { startPianoRollPlayhead } from "./PianoRollTab";
import { exportAudioWithProgress, exportMidiWithName } from "./ExportProgress";
import { CUSTOM_DRUM_ID } from "../data/types";
import { bindSpaceToPlay } from "./SpaceKey";
import { beatsPerBar, genreMeter, unitsPerBeat } from "../engine/Meter";
import { setMeter } from "./CustomState";
import { drumPatternIn, isCustomDrum } from "../engine/DrumEngine";

const $ = (id: string) => document.getElementById(id);

// data-mood などは他の画面で使っても混ざらないよう、シンプルモード画面の中だけを探す
const $$ = (selector: string) =>
  document.querySelectorAll<HTMLElement>(`[data-screen="simple"] ${selector}`);

// ジャンル選択の下に出す、初心者向けの一言の説明。
// {キー:文字} と書いた所は用語のツールチップ（Glossary.ts の TERMS のキー）を付けて表示する
const GENRE_DESCRIPTIONS: Record<string, string> = {
  "EDM":         "クラブやフェスで流れる、ノリのよい電子音楽。{chorus:サビ}で盛り上がる",
  "8bit":        "昔のゲーム機のような、ピコピコした懐かしい音（{chiptune:チップチューン}）",
  "ローファイ":   "{vinyl:レコードのノイズ}が混ざった、ゆったりした作業用 {bgm:BGM} の定番",
  "ゲームBGM":   "ゲームのフィールドや街で流れるような、{melody:メロディ}が主役の曲",
  "テクノ":       "同じ{phrase:フレーズ}をくり返す、機械的でクールなダンス音楽",
  "ハウス":       "{fourOnFloor:4つ打ち}の{kick:キック}とピアノが気持ちよい、明るいダンス音楽",
  "トランス":     "うねる{synth:シンセ}が盛り上がっていく、高揚感のある疾走系ダンス音楽",
  "アンビエント": "{rhythm:リズム}が控えめで、空間に広がるような癒やしの音",
  "ワルツ":       "{waltz:3拍子}の「ズン・チャッ・チャッ」で踊る、弦とオルゴールの優雅な舞踏会の曲",
  "6/8バラード":  "ピアノが{triplet:3連符}で和音を刻む、ゆったり歌い上げるバラード",
  "シャッフル":   "{triplet:3連符}で「タッカ タッカ」と跳ねる、ブルースやロックンロールのようなごきげんな曲",
};

// 雰囲気ごとに選べるジャンル（シンプルモードのジャンルのチップをこの順で絞り込む）。
// ジャンルを足すときは、どれか1つ以上の雰囲気に入れる
const MOOD_GENRES: Record<string, string[]> = {
  "明るい":     ["EDM", "8bit", "ゲームBGM", "ハウス", "トランス", "ワルツ", "6/8バラード", "シャッフル"],
  "暗い":       ["EDM", "8bit", "テクノ", "トランス", "アンビエント", "ワルツ", "シャッフル"],
  "切ない":     ["EDM", "ローファイ", "ゲームBGM", "トランス", "アンビエント", "ワルツ", "6/8バラード"],
  "激しい":     ["EDM", "8bit", "テクノ", "トランス", "ワルツ", "シャッフル"],
  "落ち着いた": ["ローファイ", "ゲームBGM", "ハウス", "アンビエント", "ワルツ", "6/8バラード", "シャッフル"],
};

function genresForMood(mood: string): string[] {
  return MOOD_GENRES[mood] ?? MOOD_GENRES["落ち着いた"];
}

// 説明文の {キー:文字} を用語のツールチップ付きの span にして並べる
function renderGenreDesc(el: HTMLElement, text: string): void {
  el.replaceChildren();
  const re = /\{(\w+):([^}]+)\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    el.append(text.slice(last, m.index));
    const term = document.createElement("span");
    term.dataset.term = m[1];
    term.tabIndex = 0;  // キーボードでもフォーカスして説明を出せるように
    term.textContent = m[2];
    el.append(term);
    last = m.index! + m[0].length;
  }
  el.append(text.slice(last));
}

// ジャンルを選ぶ（テンポのプリセットはジャンルに合わせた BPM にする）
function selectGenre(genre: string): void {
  const s = getState();
  const bpm = s.tempoPreset === "custom" ? s.bpm : resolveTempoPreset(genre, s.tempoPreset);
  setState({ genre, bpm });
}

// ===== 状態の更新 =====

// シンプルモードの曲の長さ（小節）
const SIMPLE_SONG_BARS = 32;

function songBars(): number {
  return SIMPLE_SONG_BARS;
}

// Aメロとサビのメロディを作る（サビは高めの音域）
function makeMelody(): void {
  const s = getState();
  if (!s.chordPattern) return;
  setState(s.melodyMethod === "auto" ? generateSongMelodies() : { melodyNotes: [], chorusMelodyNotes: [] });
}

function generate(): void {
  Playback.stop();
  stopMetronome();  // 設定画面が隠れるので BPM のクリック音も止める
  // 拍子はジャンルの標準（ワルツ = 3/4、6/8バラード = 3連符、ほかは 4/4）。
  // 残すメロディ・オリジナルのドラムは新しい拍子のマスに置き直す（自動生成のメロディはこのあと作り直す）
  setMeter(genreMeter(getState().genre), false);
  const s = getState();
  const result = resolveSimpleMode(s.genre, s.mood);
  setState({
    chordPattern:  result.chordPattern,
    chorusPattern: pickChorus(result.chordPattern, s.genre, s.mood),  // サビの進行（同じ長さ・スケールのもの）
    // ピアノロールで作ったオリジナルのドラムは残す（別のパターンにするときはドラムの「↻ 再抽選」）
    drumPattern:   isCustomDrum(s.drumPattern) ? s.drumPattern : result.drumPattern,
    melodyVersion: 0,
    generated:     true,
    songId:        null,  // 新しい曲としてミュージックリストに保存する
    arrangePreset: "standard",  // シンプルモードでは構成を選ばないので、標準の構成にする
    arrangeEdits:  [],    // カスタムモードで変えたアレンジも捨てる
    sections:      null,  // セクションもジャンルの標準に戻す
  });
  setState({ bars: songBars() });
  // 自分で入力したメロディ（生成前にピアノロールで入れた音・前回の曲で入れた音）は残し、自動生成のときだけ作る
  if (s.melodyMethod === "auto") makeMelody();
  console.log("シンプルモード：生成", getState());
}

// 生成し直しても残す、ピアノロールで作った内容の名前（「入力したメロディと作ったドラム」など。なければ null）
function keptContent(): string | null {
  const s = getState();
  const kept = [
    s.melodyMethod === "manual" && (s.melodyNotes.length > 0 || s.chorusMelodyNotes.length > 0) ? "入力したメロディ" : "",
    isCustomDrum(s.drumPattern) ? "作ったドラム" : "",
  ].filter(Boolean);
  return kept.length > 0 ? kept.join("と") : null;
}

// 「自分で入力」なのにメロディの音がないときは、メロディなしで生成してよいか確かめる（false = やめる）
function confirmEmptyMelody(): boolean {
  const s = getState();
  if (s.melodyMethod !== "manual") return true;
  const hasNotes = [...s.melodyNotes, ...s.chorusMelodyNotes].some(n => n.note);
  if (hasNotes) return true;
  return confirm("メロディがまだ入力されていません。\nメロディなしで生成しますか？\n\n（メロディは生成したあとピアノロールで入力できます。メロディの作り方を「自動生成」にすると自動で作ります）");
}

// メロディの音の数（「Aメロ 24音・サビ 26音」など。サビのメロディがなければ Aメロと同じものが鳴る）
function melodySummary(): string {
  const s = getState();
  const count = (notes: typeof s.melodyNotes) => notes.filter(n => n.note).length;
  const verse = count(s.melodyNotes);
  if (verse === 0 && s.chorusMelodyNotes.length === 0) return "まだ音がありません";
  return s.chorusMelodyNotes.length > 0
    ? `Aメロ ${verse}音・サビ ${count(s.chorusMelodyNotes)}音`
    : `${verse}音。サビも同じメロディ`;
}

// 再生中に曲の内容が変わったら先頭から再生し直す
export async function restartIfPlaying(): Promise<void> {
  if (Playback.isPlaying()) await startPlayback();
}

// 選んでいるジャンル・雰囲気で短いサンプル曲を組んで鳴らす（曲の内容は変えない）
async function playGenreSample(): Promise<void> {
  const s = getState();
  const { chordPattern, drumPattern } = resolveSimpleMode(s.genre, s.mood);
  const melody = () => generateMelody(chordPattern, s.key, s.genre);
  await Playback.playSample({ chordPattern, drumPattern, meter: genreMeter(s.genre), melody }, render);
  render();
}

// 曲を再生する（fromBar を渡すとその小節から。「生成された楽曲」の波形のクリック・ドラッグ）
async function startPlayback(fromBar = 0): Promise<void> {
  await Playback.play({ fromBar, onEnded: render });
  startPlayheadLoop();
  startPianoRollPlayhead();
  render();
}

// ===== 再生位置の操作（「生成された楽曲」の波形） =====

// 波形の上の位置（0〜1）→ 小節（0始まり）。小節の頭から鳴らす
function barAtRatio(ratio: number): number {
  const bars = getState().bars;
  return Math.max(0, Math.min(bars - 1, Math.floor(ratio * bars)));
}

function ratioAt(e: PointerEvent): number {
  const rect = $("s-wave-area")!.getBoundingClientRect();
  return rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
}

// クリック・ドラッグ中に、どこから鳴らすかの線と「○小節目 0:12」を出す（null で隠す）
function showSeek(bar: number | null): void {
  const seek = $("s-seek")!;
  seek.hidden = bar === null;
  if (bar === null) return;
  const bars = getState().bars;
  seek.style.left = `${(bar / bars) * 100}%`;
  $("s-seek-label")!.textContent = `${bar + 1}小節目 ${formatTime((Playback.getSongSeconds() * bar) / bars)}`;
  seek.classList.toggle("is-right", bar / bars > 0.8);  // 右端ではラベルを左に出す
}

// 今鳴っている小節（止まっていれば null）
function currentBar(): number | null {
  if (!Playback.isPlaying()) return null;
  return Math.floor(Playback.getPositionBars() + 1e-6) % Math.max(1, getState().bars);
}

function bindSeek(): void {
  const area = $("s-wave-area")!;
  let dragging = false;
  area.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    dragging = true;
    area.setPointerCapture(e.pointerId);
    showSeek(barAtRatio(ratioAt(e)));  // 文字の選択は CSS（user-select: none）で止める
  });
  area.addEventListener("pointermove", e => showSeek(barAtRatio(ratioAt(e))));
  area.addEventListener("pointerup", e => {
    if (!dragging) return;
    dragging = false;
    void startPlayback(barAtRatio(ratioAt(e)));
  });
  area.addEventListener("pointercancel", () => { dragging = false; showSeek(null); });
  area.addEventListener("pointerleave", () => { if (!dragging) showSeek(null); });
  // キーボード：← → で1小節ずつ、Home で先頭から鳴らす
  area.addEventListener("keydown", e => {
    const bars = getState().bars;
    const now  = currentBar() ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(bars - 1, now + 1);
    if (e.key === "ArrowLeft")  next = Math.max(0, now - 1);
    if (e.key === "Home")       next = 0;
    if (next === null) return;
    e.preventDefault();
    void startPlayback(next);
  });
}

// ===== 表示 =====

// 波形風の表示：小節ごとに鳴っているパート数とドラムの強さから拍ごとの高さを決める
function renderWave(): void {
  const s    = getState();
  const wave = $("s-wave");
  if (!wave || !s.chordPattern || !s.drumPattern) return;

  const perBar   = beatsPerBar();  // 拍子（カスタムモードで 3/4 にした曲を開いたとき）
  const beats    = s.bars * perBar;
  // パターンは今の拍子のマス（オリジナルは複数小節あるので、曲の拍からパターンの位置を決める）
  const drum     = drumPatternIn(s.drumPattern);
  const stepsPerBeat = unitsPerBeat();
  const energies: number[] = [];
  for (let i = 0; i < beats; i++) {
    let e = 0;
    for (const track of Object.values(drum.tracks)) {
      for (let k = 0; k < stepsPerBeat; k++) {
        const step = (i * stepsPerBeat + k) % drum.steps;
        if (track.pattern[step]) e += track.velocity?.[step] ?? 1;
      }
    }
    energies.push(e);
  }
  const maxEnergy = Math.max(...energies, 1);

  wave.innerHTML = "";
  for (let i = 0; i < beats; i++) {
    const bar   = Math.floor(i / perBar);
    const parts = LAYERS.filter(p => s.parts[p] && isArrangedAt(p, bar)).length;
    const jitter = ((i * 37) % 11) / 55;
    const h = Math.min(1, 0.2 + (parts / LAYERS.length) * (0.45 + 0.45 * energies[i] / maxEnergy) + jitter);
    const el = document.createElement("span");
    el.style.height = `${Math.round(h * 100)}%`;
    wave.appendChild(el);
  }

  const ticks = $("s-ticks");
  if (ticks) {
    const total = Playback.getSongSeconds();
    ticks.innerHTML = [0, 0.25, 0.5, 0.75, 1]
      .map(r => `<span>${formatTime(total * r)}</span>`).join("");
  }
}

function renderPlayhead(): void {
  const wave     = $("s-wave");
  const playhead = $("s-playhead");
  if (!wave || !playhead) return;

  const playing  = Playback.isPlaying();
  const total    = Playback.getSongSeconds();
  const position = playing ? Math.min(total, Playback.getPositionSeconds()) : 0;
  const progress = total > 0 ? position / total : 0;
  playhead.hidden = !playing;
  playhead.style.left = `${progress * 100}%`;
  $("s-time")!.textContent = `${formatTime(position)} / ${formatTime(total)}`;
  const area = $("s-wave-area")!;
  area.setAttribute("aria-valuemax", String(getState().bars));
  area.setAttribute("aria-valuenow", String((currentBar() ?? 0) + 1));
  area.setAttribute("aria-valuetext", `${(currentBar() ?? 0) + 1}小節目`);

  const bars = wave.children;
  for (let i = 0; i < bars.length; i++) {
    bars[i].classList.toggle("played", playing && (i + 0.5) / bars.length <= progress);
  }
}

let rafId: number | null = null;
function startPlayheadLoop(): void {
  if (rafId !== null) return;
  const tick = () => {
    renderPlayhead();
    rafId = Playback.isPlaying() ? requestAnimationFrame(tick) : null;
    if (rafId === null) render();
  };
  rafId = requestAnimationFrame(tick);
}

function render(): void {
  const s = getState();
  if (s.screen !== "simple") return;

  const presetLabel = s.tempoPreset === "custom" ? "タップ" : s.tempoPreset;
  $("s-info-bpm")!.textContent   = s.generated ? `${s.bpm}` : `${s.bpm}（${presetLabel}）`;
  $("s-info-genre")!.textContent = s.genre;
  $("s-info-mood")!.textContent  = s.mood;

  // キー・スケール（説明付き）と長さ。生成してから出す
  $("s-info-key")!.hidden  = !s.generated || !s.chordPattern;
  $("s-info-bars")!.hidden = !s.generated;
  if (s.chordPattern) {
    const keyValue = $("s-info-key-value")!;
    const keyText  = `${s.key}|${s.chordPattern.base_scale}|${s.noteNames}`;
    if (keyValue.dataset.text !== keyText) {  // 変わったときだけ作り直す（ツールチップを消さない）
      keyValue.dataset.text = keyText;
      keyValue.replaceChildren(keyScaleSpan(s.key, s.chordPattern.base_scale));
    }
  }
  $("s-info-bars-value")!.textContent = `${s.bars}小節`;
  $("s-transport")!.hidden = !s.generated;
  // 再生ボタンは設定タブでは「生成された楽曲」の上にあるので、情報バーにはピアノロールタブのときだけ出す
  $("s-bar-transport")!.hidden = s.tab === "settings";
  $$("[data-simple-play]").forEach(btn => {
    btn.textContent = Playback.isPlaying() ? "↺ 最初から" : "▷ 再生";
  });

  // 設定
  $$("[data-mood]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.mood === s.mood));
  // 雰囲気に合うジャンルだけを出す（開いた曲のジャンルが外れていても、選んでいるジャンルは出しておく）
  const moodGenres = genresForMood(s.mood);
  const genreChips = $$("[data-genre]");
  const container  = genreChips[0]?.parentElement;
  moodGenres.forEach(g => {
    const chip = Array.from(genreChips).find(el => el.dataset.genre === g);
    if (chip && container) container.appendChild(chip);  // 雰囲気ごとの並び順にする
  });
  genreChips.forEach(el => {
    const genre = el.dataset.genre!;
    el.hidden = !moodGenres.includes(genre) && genre !== s.genre;
    el.classList.toggle("is-active", genre === s.genre);
  });
  $("s-genre-hint")!.textContent = `「${s.mood}」に合うジャンル`;
  $$("[data-tempo]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.tempo === s.tempoPreset));
  $("s-tap")!.classList.toggle("is-active", s.tempoPreset === "custom");
  $("s-bpm")!.textContent = `${s.bpm} BPM`;
  const metronomeOn = isMetronomeOn();
  $("s-metronome")!.textContent = metronomeOn ? "■ メトロノームを止める" : "♪ メトロノームで速さを聴く";
  $("s-metronome")!.classList.toggle("is-active", metronomeOn);
  const sampleOn = Playback.isSamplePlaying();
  $("s-sample")!.textContent = sampleOn ? "■ サンプルを止める" : `▷ ${s.genre} のサンプルを聴く`;
  $("s-sample")!.classList.toggle("is-active", sampleOn);
  const genreDesc = $("s-genre-desc")!;
  const descText  = GENRE_DESCRIPTIONS[s.genre] ?? "";
  if (genreDesc.dataset.text !== descText) {  // 説明が変わったときだけ作り直す（ツールチップを消さない）
    genreDesc.dataset.text = descText;
    renderGenreDesc(genreDesc, descText);
  }
  $$("[data-melody-method]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.melodyMethod === s.melodyMethod));

  // ピアノロールで作った内容は生成しても残すことを知らせる
  const kept = keptContent();
  const keepHint = $("s-keep-hint")!;
  keepHint.hidden = !kept;
  keepHint.textContent = kept ? `ピアノロールで${kept}は、そのまま使います` : "";
  $("s-regenerate")!.title = kept
    ? `選び直して新しい曲にします（${kept}はそのまま）`
    : "コード進行・ドラム・メロディを選び直して、新しい曲にします";

  $("s-setup")!.hidden  = s.generated;
  $("s-result")!.hidden = !s.generated;
  if (!s.generated) return;

  // 生成結果（Aメロ・サビのどちらに何があるかを書く。差し替えは両方に効く）
  $("s-melody-desc")!.textContent = `${s.melodyMethod === "auto" ? "自動生成" : "ピアノロールで入力"}（${melodySummary()}）`;
  $("s-melody-action")!.textContent = s.melodyMethod === "auto" ? "↻ 再抽選" : "ピアノロールを開く";
  $("s-melody-action")!.title = s.melodyMethod === "auto"
    ? "Aメロ・サビのメロディを作り直します（コード進行・ドラムはそのまま）"
    : "ピアノロールのタブでメロディを編集します";
  // コード名（Am・F など）は1つずつ、何を表すかの説明（ツールチップ）を付ける
  const chorus = chorusProgression();
  const chordDesc = $("s-chord-desc")!;
  const chordText = JSON.stringify([s.chordPattern?.progression, s.chordPattern?.base_scale, chorus?.progression, s.key, s.noteNames]);
  if (chordDesc.dataset.text !== chordText) {  // 変わったときだけ作り直す（ツールチップを消さない）
    chordDesc.dataset.text = chordText;
    chordDesc.replaceChildren(...(!s.chordPattern ? []
      : chorus ? ["Aメロ：", ...chordNameSpans(s.chordPattern, s.key), " ／ サビ：", ...chordNameSpans(chorus, s.key)]
      : [...chordNameSpans(s.chordPattern, s.key), "（Aメロ・サビ共通）"]));
  }
  if (s.drumPattern) {
    $("s-drum-desc")!.textContent = s.drumPattern.id === CUSTOM_DRUM_ID
      ? `${s.drumPattern.name}（ピアノロールで作成）`
      : `#${s.drumPattern.id.replace(/\D/g, "")} ${s.drumPattern.name}`;
  }

  renderWave();
  renderPlayhead();
  // カスタムモードで始めた再生でも、表示したら再生位置を動かす
  if (Playback.isPlaying()) startPlayheadLoop();
}

// ===== イベント =====

export function initSimpleScreen(): void {
  onRender(render);

  $$("[data-mood]").forEach(el =>
    el.addEventListener("click", () => {
      const mood   = el.dataset.mood!;
      const genres = genresForMood(mood);
      const prevGenre = getState().genre;
      setState({ mood });
      // 選んでいたジャンルがこの雰囲気に合わなければ、合うジャンルの先頭に切り替える
      if (!genres.includes(prevGenre)) selectGenre(genres[0]);
      render();
      if (getState().genre !== prevGenre && Playback.isSamplePlaying()) void playGenreSample();
    }));

  $$("[data-genre]").forEach(el =>
    el.addEventListener("click", () => {
      selectGenre(el.dataset.genre!);
      render();
      // サンプルを鳴らしていれば、選び直したジャンルのサンプルに切り替える
      if (Playback.isSamplePlaying()) void playGenreSample();
    }));

  $("s-sample")?.addEventListener("click", () => {
    if (Playback.isSamplePlaying()) {
      Playback.stop();
      render();
    } else {
      void playGenreSample();
    }
  });
  // サンプルの長さはボタンの説明に出す（長さは Playback.SAMPLE_SECONDS で決まる）
  $("s-sample")!.title = `選んでいるジャンル・雰囲気・テンポで短いサンプル曲を ${Playback.SAMPLE_SECONDS} 秒鳴らします`;

  $$("[data-tempo]").forEach(el =>
    el.addEventListener("click", () => {
      const preset = el.dataset.tempo as "ゆっくり" | "普通" | "速い";
      resetTap();
      setState({ tempoPreset: preset, bpm: resolveTempoPreset(getState().genre, preset) });
      if (Playback.isSamplePlaying()) Playback.applyBpm();  // サンプルのテンポもすぐ変える
      render();
    }));

  // 今の BPM の速さをクリック音で確かめる（鳴らしたままテンポを変えるとすぐ反映される）
  $("s-metronome")?.addEventListener("click", () => {
    if (!isMetronomeOn()) Playback.stop();  // 曲の再生とは重ねない
    toggleMetronome();
  });
  onMetronomeChange(render);

  $("s-tap")?.addEventListener("click", () => {
    // tap() が AppState.bpm と tempoPreset を更新する
    if (tap() === null) setState({ tempoPreset: "custom" });
    if (Playback.isSamplePlaying()) Playback.applyBpm();
    render();
  });

  $$("[data-melody-method]").forEach(el =>
    el.addEventListener("click", () => {
      setState({ melodyMethod: el.dataset.melodyMethod as "auto" | "manual" });
      render();
    }));

  $("s-generate")?.addEventListener("click", () => {
    if (!confirmEmptyMelody()) return;
    generate();
    render();
  });

  $("s-regenerate")?.addEventListener("click", async () => {
    if (!confirmEmptyMelody()) return;
    const wasPlaying = Playback.isPlaying();
    generate();
    render();
    if (wasPlaying) await startPlayback();
  });

  $("s-edit-settings")?.addEventListener("click", () => {
    Playback.stop();
    setState({ generated: false });
    render();
  });

  // 再生・停止（「生成された楽曲」の上と、ピアノロールタブの情報バーの2か所）
  $$("[data-simple-play]").forEach(btn => btn.addEventListener("click", () => { void startPlayback(); }));
  // 生成した曲は、どのタブでもスペースキーで再生／停止する（生成前は鳴らす曲がない）
  bindSpaceToPlay(() => {
    const s = getState();
    return s.screen === "simple" && s.generated;
  }, () => startPlayback());
  $$("[data-simple-stop]").forEach(btn => btn.addEventListener("click", () => {
    Playback.stop();
    render();
  }));
  bindSeek();

  // レイヤー差し替え
  $("s-melody-action")?.addEventListener("click", async () => {
    if (getState().melodyMethod === "manual") {
      showTab("pianoroll");
      return;
    }
    setState({ melodyVersion: getState().melodyVersion + 1 });
    makeMelody();
    render();
    await restartIfPlaying();
  });

  $("s-chord-reroll")?.addEventListener("click", async () => {
    const s = getState();
    const chordPattern = rerollChord(s.genre, s.mood, s.chordPattern?.id);
    setState({ chordPattern, chorusPattern: pickChorus(chordPattern, s.genre, s.mood) });
    setState({ bars: songBars() });
    // スケールや長さが変わることがあるので、自動生成のメロディは作り直す
    if (s.melodyMethod === "auto") {
      setState({ melodyVersion: s.melodyVersion + 1 });
      makeMelody();
    }
    render();
    await restartIfPlaying();
  });

  $("s-drum-reroll")?.addEventListener("click", async () => {
    const s = getState();
    if (isCustomDrum(s.drumPattern)
        && !confirm("ピアノロールで作ったドラムを、別のドラムパターンに置き換えますか？")) return;
    setState({ drumPattern: rerollDrum(s.genre, s.mood, s.drumPattern?.id) });
    render();
    await restartIfPlaying();
  });

  // 書き出し
  $("s-export-midi")?.addEventListener("click", () => exportMidiWithName());

  (["wav", "mp3"] as const).forEach(format => {
    const btn = $(`s-export-${format}`) as HTMLButtonElement | null;
    btn?.addEventListener("click", async () => {
      await exportAudioWithProgress(format, btn);
      render();
    });
  });
}
