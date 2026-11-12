// Electron の preload（electron/preload.ts）が用意するファイル操作。ブラウザで開いたときは undefined
export type OutputKind = "audio" | "midi";

export interface ToniqFilesApi {
  outputRoot():  Promise<string>;
  writeOutput(kind: OutputKind, name: string, data: Uint8Array): Promise<string>;
  showFile(file: string): Promise<void>;
  openOutput(kind?: OutputKind): Promise<string>;
}

declare global {
  interface Window {
    toniqFiles?: ToniqFilesApi;
  }
}
