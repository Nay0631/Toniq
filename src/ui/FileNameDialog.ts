import { getState } from "../engine/AppState";
import { findSong } from "../engine/SongLibrary";

// 書き出すファイルの名前を決めるダイアログ（WAV / MP3 / MIDI。シンプルモード・カスタムモード共通）。
// Electron では prompt() が使えないので自前で出す。拡張子は固定で、名前の部分だけ入力してもらう

let dialog: HTMLElement | null = null;

function ensureDialog(): HTMLElement {
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.className = "export-overlay";
  dialog.hidden = true;
  dialog.innerHTML = `
    <form class="export-dialog card filename-dialog" role="dialog" aria-modal="true" aria-labelledby="filename-title">
      <div class="export-title" id="filename-title" data-fn-title></div>
      <label class="filename-field">
        <input type="text" class="filename-input" data-fn-input spellcheck="false" autocomplete="off" />
        <span class="filename-ext" data-fn-ext></span>
      </label>
      <p class="filename-error" data-fn-error hidden></p>
      <div class="filename-actions">
        <button type="button" class="btn" data-fn-cancel>キャンセル</button>
        <button type="submit" class="btn btn-custom">書き出す</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

// ファイル名に使えない文字を置き換え、前後の空白・末尾のピリオドを取る
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "");
}

// 書き出すファイル名の初期値：ミュージックリストの曲なら曲名、未保存ならジャンル・雰囲気（カスタムモードはキー）
export function defaultExportName(): string {
  const s = getState();
  const listed = findSong(s.songId);
  if (listed) return sanitizeFileName(listed.name) || "toniq";
  return `toniq_${s.genre}_${s.mode === "custom" ? s.key : s.mood}`;
}

// ファイル名を聞く。決めたら拡張子付きの名前、キャンセルなら null
export function askFileName(title: string, ext: string, initial = defaultExportName()): Promise<string | null> {
  const el    = ensureDialog();
  const form  = el.querySelector<HTMLFormElement>("form")!;
  const input = el.querySelector<HTMLInputElement>("[data-fn-input]")!;
  const error = el.querySelector<HTMLElement>("[data-fn-error]")!;
  const cancelBtn = el.querySelector<HTMLButtonElement>("[data-fn-cancel]")!;
  el.querySelector<HTMLElement>("[data-fn-title]")!.textContent = title;
  el.querySelector<HTMLElement>("[data-fn-ext]")!.textContent = `.${ext}`;
  input.value = initial;
  error.hidden = true;
  el.hidden = false;
  input.focus();
  input.select();

  return new Promise(resolve => {
    const finish = (result: string | null) => {
      el.hidden = true;
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("mousedown", onBackdrop);
      resolve(result);
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      // 拡張子まで打った場合は重ねない
      let name = input.value.trim();
      if (name.toLowerCase().endsWith(`.${ext}`)) name = name.slice(0, -(ext.length + 1));
      name = sanitizeFileName(name);
      if (!name) {
        error.textContent = "ファイル名を入力してください";
        error.hidden = false;
        input.focus();
        return;
      }
      finish(`${name}.${ext}`);
    };
    const onCancel = () => finish(null);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();  // 再生・元に戻すなどのショートカットを効かせない
      if (e.key === "Escape") finish(null);
    };
    const onBackdrop = (e: MouseEvent) => { if (e.target === el) finish(null); };
    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
    el.addEventListener("keydown", onKey);
    el.addEventListener("mousedown", onBackdrop);
  });
}
