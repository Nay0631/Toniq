import { contextBridge, ipcRenderer } from "electron";

// 画面側（src/engine/OutputFiles.ts）から使うファイル操作。型は src/toniq-files.d.ts
contextBridge.exposeInMainWorld("toniqFiles", {
  outputRoot:  () => ipcRenderer.invoke("toniq:output-root"),
  writeOutput: (kind: string, name: string, data: Uint8Array) =>
    ipcRenderer.invoke("toniq:write-output", kind, name, data),
  saveProject: (name: string, text: string, lastPath: string | null) =>
    ipcRenderer.invoke("toniq:save-project", name, text, lastPath),
  openProject: () => ipcRenderer.invoke("toniq:open-project"),
  showFile:    (file: string) => ipcRenderer.invoke("toniq:show-file", file),
  openOutput:  (kind?: string) => ipcRenderer.invoke("toniq:open-output", kind),
});
