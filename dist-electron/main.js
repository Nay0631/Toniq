import { BrowserWindow, app } from "electron";
import path from "path";
import { fileURLToPath } from "url";
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var isDev = process.env.NODE_ENV === "development";
function createWindow() {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		title: "Toniq",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true
		}
	});
	if (isDev) {
		win.loadURL("http://localhost:5173");
		win.webContents.openDevTools();
	} else win.loadFile(path.join(__dirname, "../dist/index.html"));
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
//#endregion
export {};
