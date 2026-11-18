import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 開発時は vite-plugin-electron（npm run dev / electron:dev）が dev server の URL を VITE_DEV_SERVER_URL で渡して起動する
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = !!devServerUrl || process.env.NODE_ENV === "development";

// ===== 出力フォルダ =====
// 開発時は toniq フォルダ（package.json の場所）、インストール版は Toniq.exe と同じ場所に output フォルダを作る。
// 書き込めない場所なら「ドキュメント/Toniq/output」を使う
type OutputKind = "audio" | "midi" | "quality";
const OUTPUT_KINDS: OutputKind[] = ["audio", "midi", "quality"];
const SONG_FILE_EXT = ".toniq.json";

let outputRoot = "";

function prepareOutputRoot(): string {
  const candidates = [
    app.isPackaged ? path.join(path.dirname(app.getPath("exe")), "output") : path.join(app.getAppPath(), "output"),
    path.join(app.getPath("documents"), "Toniq", "output"),
  ];
  for (const root of candidates) {
    try {
      OUTPUT_KINDS.forEach(kind => fs.mkdirSync(path.join(root, kind), { recursive: true }));
      fs.accessSync(root, fs.constants.W_OK);
      return root;
    } catch (e) {
      console.error("出力フォルダを作れませんでした:", root, e);
    }
  }
  return candidates[candidates.length - 1];
}

function outputDir(kind: OutputKind): string {
  const dir = path.join(outputRoot, OUTPUT_KINDS.includes(kind) ? kind : "audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ファイル名に使えない文字を置き換える
function safeName(name: string): string {
  return path.basename(name).replace(/[\\/:*?"<>|]/g, "_").trim() || "toniq";
}

// 同じ名前のファイルがあれば「名前 (2).wav」のように番号を付けて上書きしない
function uniquePath(dir: string, name: string): string {
  const ext  = name.endsWith(SONG_FILE_EXT) ? SONG_FILE_EXT : path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let file = path.join(dir, name);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n})${ext}`);
  return file;
}

function registerFileHandlers(): void {
  ipcMain.handle("toniq:output-root", () => outputRoot);

  // 曲の書き出し（WAV / MP3 / MIDI）：出力フォルダに直接保存して、保存先のパスを返す
  ipcMain.handle("toniq:write-output", (_e, kind: OutputKind, name: string, data: Uint8Array) => {
    const file = uniquePath(outputDir(kind), safeName(name));
    fs.writeFileSync(file, Buffer.from(data));
    return file;
  });

  // 保存したファイルをエクスプローラーで表示する
  ipcMain.handle("toniq:show-file", (_e, file: string) => {
    if (fs.existsSync(file)) shell.showItemInFolder(file);
  });

  // 出力フォルダを開く（kind を省略すると output フォルダそのもの）
  ipcMain.handle("toniq:open-output", (_e, kind?: OutputKind) =>
    shell.openPath(kind ? outputDir(kind) : outputRoot));
}

// ウィンドウのアイコン。ビルド後は dist/（public の中身がコピーされる）、開発時は public/ にある
function windowIcon(): string | undefined {
  return [path.join(__dirname, "../dist/icon.png"), path.join(__dirname, "../public/icon.png")]
    .find(p => fs.existsSync(p));
}

function createWindow() {
  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    minWidth:  800,
    minHeight: 600,
    title: "Toniq",
    icon: windowIcon(),
    // 最大化してから見せる（1200×800 で一瞬出てから広がるのを防ぐ）
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // 起動時は最大化で表示する（元に戻すと上の 1200×800 になる）
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  // 画面側が beforeunload で止めた（保存していない変更がある）ときは、閉じてよいか確かめる。
  // Electron は beforeunload で止めても何も出さずに閉じるのをやめるだけなので、ここでダイアログを出す
  win.webContents.on("will-prevent-unload", event => {
    const choice = dialog.showMessageBoxSync(win, {
      type:      "warning",
      title:     "Toniq",
      message:   "保存していない変更があります",
      detail:    "このまま閉じると、ミュージックリストに保存していない変更は失われます。",
      buttons:   ["保存せずに閉じる", "キャンセル"],
      defaultId: 1,
      cancelId:  1,
      noLink:    true,
    });
    if (choice === 0) event.preventDefault();  // preventDefault で beforeunload の取り消しを無視して閉じる
  });

  if (isDev) {
    // 開発時はViteのdev serverを表示
    win.loadURL(devServerUrl ?? "http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    // ビルド時はdist/index.htmlを表示
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  outputRoot = prepareOutputRoot();
  console.log("出力フォルダ:", outputRoot);
  registerFileHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
