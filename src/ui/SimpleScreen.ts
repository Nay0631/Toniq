import { getState, setState } from "../engine/AppState";
import { resolveSimpleMode, resolveTempoPreset, rerollChord, rerollDrum } from "../engine/SimpleModeResolver";
import { generateMelody } from "../engine/MelodyGenerator";
import { getFullArrangementLoops, isArrangedAt, LAYERS } from "../engine/LoopArranger";
import { tap, resetTap } from "../engine/TapTempo";
import { isMetronomeOn, onMetronomeChange, stopMetronome, toggleMetronome } from "../engine/Metronome";
import { exportMidi } from "../engine/MidiExporter";
import * as Playback from "../engine/Playback";
import { onRender, showTab } from "./Router";
import { SCALE_LABELS, chordNames, formatTime } from "./format";
import { startPianoRollPlayhead } from "./PianoRollTab";
import { exportAudioWithProgress } from "./ExportProgress";

const $ = (id: string) => document.getElementById(id);

// data-mood などは他の画面で使っても混ざらないよう、シンプルモード画面の中だけを探す
const $$ = (selector: string) =>
  document.querySelectorAll<HTMLElement>(`[data-screen="simple"] ${selector}`);

// ジャンル選択の下に出す、初心者向けの一言の説明
const GENRE_DESCRIPTIONS: Record<string, string> = {
  "EDM":         "クラブやフェスで流れる、ノリのよい電子音楽。サビで盛り上がる",
  "8bit":        "昔のゲーム機のような、ピコピコした懐かしい音",
  "ローファイ":   "レコードのノイズが混ざった、ゆったりした作業用 BGM の定番",
  "ゲームBGM":   "ゲームのフィールドや街で流れるような、メロディが主役の曲",
  "テクノ":       "同じフレーズをくり返す、機械的でクールなダンス音楽",
  "ハウス":       "4つ打ちのキックとピアノが気持ちよい、明るいダンス音楽",
  "トランス":     "うねるシンセが盛り上がっていく、高揚感のある疾走系ダンス音楽",
  "アンビエント": "リズムが控えめで、空間に広がるような癒やしの音",
};

// ===== 状態の更新 =====

// 曲の長さ：アレンジが全パートそろうまでの周回分
function songBars(): number {
  const s = getState();
  return (s.chordPattern?.length_bars ?? 4) * getFullArrangementLoops(s.genre);
}

function makeMelody(): void {
  const s = getState();
  if (!s.chordPattern) return;
  const melodyNotes = s.melodyMethod === "auto"
    ? generateMelody(s.chordPattern, s.key, s.genre)
    : [];
  setState({ melodyNotes });
}

function generate(): void {
  Playback.stop();
  stopMetronome();  // 設定画面が隠れるので BPM のクリック音も止める
  const s = getState();
  const result = resolveSimpleMode(s.genre, s.mood);
  setState({
    chordPattern:  result.chordPattern,
    drumPattern:   result.drumPattern,
    melodyVersion: 0,
    generated:     true,
    songId:        null,  // 新しい曲としてミュージックリストに保存する
    arrangement:   null,  // カスタムモードで編集したアレンジは捨ててジャンルの標準に戻す
  });
  setState({ bars: songBars() });
  makeMelody();
  console.log("シンプルモード：生成", getState());
}

// 再生中に曲の内容が変わったら先頭から再生し直す
export async function restartIfPlaying(): Promise<void> {
  if (Playback.isPlaying()) await startPlayback();
}

// 選んでいるジャンル・雰囲気で短いサンプル曲を組んで鳴らす（曲の内容は変えない）
async function playGenreSample(): Promise<void> {
  const s = getState();
  const { chordPattern, drumPattern } = resolveSimpleMode(s.genre, s.mood);
  const melodyNotes = generateMelody(chordPattern, s.key, s.genre);
  await Playback.playSample({ chordPattern, drumPattern, melodyNotes }, render);
  render();
}

async function startPlayback(): Promise<void> {
  await Playback.play({ onEnded: render });
  startPlayheadLoop();
  startPianoRollPlayhead();
  render();
}

// ===== 表示 =====

// 波形風の表示：小節ごとに鳴っているパート数とドラムの強さから拍ごとの高さを決める
function renderWave(): void {
  const s    = getState();
  const wave = $("s-wave");
  if (!wave || !s.chordPattern || !s.drumPattern) return;

  const beats    = s.bars * 4;
  const drum     = s.drumPattern;
  const stepsPerBeat = drum.steps / 4;
  const energies: number[] = [];
  for (let i = 0; i < beats; i++) {
    let e = 0;
    for (const track of Object.values(drum.tracks)) {
      for (let k = 0; k < stepsPerBeat; k++) {
        const step = ((i % 4) * stepsPerBeat + k) % drum.steps;
        if (track.pattern[step]) e += track.velocity?.[step] ?? 1;
      }
    }
    energies.push(e);
  }
  const maxEnergy = Math.max(...energies, 1);

  wave.innerHTML = "";
  for (let i = 0; i < beats; i++) {
    const bar   = Math.floor(i / 4);
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
  const progress = playing ? Math.min(1, Playback.getPositionSeconds() / Playback.getSongSeconds()) : 0;
  playhead.hidden = !playing;
  playhead.style.left = `${progress * 100}%`;

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

  const songInfo = $("s-info-song")!;
  songInfo.hidden = !s.generated;
  if (s.chordPattern) {
    songInfo.textContent = `${s.key}${SCALE_LABELS[s.chordPattern.base_scale] ?? ""}・${s.bars}小節`;
  }
  $("s-transport")!.hidden = !s.generated;
  $("s-play")!.textContent = Playback.isPlaying() ? "↺ 最初から" : "▷ 再生";

  // 設定
  $$("[data-mood]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.mood === s.mood));
  $$("[data-genre]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.genre === s.genre));
  $$("[data-tempo]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.tempo === s.tempoPreset));
  $("s-tap")!.classList.toggle("is-active", s.tempoPreset === "custom");
  $("s-bpm")!.textContent = `${s.bpm} BPM`;
  const metronomeOn = isMetronomeOn();
  $("s-metronome")!.textContent = metronomeOn ? "■ クリックを止める" : "♪ クリックで試聴";
  $("s-metronome")!.classList.toggle("is-active", metronomeOn);
  const sampleOn = Playback.isSamplePlaying();
  $("s-sample")!.textContent = sampleOn ? "■ サンプルを止める" : `▷ ${s.genre} のサンプルを聴く`;
  $("s-sample")!.classList.toggle("is-active", sampleOn);
  $("s-genre-desc")!.textContent = GENRE_DESCRIPTIONS[s.genre] ?? "";
  $$("[data-melody-method]").forEach(el =>
    el.classList.toggle("is-active", el.dataset.melodyMethod === s.melodyMethod));

  $("s-setup")!.hidden  = s.generated;
  $("s-result")!.hidden = !s.generated;
  if (!s.generated) return;

  // 生成結果
  const phrase = String.fromCharCode(65 + (s.melodyVersion % 26));
  $("s-melody-desc")!.textContent = s.melodyMethod === "auto"
    ? `自動生成 フレーズ${phrase}`
    : `ピアノロールで入力（${s.melodyNotes.filter(n => n.note).length}音）`;
  $("s-melody-action")!.textContent = s.melodyMethod === "auto" ? "↻ 再生成" : "ピアノロールを開く";
  $("s-chord-desc")!.textContent = s.chordPattern ? chordNames(s.chordPattern, s.key) : "";
  if (s.drumPattern) {
    $("s-drum-desc")!.textContent = `#${s.drumPattern.id.replace(/\D/g, "")} ${s.drumPattern.name}`;
  }

  renderWave();
  renderPlayhead();
}

// ===== イベント =====

export function initSimpleScreen(): void {
  onRender(render);

  $$("[data-mood]").forEach(el =>
    el.addEventListener("click", () => {
      setState({ mood: el.dataset.mood! });
      render();
    }));

  $$("[data-genre]").forEach(el =>
    el.addEventListener("click", () => {
      const genre = el.dataset.genre!;
      const s = getState();
      const bpm = s.tempoPreset === "custom" ? s.bpm : resolveTempoPreset(genre, s.tempoPreset);
      setState({ genre, bpm });
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
    generate();
    render();
  });

  $("s-regenerate")?.addEventListener("click", async () => {
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

  $("s-play")?.addEventListener("click", startPlayback);
  $("s-stop")?.addEventListener("click", () => {
    Playback.stop();
    render();
  });

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
    setState({ chordPattern: rerollChord(s.genre, s.mood, s.chordPattern?.id) });
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
    setState({ drumPattern: rerollDrum(s.genre, s.mood, s.drumPattern?.id) });
    render();
    await restartIfPlaying();
  });

  // 書き出し
  $("s-export-midi")?.addEventListener("click", () => {
    const s = getState();
    exportMidi(`toniq_${s.genre}_${s.mood}.mid`);
  });

  (["wav", "mp3"] as const).forEach(format => {
    const btn = $(`s-export-${format}`) as HTMLButtonElement | null;
    btn?.addEventListener("click", async () => {
      const s = getState();
      await exportAudioWithProgress(format, `toniq_${s.genre}_${s.mood}.${format}`, btn);
      render();
    });
  });
}
