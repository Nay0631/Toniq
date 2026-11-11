import type { OutputKind } from "../toniq-files";
import { downloadBlob } from "./Playback";

// 曲の出力先：Electron では toniq の output フォルダ（projects / audio / midi）に直接保存する。
// ブラウザで開いたとき（preload がない）はこれまでどおりダウンロードにする

export type { OutputKind };

export function hasOutputFolder(): boolean {
  return window.toniqFiles !== undefined;
}

const KIND_LABELS: Record<OutputKind, string> = {
  projects: "output/projects",
  audio:    "output/audio",
  midi:     "output/midi",
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
