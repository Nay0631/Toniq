import { getState, setState, ChordRhythm, ChordInstrument, MelodyInstrument } from "../engine/AppState";
import { resolveTempoPreset } from "../engine/SimpleModeResolver";
import { generateMelody } from "../engine/MelodyGenerator";
import { setLayerEnabled, LayerName } from "../engine/LayerManager";
import { signatureLabel } from "../engine/SignaturePlayer";
import { tap } from "../engine/TapTempo";
import { exportMidi } from "../engine/MidiExporter";
import * as Playback from "../engine/Playback";
import chordDB from "../data/chord_progressions.json";
import drumDB  from "../data/drum_patterns.json";
import { ChordProgression, DrumPattern } from "../data/types";
import { onRender, showTab } from "./Router";
import { SCALE_LABELS, chordNames } from "./format";
import { initArranger, renderArranger, startArrangerPlayhead } from "./ArrangerTab";
import { startPianoRollPlayhead } from "./PianoRollTab";
import { attachKnob, attachStepper, syncControls } from "./Controls";
import { initMixer, renderMixer } from "./MixerPanel";

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BAR_OPTIONS = [8, 16, 24, 32, 48, 64];
const APP_GENRES  = ["EDM", "8bit", "ローファイ", "ゲームBGM", "テクノ", "ハウス", "アンビエント"];

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

function makeMelody(): void {
  const s = getState();
  if (!s.chordPattern) return;
  const melodyNotes = s.melodyMethod === "auto"
    ? generateMelody(s.chordPattern, s.key, s.genre)
    : [];
  setState({ melodyNotes });
}

// 自動生成したメロディがあるか（空のときはまだ作っていないので、設定を変えても勝手に作らない）
function hasAutoMelody(): boolean {
  const s = getState();
  return s.melodyMethod === "auto" && s.melodyNotes.length > 0;
}

// コード進行を変えたら、スケールや長さが変わることがあるので自動生成のメロディは作り直す
function setChordPattern(next: ChordProgression): void {
  const s = getState();
  if (next.id === s.chordPattern?.id) return;
  const regenerate = hasAutoMelody();
  setState({ chordPattern: next });
  if (regenerate) {
    setState({ melodyVersion: s.melodyVersion + 1 });
    makeMelody();
  }
}

// 再生中に曲の内容が変わったら先頭から再生し直す
async function restartIfPlaying(): Promise<void> {
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
  syncControls();
  $("c-tap")!.classList.toggle("is-active", s.tempoPreset === "custom");

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
  $select("c-key").value   = s.key;
  $select("c-scale").value = scale;
  const lock = $("c-scale-lock")!;
  lock.classList.toggle("is-on", s.scaleLock);
  lock.setAttribute("aria-checked", String(s.scaleLock));
  $("c-scale-lock-label")!.textContent = s.scaleLock ? "有効" : "無効";

  // コード進行
  $select("c-mood").value = s.mood;
  fillSelect($select("c-chord"), chordCandidates(), s.chordPattern, c => chordLabel(c, s.key));
  $select("c-rhythm").value = s.chordRhythm;
  $select("c-chord-instrument").value = s.chordInstrument;

  // ドラム
  $select("c-drum-category").value = s.drumCategory;
  fillSelect($select("c-drum"), drumCandidates(), s.drumPattern, drumLabel);

  // パッド / アルペジオ / シグネチャー
  const sigLabel = document.getElementById("c-signature-label");
  if (sigLabel) sigLabel.textContent = `（${signatureLabel(s.genre)}）`;
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
    chordText = s.chordPattern ? chordNames(s.chordPattern, s.key).replace(/ - /g, "-") : "";
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

  // ===== 基本設定 =====
  const bpmRange = $("c-bpm-range") as HTMLInputElement;
  attachKnob(bpmRange, "BPM", "lg");
  bpmRange.addEventListener("input", () => {
    setBpm(parseInt(bpmRange.value));
    render();
  });

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
    render();
    await restartIfPlaying();
  });

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

  $("c-chord-preview")?.addEventListener("click", async () => {
    await Playback.preview("chord", render);
    render();
  });

  $select("c-rhythm").addEventListener("change", async e => {
    setState({ chordRhythm: (e.target as HTMLSelectElement).value as ChordRhythm });
    render();
    await restartIfPlaying();
  });

  // コードの音色：Synth は再生開始時に作り直されるので、再生中なら再生し直す
  $select("c-chord-instrument").addEventListener("change", async e => {
    setState({ chordInstrument: (e.target as HTMLSelectElement).value as ChordInstrument });
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

  // ===== パッド / アルペジオ / シグネチャー =====
  document.querySelectorAll<HTMLElement>("[data-part-toggle]").forEach(el =>
    el.addEventListener("click", () => {
      const part = el.dataset.partToggle as LayerName;
      setLayerEnabled(part, !getState().parts[part]);
      render();
    }));

  // ===== ミキサー（パート別音量。設定タブとアレンジャータブ） =====
  initMixer(["c-mixer", "c-arr-mixer"], render);

  // ===== アレンジャー =====
  // 再生開始位置を変えたら、再生中ならその位置から再生し直す
  initArranger(async () => {
    if (Playback.isPlaying()) await startPlayback();
    else render();
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
    $(id)?.addEventListener("click", () => {
      const s = getState();
      if (s.chordPattern) exportMidi(s.chordPattern, s.melodyNotes, s.key, s.bpm);
    }));

  ["c-export-wav", "c-arr-export-wav"].forEach(id => {
    const wavBtn = $(id) as HTMLButtonElement | null;
    wavBtn?.addEventListener("click", async () => {
      const label = wavBtn.textContent;
      wavBtn.textContent = "レンダリング中…";
      wavBtn.disabled = true;
      try {
        const s = getState();
        Playback.downloadBlob(await Playback.renderWav(), `toniq_${s.genre}_${s.key}.wav`);
      } catch (e) {
        console.error("WAVエクスポートエラー:", e);
      } finally {
        wavBtn.textContent = label;
        wavBtn.disabled = false;
        render();
      }
    });
  });
}
