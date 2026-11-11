import * as Playback from "../engine/Playback";
import type { AudioFormat, RenderStage } from "../engine/Playback";
import { formatTime } from "./format";
import { saveOutput } from "../engine/OutputFiles";
import { exportMidi } from "../engine/MidiExporter";
import { askFileName } from "./FileNameDialog";

// 音声の書き出し（WAV / MP3）の進み具合のダイアログ（シンプルモード・カスタムモード共通）。
// 書き出しは曲の長さに応じて数秒〜数十秒かかるので、始めに目安を伝え、段階と進み具合・経過時間を出す

const FORMAT_NAMES: Record<AudioFormat, string> = { wav: "WAV", mp3: "MP3" };

function stageLabel(stage: RenderStage, format: AudioFormat): string {
  switch (stage) {
    case "prepare":  return "準備しています（音源・響きの用意）";
    case "schedule": return "演奏の予定を組み立てています";
    case "render":   return "音声を合成しています";
    case "encode":   return `${FORMAT_NAMES[format]} ファイルに変換しています`;
  }
}

let dialog: HTMLElement | null = null;

function ensureDialog(): HTMLElement {
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.className = "export-overlay";
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="export-dialog card" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div class="export-title" id="export-title" data-export-title></div>
      <p class="export-note" data-export-note></p>
      <div class="export-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-export-bar>
        <span data-export-fill></span>
      </div>
      <div class="export-status">
        <span data-export-stage></span>
        <span class="export-percent" data-export-percent></span>
      </div>
      <div class="export-elapsed" data-export-elapsed></div>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

const q = (sel: string) => ensureDialog().querySelector<HTMLElement>(sel)!;

// 書き出しの目安：音声の合成は再生よりずっと速いが、パートやリバーブが多いと曲の長さの数分の一ほどかかる。
// MP3 はさらに圧縮の時間がかかる
function noteText(format: AudioFormat): string {
  const length = formatTime(Playback.getSongSeconds());
  const extra  = format === "mp3" ? "MP3 は圧縮するぶん WAV より少し時間がかかります。" : "";
  return `曲の長さは ${length} です。長い曲ほど時間がかかり、数十秒ほどかかることがあります。${extra}` +
         "終わると自動で保存されるので、このままお待ちください（途中で再生はできません）。";
}

// 曲を MIDI で書き出す。始めにファイル名を聞く
export async function exportMidiWithName(): Promise<void> {
  const filename = await askFileName("MIDI のファイル名", "mid");
  if (filename) await exportMidi(filename);
}

// 曲を WAV / MP3 で書き出してダウンロードする。始めにファイル名を聞く。button は書き出し中に押せなくする
export async function exportAudioWithProgress(
  format: AudioFormat, button?: HTMLButtonElement | null,
): Promise<void> {
  const filename = await askFileName(`${FORMAT_NAMES[format]} のファイル名`, format);
  if (!filename) return;  // キャンセル
  const el = ensureDialog();
  q("[data-export-title]").textContent = `${FORMAT_NAMES[format]} を書き出しています`;
  q("[data-export-note]").textContent = noteText(format);
  el.hidden = false;
  if (button) button.disabled = true;

  const started = performance.now();
  let overall = 0;
  const update = (stage: RenderStage, progress: number) => {
    overall = Math.max(overall, Playback.overallProgress(stage, progress, format));  // 戻らないようにする
    const pct = Math.round(overall * 100);
    q("[data-export-fill]").style.width = `${pct}%`;
    q("[data-export-bar]").setAttribute("aria-valuenow", String(pct));
    q("[data-export-percent]").textContent = `${pct}%`;
    q("[data-export-stage]").textContent = stageLabel(stage, format);
  };
  const tick = () => {
    const sec = Math.floor((performance.now() - started) / 1000);
    q("[data-export-elapsed]").textContent = `経過 ${sec} 秒`;
  };
  update("prepare", 0);
  tick();
  const timer = setInterval(tick, 500);

  try {
    // ダイアログを描いてから重い処理を始める
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    const blob = await Playback.renderAudio(format, update);
    el.hidden = true;  // 保存先の確認を出す前にダイアログを閉じる
    await saveOutput("audio", blob, filename);
  } catch (e) {
    console.error(`${FORMAT_NAMES[format]}エクスポートエラー:`, e);
    alert(`${FORMAT_NAMES[format]} の書き出しに失敗しました。\n${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearInterval(timer);
    el.hidden = true;
    if (button) button.disabled = false;
  }
}
