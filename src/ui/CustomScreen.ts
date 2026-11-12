import { getState, setState, ChordRhythm, MelodyInstrument, FxType } from "../engine/AppState";
import { fxLabel } from "../engine/FxPlayer";
import { resolveTempoPreset, chorusCandidates, pickChorus } from "../engine/SimpleModeResolver";
import { chorusFits, chorusProgression, generateChorusMelody, generateSongMelodies } from "../engine/SongForm";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import { signatureLabel } from "../engine/SignaturePlayer";
import { percLabel } from "../engine/PercPlayer";
import { bassSubStandard } from "../engine/BassPlayer";
import { tap } from "../engine/TapTempo";
import { isMetronomeOn, onMetronomeChange, stopMetronome, toggleMetronome } from "../engine/Metronome";
import {
  isScalePreviewOn, onScalePreviewChange, playScalePreview, scalePreviewNotes, scalePreviewStep, stopScalePreview,
} from "../engine/ScalePreview";
import { applySwing, swingAmount, sidechainAmount } from "../engine/Groove";
import * as Playback from "../engine/Playback";
import chordDB from "../data/chord_progressions.json";
import drumDB  from "../data/drum_patterns.json";
import { ChordProgression, DrumPattern } from "../data/types";
import { onRender, showTab } from "./Router";
import { SCALE_LABELS, chordNames, displayNote, toDoremi } from "./format";
import { initArranger, renderArranger, startArrangerPlayhead } from "./ArrangerTab";
import { initMixer, renderMixer } from "./MixerPanel";
import { startPianoRollPlayhead } from "./PianoRollTab";
import { attachKnob, attachStepper, syncControls } from "./Controls";
import { exportAudioWithProgress, exportMidiWithName } from "./ExportProgress";
import type { AudioFormat } from "../engine/Playback";
import { initGrowPanel } from "./GrowPanel";
import {
  CHORD_PRESET_CHOICES, growPresetIds, growPresetNames, isGrowLoaded, setGrowSound, standardGrowPreset,
} from "../engine/Grow";

// コードの音色の選択肢の表示名（grow の wasm を読み込むまでの仮の名前。読み込んだらコアのプリセット名を使う）
const CHORD_PRESET_LABELS: Record<string, string> = {
  soft_pad: "ソフトパッド", wide_pad: "ワイドパッド", epiano: "エレピ", strings: "ストリングス",
  organ: "オルガン", square: "スクエア（8bit）", supersaw: "スーパーソウ",
};

// コードの音色のセレクト（grow のプリセット。空 = ジャンルに合わせる）。
// grow のパネルで選択肢にないプリセットを選んでいたら、その音も選択肢に足す
function renderChordInstrument(): void {
  const s = getState();
  const select = $select("c-chord-instrument");
  const ids = growPresetIds(), names = growPresetNames();
  const label = (id: string) => (isGrowLoaded() ? names[ids.indexOf(id)] : undefined) ?? CHORD_PRESET_LABELS[id] ?? id;
  const standard = isGrowLoaded() ? label(ids[standardGrowPreset("chord")]) : "";
  const choices = [...CHORD_PRESET_CHOICES];
  if (s.growChordPreset && !choices.includes(s.growChordPreset)) choices.push(s.growChordPreset);
  const html = `<option value="">ジャンルに合わせる${standard ? `（${standard}）` : ""}</option>`
    + choices.map(id => `<option value="${id}">${label(id)}</option>`).join("");
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = s.growChordPreset ?? "";
}

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BAR_OPTIONS = [8, 16, 24, 32, 48, 64];
const APP_GENRES  = ["EDM", "8bit", "ローファイ", "ゲームBGM", "テクノ", "ハウス", "トランス", "アンビエント"];

const chords = chordDB as unknown as ChordProgression[];
const drums  = drumDB  as unknown as DrumPattern[];

// DB にあるスケール（スケール選択肢）
const SCALES = [...new Set(chords.map(c => c.base_scale))];

// ドラムのカテゴリ：アプリのジャンルを先に、それ以外の DB のタグを後ろに並べる
const DRUM_CATEGORIES = [
  ...APP_GENRES.filter(g => drums.some(d => d.genre.includes(g))),
  ...[...new Set(drums.flatMap(d => d.genre))].filter(g => !APP_GENRES.includes(g)),
];

const $ = (id: string) => document.getElementById(id);
const $select = (id: string) => document.getElementById(id) as HTMLSelectElement;

// ===== 状態の更新 =====

// Aメロとサビのメロディを作る（サビは高めの音域）
function makeMelody(): void {
  const s = getState();
  if (!s.chordPattern) return;
  setState(s.melodyMethod === "auto" ? generateSongMelodies() : { melodyNotes: [], chorusMelodyNotes: [] });
}

// 自動生成したメロディがあるか（空のときはまだ作っていないので、設定を変えても勝手に作らない）
function hasAutoMelody(): boolean {
  const s = getState();
  return s.melodyMethod === "auto" && s.melodyNotes.length > 0;
}

// コード進行を変えたら、スケールや長さが変わることがあるので自動生成のメロディは作り直す。
// サビの進行が新しい進行と長さ・スケールが合わなくなったら、合うものを選び直す（「なし」にしていればそのまま）
function setChordPattern(next: ChordProgression): void {
  const s = getState();
  if (next.id === s.chordPattern?.id) return;
  const regenerate = hasAutoMelody();
  const chorusPattern = s.chorusPattern === null || chorusFits(s.chorusPattern, next)
    ? s.chorusPattern
    : pickChorus(next, s.genre, s.mood);
  setState({ chordPattern: next, chorusPattern });
  if (regenerate) {
    setState({ melodyVersion: s.melodyVersion + 1 });
    makeMelody();
  }
}

// サビの進行を変える。メロディがあればサビのメロディだけ作り直す（Aメロのメロディはそのまま）
function setChorusPattern(next: ChordProgression | null): void {
  setState({ chorusPattern: next });
  if (getState().melodyNotes.length > 0) setState({ chorusMelodyNotes: generateChorusMelody() });
}

// グルーヴのノブ（スウィング・サイドチェイン）
const GROOVE = [
  { key: "swing",     id: "c-swing",     label: "スウィング",     amount: swingAmount },
  { key: "sidechain", id: "c-sidechain", label: "サイドチェイン", amount: sidechainAmount },
] as const;

// グルーヴの量を変える。サイドチェインはキックのたびに AppState を読むので、スウィングだけ Transport に当て直す
function setGroove(key: "swing" | "sidechain", value: number | null): void {
  setState(key === "swing" ? { swing: value } : { sidechain: value });
  if (key === "swing") applySwing();
}

// 再生中に曲の内容が変わったら先頭から再生し直す
export async function restartIfPlaying(): Promise<void> {
  if (Playback.isPlaying()) await startPlayback();
}

// アレンジャータブでは再生開始位置から、それ以外のタブでは先頭から再生する
function playFromBar(): number {
  const s = getState();
  return s.tab === "arranger" ? Math.min(s.startBar, s.bars - 1) : 0;
}

async function startPlayback(): Promise<void> {
  await Playback.play({
    fromBar: playFromBar(),
    onLoopChange: loop => {
      const el = $("c-info-loop");
      if (el) el.textContent = `周回 ${loop}`;
    },
    onEnded: render,
  });
  startArrangerPlayhead();
  startPianoRollPlayhead();
  render();
}

// 文字の入力欄・セレクトの操作中か（キー操作を横取りしない。ノブ・フェーダーの range は除く）
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(
    "input:not([type=range]):not([type=checkbox]), select, textarea, [contenteditable]");
}

// 書き出しの進み具合などのダイアログが出ているか
function modalOpen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]'))
    .some(el => el.getClientRects().length > 0);
}

// 差し替え：今のものとは別の候補から選ぶ
function pickOther<T extends { id: string }>(items: T[], currentId: string | undefined): T | undefined {
  const others = items.filter(i => i.id !== currentId);
  return others[Math.floor(Math.random() * others.length)];
}

function setBpm(bpm: number): void {
  if (!Number.isFinite(bpm)) return;
  const clamped = Math.max(20, Math.min(240, Math.round(bpm)));
  setState({ bpm: clamped, tempoPreset: "custom" });
  if (Playback.isPlaying()) Playback.applyBpm();
}

// 選択中のカテゴリ（雰囲気）とスケールロックで絞ったコード進行
function chordCandidates(): ChordProgression[] {
  const s = getState();
  const scale = s.chordPattern?.base_scale;
  return chords.filter(c =>
    c.mood.includes(s.mood) && (!s.scaleLock || c.base_scale === scale));
}

function drumCandidates(): DrumPattern[] {
  return drums.filter(d => d.genre.includes(getState().drumCategory));
}

// ===== 表示 =====

function chordLabel(c: ChordProgression, key: string): string {
  try {
    return `${chordNames(c, key).replace(/ - /g, "-")}（${c.name}）`;
  } catch (e) {
    // DB に未定義のディグリーがあっても一覧全体は表示できるようにする
    console.warn(`コード名の解決に失敗: ${c.id}`, e);
    return c.name;
  }
}

function drumLabel(d: DrumPattern): string {
  return `#${d.id.replace(/\D/g, "")} ${d.name}`;
}

// select の選択肢を作り直す。選択中のものが候補になければ先頭に足して表示する
function fillSelect<T extends { id: string }>(
  select: HTMLSelectElement, items: T[], current: T | null, label: (item: T) => string
): void {
  const list = current && !items.some(i => i.id === current.id) ? [current, ...items] : items;
  select.innerHTML = "";
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = label(item);
    select.appendChild(opt);
  }
  if (current) select.value = current.id;
}

function render(): void {
  const s = getState();
  if (s.screen !== "custom") return;

  const playing = Playback.isPlaying();
  const scale   = s.chordPattern?.base_scale ?? "";

  // 情報バー
  $("c-info-bpm")!.textContent  = `${s.bpm}`;
  $("c-info-key")!.textContent  = `${s.key}${SCALE_LABELS[scale] ?? ""}`;
  $("c-info-bars")!.textContent = `${s.bars}`;
  $("c-info-loop")!.hidden = !playing;
  const fromBar = playFromBar();
  $("c-play")!.textContent = fromBar > 0
    ? `${playing ? "↺" : "▷"} ${fromBar + 1}小節目から`
    : playing ? "↺ 最初から" : "▷ 再生";

  // 基本設定
  const bpmRange = $("c-bpm-range") as HTMLInputElement;
  if (document.activeElement !== bpmRange) bpmRange.value = String(s.bpm);
  $("c-bpm-value")!.textContent = `${s.bpm}`;

  // グルーヴ（null = ジャンルの標準の量を表示し、「標準」ボタンを押した状態にする）
  for (const g of GROOVE) {
    const input = $(g.id) as HTMLInputElement;
    const value = g.amount();
    if (document.activeElement !== input) input.value = String(value);
    $(`${g.id}-value`)!.textContent = `${value}`;
    $(`${g.id}-auto`)!.classList.toggle("is-active", s[g.key] === null);
  }
  syncControls();
  $("c-tap")!.classList.toggle("is-active", s.tempoPreset === "custom");
  const metronomeOn = isMetronomeOn();
  $("c-metronome")!.textContent = metronomeOn ? "■ 停止" : "♪ 試聴";
  $("c-metronome")!.classList.toggle("is-active", metronomeOn);

  // 小節数：選択肢にない値（シンプルモードから引き継いだ値など）も表示できるようにする
  const barsSelect = $select("c-bars");
  const barOptions = [...new Set([...BAR_OPTIONS, s.bars])].sort((a, b) => a - b);
  if (barsSelect.options.length !== barOptions.length) {
    barsSelect.innerHTML = barOptions.map(b => `<option value="${b}">${b}小節</option>`).join("");
  }
  barsSelect.value = String(s.bars);

  $select("c-genre").value      = s.genre;
  $select("c-instrument").value = s.melodyInstrument;

  // スケール・キー
  // ルート音は単音なので、ドレミ表記なら読みを添える（値・キー名は CDE 表記のまま）
  Array.from($select("c-key").options).forEach(o => {
    o.textContent = s.noteNames === "doremi" ? `${o.value}（${toDoremi(o.value)}）` : o.value;
  });
  $select("c-key").value   = s.key;
  $select("c-scale").value = scale;
  const lock = $("c-scale-lock")!;
  lock.classList.toggle("is-on", s.scaleLock);
  lock.setAttribute("aria-checked", String(s.scaleLock));
  $("c-scale-lock-label")!.textContent = s.scaleLock ? "有効" : "無効";

  // スケールの音（試聴中は鳴っている音を光らせる。最後の和音では 1・3・5番目の音を光らせる）
  const notes = scalePreviewNotes(s.key, scale);
  const step  = scalePreviewStep();
  const chordStep = step === notes.length;
  $("c-scale-notes")!.innerHTML = notes.map((n, i) => {
    const lit = chordStep ? (i === 0 || i === 2 || i === 4 || i === 7) : i === step;
    return `<span class="scale-note${i === 0 || i === 7 ? " is-root" : ""}${lit ? " is-lit" : ""}">${displayNote(n.name.replace(/-?\d+$/, ""))}</span>`;
  }).join("");
  const scaleOn = isScalePreviewOn();
  $("c-scale-preview")!.textContent = scaleOn ? "■ 停止" : "▷ 試聴";
  $("c-scale-preview")!.classList.toggle("is-active", scaleOn);

  // コード進行
  $select("c-mood").value = s.mood;
  fillSelect($select("c-chord"), chordCandidates(), s.chordPattern, c => chordLabel(c, s.key));
  renderChorusSelect();
  $select("c-rhythm").value = s.chordRhythm;
  renderChordInstrument();

  // ドラム
  $select("c-drum-category").value = s.drumCategory;

  // FX / SE（「ジャンルの標準」には今のジャンルで鳴る種類を添える）
  const fxSelect = $select("c-fx-type");
  fxSelect.options[0].textContent = s.fxType === "auto" ? `ジャンルの標準（${fxLabel()}）` : "ジャンルの標準";
  fxSelect.value = s.fxType;
  fillSelect($select("c-drum"), drumCandidates(), s.drumPattern, drumLabel);

  // 追加パート（パッド / アルペジオ / シグネチャー / カウンターメロディ / パーカッション / サブベース）
  const sigLabel = document.getElementById("c-signature-label");
  if (sigLabel) sigLabel.textContent = `（${signatureLabel(s.genre)}）`;
  const percNote = document.getElementById("c-perc-label");
  if (percNote) percNote.textContent = `（${percLabel(s.genre)}）`;
  const subSelect = $select("c-bass-sub");
  subSelect.options[0].textContent = `ジャンルに合わせる（${bassSubStandard(s.genre) ? "ON" : "OFF"}）`;
  subSelect.value = s.bassSub === null ? "auto" : s.bassSub ? "on" : "off";
  document.querySelectorAll<HTMLElement>("[data-part-toggle]").forEach(el => {
    const on = s.parts[el.dataset.partToggle as LayerName];
    el.classList.toggle("is-on", on);
    el.textContent = on ? "ON" : "OFF";
    el.setAttribute("aria-pressed", String(on));
  });

  renderMixer();

  // アレンジャー
  renderArranger();
  let chordText = "";
  try {
    const chorus = chorusProgression();
    chordText = s.chordPattern ? chordNames(s.chordPattern, s.key).replace(/ - /g, "-") : "";
    if (chorus) chordText += `／サビ ${chordNames(chorus, s.key).replace(/ - /g, "-")}`;
  } catch {
    chordText = s.chordPattern?.name ?? "";
  }
  $("c-arr-chord")!.textContent = chordText;
  $("c-arr-drum")!.textContent  = s.drumPattern ? drumLabel(s.drumPattern) : "";
  $("c-arr-melody")!.textContent = s.melodyMethod === "manual"
    ? "ピアノロールで入力"
    : s.melodyNotes.length > 0
      ? `フレーズ${String.fromCharCode(65 + (s.melodyVersion % 26))}`
      : "未作成（↻ で自動生成）";
}

// サビの進行：「なし」（Aメロと同じ進行）と、今の進行と同じ長さ・スケールの進行
function renderChorusSelect(): void {
  const s = getState();
  const select = $select("c-chorus");
  const candidates = s.chordPattern ? chorusCandidates(s.chordPattern, s.genre, s.mood) : [];
  select.innerHTML = `<option value="">なし（Aメロと同じ進行）</option>` + candidates
    .map(c => `<option value="${c.id}">${chordLabel(c, s.key)}</option>`).join("");
  select.value = chorusProgression()?.id ?? "";
  ($("c-chorus-reroll") as HTMLButtonElement).disabled = candidates.length === 0;
}

// キー・スケールの試聴中なら、今のキー・スケールで鳴らし直す
function replayScalePreview(): void {
  if (!isScalePreviewOn()) return;
  const s = getState();
  playScalePreview(s.key, s.chordPattern?.base_scale ?? "minor");
}

// ===== イベント =====

export function initCustomScreen(): void {
  onRender(render);

  // 選択肢（固定のもの）
  $select("c-key").innerHTML   = KEYS.map(k => `<option value="${k}">${k}</option>`).join("");
  $select("c-scale").innerHTML = SCALES
    .map(sc => `<option value="${sc}">${SCALE_LABELS[sc] ?? sc}</option>`).join("");
  $select("c-drum-category").innerHTML = DRUM_CATEGORIES
    .map(g => `<option value="${g}">${g}</option>`).join("");

  // コード進行・ドラムパターンは ◀ ▶ で順に聴き比べられるようにする
  attachStepper($select("c-chord"), "コード進行");
  attachStepper($select("c-drum"),  "ドラムパターン");

  // 情報バー
  $("c-play")?.addEventListener("click", startPlayback);
  $("c-stop")?.addEventListener("click", () => {
    Playback.stop();
    render();
  });

  // アレンジャータブではスペースキーで再生／停止する（再生は開始位置から）。
  // ボタンにフォーカスがあってもクリックさせないよう、キャプチャで受けて既定の動作を止める
  document.addEventListener("keydown", e => {
    const s = getState();
    if (s.screen !== "custom" || s.tab !== "arranger") return;
    if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isTyping(e.target) || modalOpen()) return;
    e.preventDefault();
    if (e.repeat) return;
    if (Playback.isPlaying()) {
      Playback.stop();
      render();
    } else {
      void startPlayback();
    }
  }, { capture: true });

  // ===== 基本設定 =====
  const bpmRange = $("c-bpm-range") as HTMLInputElement;
  attachKnob(bpmRange, "BPM", "lg");
  bpmRange.addEventListener("input", () => {
    setBpm(parseInt(bpmRange.value));
    render();
  });

  // グルーヴ：ノブで量を決める（再生中もすぐ反映される）。「標準」でジャンルの標準の量（null）に戻す
  for (const g of GROOVE) {
    const input = $(g.id) as HTMLInputElement;
    attachKnob(input, g.label);
    input.addEventListener("input", () => {
      setGroove(g.key, parseInt(input.value));
      render();
    });
    $(`${g.id}-auto`)?.addEventListener("click", () => {
      setGroove(g.key, null);
      render();
    });
  }

  // 今の BPM の速さをクリック音で確かめる（鳴らしたままノブを回すとすぐ反映される）
  $("c-metronome")?.addEventListener("click", () => {
    if (!isMetronomeOn()) {
      Playback.stop();     // 曲の再生とは重ねない
      stopScalePreview();  // キー・スケールの試聴とも重ねない
    }
    toggleMetronome();
  });
  onMetronomeChange(render);

  $("c-tap")?.addEventListener("click", () => {
    // tap() が AppState.bpm と tempoPreset を更新する
    if (tap() !== null && Playback.isPlaying()) Playback.applyBpm();
    render();
  });

  $select("c-bars").addEventListener("change", async e => {
    setState({ bars: parseInt((e.target as HTMLSelectElement).value) });
    render();
    await restartIfPlaying();
  });

  // ジャンル：テンポがプリセットならジャンルのテンポに合わせ、ドラムのカテゴリもジャンルに合わせる
  $select("c-genre").addEventListener("change", async e => {
    const genre = (e.target as HTMLSelectElement).value;
    const s = getState();
    const bpm = s.tempoPreset === "custom" ? s.bpm : resolveTempoPreset(genre, s.tempoPreset);
    const drumCategory = DRUM_CATEGORIES.includes(genre) ? genre : s.drumCategory;
    setState({ genre, bpm, drumCategory });
    render();
    // ミックスとアレンジがジャンルで変わるので再生し直す
    await restartIfPlaying();
  });


  // grow（テスト中）の音作りのパネル。値はその場で鳴っているメロディに当たるので再生し直さない
  initGrowPanel();

  // インスト：メロディの Synth は再生開始時に作り直されるので、再生中なら再生し直す
  $select("c-instrument").addEventListener("change", async e => {
    setState({ melodyInstrument: (e.target as HTMLSelectElement).value as MelodyInstrument });
    render();
    await restartIfPlaying();
  });

  // ===== スケール・キー =====
  $select("c-key").addEventListener("change", async e => {
    setState({ key: (e.target as HTMLSelectElement).value });
    // メロディは音名で持っているので、自動生成ならキーに合わせて作り直す
    if (hasAutoMelody()) makeMelody();
    replayScalePreview();
    render();
    await restartIfPlaying();
  });

  // スケール：そのスケールのコード進行に切り替える（同じカテゴリのものを優先）
  $select("c-scale").addEventListener("change", async e => {
    const scale = (e.target as HTMLSelectElement).value;
    const s = getState();
    const sameScale = chords.filter(c => c.base_scale === scale);
    const next = sameScale.find(c => c.mood.includes(s.mood)) ?? sameScale[0];
    if (next) setChordPattern(next);
    replayScalePreview();
    render();
    await restartIfPlaying();
  });

  // キー・スケールの試聴：曲の再生・BPM のクリック音とは重ねない。鳴らしたままキー・スケールを変えると鳴らし直す
  $("c-scale-preview")?.addEventListener("click", () => {
    if (isScalePreviewOn()) {
      stopScalePreview();
      return;
    }
    Playback.stop();
    stopMetronome();
    const s = getState();
    playScalePreview(s.key, s.chordPattern?.base_scale ?? "minor");
  });
  onScalePreviewChange(render);

  $("c-scale-lock")?.addEventListener("click", () => {
    setState({ scaleLock: !getState().scaleLock });
    render();
  });

  // ===== コード進行 =====
  // カテゴリ（雰囲気）：選択中の進行がカテゴリに合わなければ、候補の先頭に切り替える
  $select("c-mood").addEventListener("change", async e => {
    setState({ mood: (e.target as HTMLSelectElement).value });
    const candidates = chordCandidates();
    const current = getState().chordPattern;
    if (candidates.length > 0 && !candidates.some(c => c.id === current?.id)) {
      setChordPattern(candidates[0]);
    }
    render();
    await restartIfPlaying();
  });

  $select("c-chord").addEventListener("change", async e => {
    const next = chords.find(c => c.id === (e.target as HTMLSelectElement).value);
    if (next) setChordPattern(next);
    render();
    await restartIfPlaying();
  });

  // サビの進行（"" = なし。Aメロと同じ進行で鳴らす）
  $select("c-chorus").addEventListener("change", async e => {
    const id = (e.target as HTMLSelectElement).value;
    setChorusPattern(chords.find(c => c.id === id) ?? null);
    render();
    await restartIfPlaying();
  });

  $("c-chorus-reroll")?.addEventListener("click", async () => {
    const s = getState();
    if (!s.chordPattern) return;
    const next = pickChorus(s.chordPattern, s.genre, s.mood, chorusProgression()?.id);
    if (next) setChorusPattern(next);
    render();
    await restartIfPlaying();
  });

  $("c-chord-preview")?.addEventListener("click", async () => {
    await Playback.preview("chord", render);
    render();
  });

  $select("c-rhythm").addEventListener("change", async e => {
    setState({ chordRhythm: (e.target as HTMLSelectElement).value as ChordRhythm });
    render();
    await restartIfPlaying();
  });

  // コードの音色（grow のプリセット。選び直したら grow のパネルで変えた値は捨てる）。
  // Synth は再生開始時に作り直されるので、再生中なら再生し直す
  $select("c-chord-instrument").addEventListener("change", async e => {
    setGrowSound("chord", (e.target as HTMLSelectElement).value || null, null);
    render();
    await restartIfPlaying();
  });

  // ===== ドラム =====
  $select("c-drum-category").addEventListener("change", async e => {
    setState({ drumCategory: (e.target as HTMLSelectElement).value });
    const candidates = drumCandidates();
    const current = getState().drumPattern;
    if (candidates.length > 0 && !candidates.some(d => d.id === current?.id)) {
      setState({ drumPattern: candidates[0] });
    }
    render();
    await restartIfPlaying();
  });

  $select("c-drum").addEventListener("change", async e => {
    const next = drums.find(d => d.id === (e.target as HTMLSelectElement).value);
    if (next) setState({ drumPattern: next });
    render();
    await restartIfPlaying();
  });

  $("c-drum-preview")?.addEventListener("click", async () => {
    await Playback.preview("drum", render);
    render();
  });

  // ===== FX / SE =====
  // 種類：Synth は再生開始時に作り直されるので、再生中なら再生し直す
  $select("c-fx-type").addEventListener("change", async e => {
    setState({ fxType: (e.target as HTMLSelectElement).value as FxType });
    render();
    await restartIfPlaying();
  });

  $("c-fx-preview")?.addEventListener("click", async () => {
    await Playback.preview("fx", render);
    render();
  });

  // サブベース（音色は再生開始時に作るので、再生中なら再生し直す）
  $select("c-bass-sub").addEventListener("change", async e => {
    const value = (e.target as HTMLSelectElement).value;
    setState({ bassSub: value === "auto" ? null : value === "on" });
    render();
    await restartIfPlaying();
  });

  // ===== 追加パート（パッド / アルペジオ / シグネチャー / カウンターメロディ / パーカッション） =====
  document.querySelectorAll<HTMLElement>("[data-part-toggle]").forEach(el =>
    el.addEventListener("click", () => {
      const part = el.dataset.partToggle as LayerName;
      setLayerEnabled(part, !getState().parts[part]);
      render();
    }));

  // ===== ミキサー（パート別音量。アレンジャータブ） =====
  initMixer(["c-arr-mixer"], render);

  // ===== アレンジャー =====
  // 再生開始位置を変えたら、再生中ならその位置から再生し直す
  initArranger(async () => {
    if (Playback.isPlaying()) await startPlayback();
    else render();
  }, async () => {
    render();
    await restartIfPlaying();
  });

  $("c-arr-chord-reroll")?.addEventListener("click", async () => {
    const next = pickOther(chordCandidates(), getState().chordPattern?.id);
    if (next) setChordPattern(next);
    render();
    await restartIfPlaying();
  });

  $("c-arr-drum-reroll")?.addEventListener("click", async () => {
    const next = pickOther(drumCandidates(), getState().drumPattern?.id);
    if (next) setState({ drumPattern: next });
    render();
    await restartIfPlaying();
  });

  $("c-arr-melody-reroll")?.addEventListener("click", async () => {
    const s = getState();
    if (s.melodyMethod === "manual") {
      showTab("pianoroll");
      return;
    }
    setState({ melodyVersion: s.melodyVersion + 1 });
    makeMelody();
    render();
    await restartIfPlaying();
  });

  // ===== 書き出し（設定タブとアレンジャータブ） =====
  ["c-export-midi", "c-arr-export-midi"].forEach(id =>
    $(id)?.addEventListener("click", () => exportMidiWithName()));

  const audioButtons: [string, AudioFormat][] = [
    ["c-export-wav", "wav"], ["c-arr-export-wav", "wav"],
    ["c-export-mp3", "mp3"], ["c-arr-export-mp3", "mp3"],
  ];
  audioButtons.forEach(([id, format]) => {
    const btn = $(id) as HTMLButtonElement | null;
    btn?.addEventListener("click", async () => {
      await exportAudioWithProgress(format, btn);
      render();
    });
  });
}
