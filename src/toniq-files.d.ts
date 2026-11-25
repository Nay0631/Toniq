// Electron の preload（electron/preload.ts）が用意するファイル操作。ブラウザで開いたときは undefined
export type OutputKind = "audio" | "midi" | "quality";

// 書き出したファイル（output/audio・output/midi の WAV・MP3・MIDI）の情報
export interface OutputFileInfo {
  kind:  OutputKind;
  name:  string;   // ファイル名（拡張子付き）
  path:  string;   // フルパス
  size:  number;   // バイト数
  mtime: number;   // 更新日時（ミリ秒）
}

export interface ToniqFilesApi {
  outputRoot():  Promise<string>;
  writeOutput(kind: OutputKind, name: string, data: Uint8Array): Promise<string>;
  showFile(file: string): Promise<void>;
  openOutput(kind?: OutputKind): Promise<string>;
  listOutputFiles(): Promise<OutputFileInfo[]>;
  readOutputFile(file: string): Promise<Uint8Array>;
  trashOutputFile(file: string): Promise<void>;
}

declare global {
  interface Window {
    toniqFiles?: ToniqFilesApi;
  }
}
