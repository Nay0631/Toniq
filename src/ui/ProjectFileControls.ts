import { getState, setState } from "../engine/AppState";
import { findSong, currentSongName, projectFileText, loadProjectFile, songFileName } from "../engine/SongLibrary";
import { hasOutputFolder, openOutputFolder } from "../engine/OutputFiles";
import * as Playback from "../engine/Playback";
import { onRender, render as renderAll, showScreen } from "./Router";

// 作業ファイル（今の曲の構成を保存した .toniq.json）の保存・読み込みと、出力フォルダを開くボタン。
// - 両モードの情報バーの「作業ファイル保存」[data-project-save]
// - メニュー・ミュージックリストの「作業ファイルを開く」[data-project-open]
// - ミュージックリストの「出力フォルダ」[data-output-folder]（Electron のときだけ表示）

// 開いていない曲を読み込みで上書きしてよいか確かめる
function confirmDiscard(): boolean {
  const s = getState();
  if (findSong(s.songId) || s.projectPath) return true;
  if (s.mode === "simple" && !s.generated) return true;
  return confirm("編集中の曲は保存されていません。作業ファイルを開くと失われますが、よろしいですか？");
}

async function saveProject(btn: HTMLButtonElement): Promise<void> {
  const text = projectFileText();
  const api  = window.toniqFiles;
  if (api) {
    const file = await api.saveProject(songFileName(currentSongName()), text, getState().projectPath);
    if (!file) return;  // キャンセル
    setState({ projectPath: file });
    console.log("作業ファイルを保存:", file);
  } else {
    Playback.downloadBlob(new Blob([text], { type: "application/json" }), songFileName(currentSongName()));
  }
  btn.dataset.saved = "1";
  btn.textContent = "✓ 保存しました";
  setTimeout(() => {
    delete btn.dataset.saved;
    renderButtons();
  }, 1500);
  renderButtons();
}

function openText(text: string, path: string | null): void {
  try {
    Playback.stop();
    const name = loadProjectFile(text, path);
    console.log("作業ファイルを開く:", name);
    setState({ tab: "settings" });
    showScreen(getState().mode);
    renderAll();
  } catch (e) {
    alert(`作業ファイルを開けませんでした。\n${e instanceof Error ? e.message : String(e)}`);
  }
}

async function openProject(fileInput: HTMLInputElement): Promise<void> {
  if (!confirmDiscard()) return;
  const api = window.toniqFiles;
  if (!api) {
    fileInput.click();  // ブラウザではファイルを選んでもらう
    return;
  }
  const result = await api.openProject();
  if (result) openText(result.text, result.path);
}

// 作業ファイル保存ボタンの表示（開いている作業ファイルがあれば名前を title に出す）
function renderButtons(): void {
  const path = getState().projectPath;
  document.querySelectorAll<HTMLButtonElement>("[data-project-save]").forEach(btn => {
    if (btn.dataset.saved) return;  // 「保存しました」の表示中
    btn.textContent = "⇩ 作業ファイル";
    btn.title = path
      ? `作業ファイルに保存します（${path}）`
      : "今の曲の構成を作業ファイル（.toniq.json）に保存します。メニューの「作業ファイルを開く」で続きから編集できます";
  });
}

export function initProjectFileControls(): void {
  onRender(renderButtons);

  document.querySelectorAll<HTMLButtonElement>("[data-project-save]").forEach(btn =>
    btn.addEventListener("click", () => {
      saveProject(btn).catch(e => {
        console.error("作業ファイルの保存エラー:", e);
        alert(`作業ファイルの保存に失敗しました。\n${e instanceof Error ? e.message : String(e)}`);
      });
    }));

  // ブラウザ用のファイル選択
  const fileInput = document.createElement("input");
  fileInput.type   = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) openText(await file.text(), null);
    fileInput.value = "";  // 同じファイルをもう一度選んでも change が起きるようにする
  });

  document.querySelectorAll<HTMLElement>("[data-project-open]").forEach(el =>
    el.addEventListener("click", () => { openProject(fileInput); }));

  // 出力フォルダ（Electron のときだけ）
  document.querySelectorAll<HTMLElement>("[data-output-folder]").forEach(el => {
    el.hidden = !hasOutputFolder();
    el.addEventListener("click", () => { openOutputFolder(); });
  });

  renderButtons();
}
