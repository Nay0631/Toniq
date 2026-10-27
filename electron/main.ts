import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    minWidth:  800,
    minHeight: 600,
    title: "Toniq",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // 開発時はViteのdev serverを表示
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    // ビルド時はdist/index.htmlを表示
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});