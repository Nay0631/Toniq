// 確かめるためのダイアログ（「＋ 新規作成」など）。confirm() と違って、説明を分けて書け、ボタンを3つ以上並べられる。
// 書き出しのダイアログと同じ見た目（.export-overlay / .export-dialog）で出す

export interface Choice {
  id:    string;
  label: string;
  kind?: "primary" | "danger";  // primary = おすすめ（色付き・最初にフォーカス）、danger = 消える操作（赤い文字）
}

export interface ChoiceOptions {
  title:        string;
  message:      string;   // 何が起きるか（太字で出す）
  detail?:      string;   // 補足（改行で段落を分ける）
  choices:      Choice[]; // 右から順に並ぶ（最後の primary にフォーカスする）
  cancelLabel?: string;
}

let dialog: HTMLElement | null = null;

function ensureDialog(): HTMLElement {
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.className = "export-overlay";
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="export-dialog card choice-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="choice-title" aria-describedby="choice-message">
      <div class="export-title" id="choice-title" data-choice-title></div>
      <p class="choice-message" id="choice-message" data-choice-message></p>
      <div class="choice-detail" data-choice-detail></div>
      <div class="filename-actions choice-actions" data-choice-actions></div>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

// ダイアログを出して、押したボタンの id を返す（キャンセル・Esc・外側のクリックは null）
export function askChoice(options: ChoiceOptions): Promise<string | null> {
  const el = ensureDialog();
  el.querySelector<HTMLElement>("[data-choice-title]")!.textContent = options.title;
  el.querySelector<HTMLElement>("[data-choice-message]")!.textContent = options.message;
  const detail = el.querySelector<HTMLElement>("[data-choice-detail]")!;
  detail.replaceChildren(...(options.detail ?? "").split("\n").filter(Boolean).map(line => {
    const p = document.createElement("p");
    p.textContent = line;
    return p;
  }));
  detail.hidden = !options.detail;

  const actions = el.querySelector<HTMLElement>("[data-choice-actions]")!;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = options.cancelLabel ?? "キャンセル";
  const buttons = options.choices.map(choice => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn${choice.kind === "primary" ? " btn-custom" : choice.kind === "danger" ? " btn-danger" : ""}`;
    btn.textContent = choice.label;
    btn.dataset.choice = choice.id;
    return btn;
  });
  actions.replaceChildren(cancel, ...buttons);
  el.hidden = false;
  const primary = [...buttons].reverse().find(btn => btn.classList.contains("btn-custom"));
  (primary ?? cancel).focus();

  return new Promise(resolve => {
    const finish = (result: string | null) => {
      el.hidden = true;
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("mousedown", onBackdrop);
      resolve(result);
    };
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn) return;
      if (btn === cancel) finish(null);
      else if (btn.dataset.choice) finish(btn.dataset.choice);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();  // 再生・元に戻すなどのショートカットを効かせない
      if (e.key === "Escape") finish(null);
    };
    const onBackdrop = (e: MouseEvent) => { if (e.target === el) finish(null); };
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    el.addEventListener("mousedown", onBackdrop);
  });
}
