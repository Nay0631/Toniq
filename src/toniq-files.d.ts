// Electron の preload（electron/preload.ts）が用意するファイル操作。ブラウザで開いたときは undefined
export type OutputKind = "projects" | "audio" | "midi";

export interface ToniqFilesApi {
  outputRoot():  Promise<string>;
  writeOutput(kind: OutputKind, name: string, data: Uint8Array): Promise<string>;
  saveProject(name: string, text: string, lastPath: string | null): Promise<string | null>;
  openProject(): Promise<{ path: string; text: string } | null>;
  showFile(file: string): Promise<void>;
  openOutput(kind?: OutputKind): Promise<string>;
}

declare global {
  interface Window {
    toniqFiles?: ToniqFilesApi;
  }
}
