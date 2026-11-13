import { getState, setState, ChordRhythm, MelodyInstrument, FxType, ModulationScope, SwingUnit } from "../engine/AppState";
import { applySwing } from "../engine/Groove";
import { resolveTempoPreset } from "../engine/SimpleModeResolver";
import { setLayerEnabled } from "../engine/LayerManager";
import { tap } from "../engine/TapTempo";
import { isMetronomeOn, onMetronomeChange, stopMetronome, toggleMetronome } from "../engine/Metronome";
import { isScalePreviewOn, onScalePreviewChange, playScalePreview, stopScalePreview } from "../engine/ScalePreview";
import * as Playback from "../engine/Playback";
import { onRender, render as renderAll, showTab } from "./Router";
import { SCALE_LABELS } from "./format";
import { initArranger, startArrangerPlayhead } from "./ArrangerTab";
import { initMixer } from "./MixerPanel";
import { startPianoRollPlayhead } from "./PianoRollTab";
import { attachKnob, attachStepper } from "./Controls";
import { exportAudioWithProgress, exportMidiWithName } from "./ExportProgress";
import type { AudioFormat } from "../engine/Playback";
import { initGrowPanel } from "./GrowPanel";
import { initCustomMore, EXTRA_PARTS } from "./CustomMore";
import { setTestFeature, type TestFeature } from "./Preferences";
import { setGrowSound } from "../engine/Grow";
import { isCustomDrum } from "../engine/DrumEngine";
import { bindSpaceToPlay } from "./SpaceKey";
import {
  KEYS, SCALES, DRUM_CATEGORIES, chords, drums, makeMelody, hasAutoMelody, setChordPattern, setChorusPattern,
  GROOVE, setGroove, playFromBar, setBpm, chordCandidates, drumCandidates,
} from "./CustomState";
import { render, notifyChordChange } from "./CustomRender";

// カスタムモード画面のイベントの登録と再生の操作。表示は CustomRender.ts、状態の更新は CustomState.ts

const $ = (id: string) => document.getElementById(id);
const $select = (id: string) => document.getElementById(id) as HTMLSelectElement;

// 再生中に曲の内容が変わったら先頭から再生し直す
export async function restartIfPlaying(): Promise<void> {
  if (Playback.isPlaying()) await startPlayback();
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
    .map(sc => `<option value="${sc}" data-term="scale.${sc}">${SCALE_LABELS[sc] ?? sc}</option>`).join("");
  $select("c-drum-category").innerHTML = DRUM_CATEGORIES
    .map(g => `<option value="${g}">${g}</option>`).join("");

  // コード進行・ドラムパターンは ◀ ▶ で順に聴き比べられるようにする
  attachStepper($select("c-chord"), "コード進行");
  attachStepper($select("c-drum"),  "ドラムパターン");
  attachStepper($select("c-chorus"), "サビの進行");

  // 情報バー
  $("c-play")?.addEventListener("click", startPlayback);
  $("c-stop")?.addEventListener("click", () => {
    Playback.stop();
    render();
  });

  // アレンジャー・ピアノロールのタブではスペースキーで再生／停止する（アレンジャーは開始位置から、ピアノロールは先頭から）
  bindSpaceToPlay(() => {
    const s = getState();
    return s.screen === "custom" && (s.tab === "arranger" || s.tab === "pianoroll");
  }, startPlayback);

  // ===== 基本設定 =====
  const bpmRange = $("c-bpm-range") as HTMLInputElement;
  attachKnob(bpmRange, "BPM", "lg");
  bpmRange.addEventListener("input", () => {
    setBpm(parseInt(bpmRange.value, 10));
    render();
  });

  // グルーヴ：ノブで量を決める（再生中もすぐ反映される）。「標準」でジャンルの標準の量（null）に戻す
  for (const g of GROOVE) {
    const input = $(g.id) as HTMLInputElement;
    attachKnob(input, g.label);
    input.addEventListener("input", () => {
      setGroove(g.key, parseInt(input.value, 10));
      render();
    });
    $(`${g.id}-auto`)?.addEventListener("click", () => {
      setGroove(g.key, null);
      render();
    });
  }

  // 跳ねる単位（16分／8分のシャッフル）。Transport に当て直すだけなので再生中もすぐ反映される
  $select("c-swing-unit").addEventListener("change", e => {
    setState({ swingUnit: (e.target as HTMLSelectElement).value as SwingUnit });
    applySwing();
    render();
  });

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
    setState({ bars: parseInt((e.target as HTMLSelectElement).value, 10) });
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

  // 「もっと調整」の欄（grow の欄は initGrowPanel が作るのでそのあと）。標準に戻したら描画し、要るなら再生し直す
  initCustomMore(async restart => {
    renderAll();
    if (restart) await restartIfPlaying();
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
    replayScalePreview();
    render();
    await restartIfPlaying();
  });

  // スケール：そのスケールのコード進行に切り替える（同じ雰囲気のものを優先）。
  // スケールはコード進行から決まるので、進行が変わったことを知らせる
  $select("c-scale").addEventListener("change", async e => {
    const scale = (e.target as HTMLSelectElement).value;
    const s = getState();
    const sameScale = chords.filter(c => c.base_scale === scale);
    const next = sameScale.find(c => c.mood.includes(s.mood)) ?? sameScale[0];
    if (next) setChordPattern(next);
    replayScalePreview();
    render();
    if (next && next.id !== s.chordPattern?.id) notifyChordChange(next);
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

  $("c-chord-preview")?.addEventListener("click", async () => {
    await Playback.preview("chord", render);
    render();
  });

  $select("c-rhythm").addEventListener("change", async e => {
    setState({ chordRhythm: (e.target as HTMLSelectElement).value as ChordRhythm });
    render();
    await restartIfPlaying();
  });

  // 転調：曲全体の並びを読み込み時に作るので、再生中なら再生し直す
  $select("c-modulation").addEventListener("change", async e => {
    setState({ modulation: Number((e.target as HTMLSelectElement).value) || 0 });
    render();
    await restartIfPlaying();
  });
  $select("c-modulation-scope").addEventListener("change", async e => {
    setState({ modulationScope: (e.target as HTMLSelectElement).value as ModulationScope });
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
    // ピアノロールで作ったオリジナルのパターンは、絞り込みを変えても置き換えない
    if (candidates.length > 0 && !isCustomDrum(current) && !candidates.some(d => d.id === current?.id)) {
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

  // ===== ドラムの演奏（テスト中の機能。端末ごとに保存） =====
  // フィル・揺らぎはドラムが1音ごとに AppState を読むので再生中もすぐ反映される。
  // エンディングは読み込み時に曲の並びを作るので、再生中なら再生し直す
  document.querySelectorAll<HTMLElement>("[data-test-toggle]").forEach(el =>
    el.addEventListener("click", async () => {
      const feature = el.dataset.testToggle as TestFeature;
      setTestFeature(feature, !getState()[feature]);
      render();
      if (feature === "endingEnabled") await restartIfPlaying();
    }));

  // ===== 追加パート（パッド / アルペジオ / シグネチャー / カウンターメロディ / パーカッション） =====
  // すべて ON ならすべて止め、それ以外（一部・すべて OFF）ならすべて鳴らす
  $("c-extra-parts")?.addEventListener("click", () => {
    const parts = getState().parts;
    const next = !EXTRA_PARTS.every(p => parts[p]);
    for (const p of EXTRA_PARTS) if (parts[p] !== next) setLayerEnabled(p, next);
    render();
  });
  // 1つずつの切り替えはアレンジャー（レーンの ON ボタン・ミキサー）で行う
  $("c-extra-parts-open")?.addEventListener("click", () => showTab("arranger"));

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
