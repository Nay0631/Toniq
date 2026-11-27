import { getState } from "../engine/AppState";
import * as Playback from "../engine/Playback";
import type { AudioFormat, RenderStage } from "../engine/Playback";
import { formatTime } from "./format";
import { saveOutput } from "../engine/OutputFiles";
import { exportMidi } from "../engine/MidiExporter";
import { renameSong } from "../engine/SongLibrary";
import { askExportFile } from "./FileNameDialog";
import { hasUnsavedSong, isListedSong, saveToList } from "./SongSave";
import { render as renderAll } from "./Router";

// 音声の書き出し（WAV / MP3）の進み具合のダイアログ（シンプルモード・カスタムモード・ミュージックリスト共通）。
// 書き出しは曲の長さに応じて数秒〜数十秒かかるので、始めに目安を伝え、段階と進み具合・経過時間を出す。
// 「中断する」（Esc でも）でやめられる

type ExportFormat = AudioFormat | "mid";
const FORMAT_NAMES: Record<ExportFormat, string> = { wav: "WAV", mp3: "MP3", mid: "MIDI" };

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
      <div class="filename-actions">
        <button type="button" class="btn" data-export-cancel>中断する</button>
      </div>
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
         "終わると自動で保存されます（書き出している間は再生できません）。やめるときは「中断する」を押してください。";
}

// 書き出す前の注意書き：書き出したファイルは Toniq で編集し直せないので、続きを編集したいならミュージックリストに保存するよう伝える
function beforeExportNote(format: ExportFormat, unsaved: boolean): string {
  const name = FORMAT_NAMES[format];
  const lines = [
    format === "mid"
      ? "書き出した MIDI ファイルは、DAW などほかの作曲ソフトでは編集できますが、Toniq に読み込んで編集し直すことはできません。"
      : `書き出した ${name} ファイルは音声なので、Toniq に読み込んで編集し直すことはできません。`,
    unsaved
      ? "あとで続きを編集したいときは、下の「ミュージックリストにも保存する」を入れたまま書き出してください。"
      : "この曲はミュージックリストに保存してあるので、続きはミュージックリストの「編集」から編集できます。",
  ];
  return lines.join("\n");
}

// ファイル名を聞き、チェックが入っていればミュージックリストにも保存する。決めたら拡張子付きの名前、キャンセルなら null
async function prepareExport(format: ExportFormat): Promise<string | null> {
  const unsaved = hasUnsavedSong();
  const choice = await askExportFile(`${FORMAT_NAMES[format]} で書き出す`, format, {
    note:       beforeExportNote(format, unsaved),
    saveOption: unsaved,
  });
  if (!choice) return null;
  if (choice.saveToList) {
    const wasListed = isListedSong();
    if (!saveToList()) return null;  // 保存できなかった（知らせ済み）。書き出しもやめて整理してもらう
    // 初めて保存した曲は、書き出すファイルと同じ名前にする（リストで見分けやすいように）
    const id = getState().songId;
    if (!wasListed && id) {
      try { renameSong(id, choice.filename.replace(/\.[^.]+$/, "")); } catch { /* 名前は自動のままでよい */ }
    }
    renderAll();  // 「♪ 保存」ボタンを「上書き保存」にする
  }
  return choice.filename;
}

// 書き出せなかったことを知らせる
function notifyExportError(format: ExportFormat, e: unknown): void {
  console.error(`${FORMAT_NAMES[format]}エクスポートエラー:`, e);
  alert(`${FORMAT_NAMES[format]} の書き出しに失敗しました。\n${e instanceof Error ? e.message : String(e)}`);
}

// 曲を MIDI で書き出す。始めにファイル名を聞く。書き出したら true（キャンセル・失敗は false）
export async function exportMidiWithName(): Promise<boolean> {
  const filename = await prepareExport("mid");
  if (!filename) return false;
  try {
    await exportMidi(filename);
    return true;
  } catch (e) {
    notifyExportError("mid", e);
    return false;
  }
}

// 曲を WAV / MP3 で書き出して保存する。始めにファイル名を聞く。button は書き出し中に押せなくする。
// 書き出したら true（キャンセル・中断・失敗は false）
export async function exportAudioWithProgress(
  format: AudioFormat, button?: HTMLButtonElement | null,
): Promise<boolean> {
  const filename = await prepareExport(format);
  if (!filename) return false;  // キャンセル
  const el = ensureDialog();
  const cancelBtn = q("[data-export-cancel]") as HTMLButtonElement;
  q("[data-export-title]").textContent = `${FORMAT_NAMES[format]} を書き出しています`;
  q("[data-export-note]").textContent = noteText(format);
  cancelBtn.disabled = false;
  cancelBtn.textContent = "中断する";
  el.hidden = false;
  cancelBtn.focus();
  if (button) button.disabled = true;

  // 中断：書き出しを止めて、何も保存しない
  const controller = new AbortController();
  const cancel = () => {
    if (controller.signal.aborted) return;
    cancelBtn.disabled = true;
    cancelBtn.textContent = "中断しています…";
    controller.abort();
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();  // 再生・元に戻すなどのショートカットを効かせない
    if (e.key === "Escape") cancel();
  };
  cancelBtn.addEventListener("click", cancel);
  el.addEventListener("keydown", onKey);

  const started = performance.now();
  let overall = 0;
  const update = (stage: RenderStage, progress: number) => {
    if (controller.signal.aborted) return;
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
    const blob = await Playback.renderAudio(format, update, controller.signal);
    if (controller.signal.aborted) return false;  // 変換の最後で中断した
    el.hidden = true;  // 保存先の確認を出す前にダイアログを閉じる
    await saveOutput("audio", blob, filename);
    return true;
  } catch (e) {
    if (e instanceof Playback.RenderCancelled) {
      console.log(`${FORMAT_NAMES[format]} の書き出しを中断しました`);
      return false;
    }
    notifyExportError(format, e);
    return false;
  } finally {
    clearInterval(timer);
    cancelBtn.removeEventListener("click", cancel);
    el.removeEventListener("keydown", onKey);
    el.hidden = true;
    if (button) button.disabled = false;
  }
}
