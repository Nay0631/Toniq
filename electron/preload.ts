import { contextBridge, ipcRenderer } from "electron";

// 画面側（src/engine/OutputFiles.ts）から使うファイル操作。型は src/toniq-files.d.ts
contextBridge.exposeInMainWorld("toniqFiles", {
  outputRoot:  () => ipcRenderer.invoke("toniq:output-root"),
  writeOutput: (kind: string, name: string, data: Uint8Array) =>
    ipcRenderer.invoke("toniq:write-output", kind, name, data),
  showFile:    (file: string) => ipcRenderer.invoke("toniq:show-file", file),
  openOutput:  (kind?: string) => ipcRenderer.invoke("toniq:open-output", kind),
  listOutputFiles: () => ipcRenderer.invoke("toniq:list-output-files"),
  readOutputFile:  (file: string) => ipcRenderer.invoke("toniq:read-output-file", file),
  trashOutputFile: (file: string) => ipcRenderer.invoke("toniq:trash-output-file", file),
});
