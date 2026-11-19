import type { OutputFileInfo, OutputKind } from "../toniq-files";
import { downloadBlob } from "./Playback";

// 曲の出力先：Electron では toniq の output フォルダ（audio / midi）に直接保存する。
// ブラウザで開いたとき（preload がない）はこれまでどおりダウンロードにする

export type { OutputKind };

export function hasOutputFolder(): boolean {
  return window.toniqFiles !== undefined;
}

const KIND_LABELS: Record<OutputKind, string> = {
  audio:    "output/audio",
  midi:     "output/midi",
  quality:  "output/quality",
};

// 書き出したファイル（WAV / MP3 / MIDI）を出力フォルダに保存する。保存したら場所を知らせ、フォルダを開くか聞く
export async function saveOutput(kind: OutputKind, blob: Blob, filename: string): Promise<void> {
  const api = window.toniqFiles;
  if (!api) {
    downloadBlob(blob, filename);
    return;
  }
  const file = await api.writeOutput(kind, filename, new Uint8Array(await blob.arrayBuffer()));
  console.log("出力フォルダに保存:", file);
  const name = file.split(/[\\/]/).pop();
  if (confirm(`「${name}」を ${KIND_LABELS[kind]} フォルダに保存しました。\n\nフォルダを開きますか？`)) {
    await api.showFile(file);
  }
}

// 出力フォルダをエクスプローラーで開く（ブラウザでは何もしない）
export async function openOutputFolder(kind?: OutputKind): Promise<void> {
  await window.toniqFiles?.openOutput(kind);
}

// ===== 書き出したファイルの一覧（ミュージックリストの「書き出したファイル」） =====

export type { OutputFileInfo };

// ファイルの種類（一覧の絞り込み・表示に使う）
export type OutputFileType = "wav" | "mp3" | "midi";

export function outputFileType(file: OutputFileInfo): OutputFileType | null {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "wav") return "wav";
  if (ext === "mp3") return "mp3";
  if (ext === "mid" || ext === "midi") return "midi";
  return null;
}

// output/audio・output/midi にある WAV・MP3・MIDI（ブラウザでは空。書き出しはダウンロードになるため）
export async function listOutputFiles(): Promise<OutputFileInfo[]> {
  return (await window.toniqFiles?.listOutputFiles()) ?? [];
}

// 書き出したファイルを画面で再生するための URL（使い終わったら URL.revokeObjectURL で放す）
export async function outputFileUrl(file: OutputFileInfo): Promise<string> {
  const api = window.toniqFiles;
  if (!api) throw new Error("出力フォルダを使えません");
  const data = await api.readOutputFile(file.path);
  const type = outputFileType(file) === "mp3" ? "audio/mpeg" : "audio/wav";
  return URL.createObjectURL(new Blob([data as BlobPart], { type }));
}

export async function showOutputFile(file: OutputFileInfo): Promise<void> {
  await window.toniqFiles?.showFile(file.path);
}

// ごみ箱へ移す（元に戻せるよう、消さずにごみ箱へ入れる）
export async function trashOutputFile(file: OutputFileInfo): Promise<void> {
  await window.toniqFiles?.trashOutputFile(file.path);
}
