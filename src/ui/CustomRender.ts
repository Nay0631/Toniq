import { getState } from "../engine/AppState";
import { fxLabel } from "../engine/FxPlayer";
import { chorusCandidates, scalesForGenre } from "../engine/SimpleModeResolver";
import { chorusProgression } from "../engine/SongForm";
import type { LayerName } from "../engine/LayerManager";
import { signatureLabel } from "../engine/SignaturePlayer";
import { percLabel } from "../engine/PercPlayer";
import { bassSubStandard } from "../engine/BassPlayer";
import { isMetronomeOn } from "../engine/Metronome";
import { isScalePreviewOn, scalePreviewChord, scalePreviewNotes, scalePreviewStep } from "../engine/ScalePreview";
import * as Playback from "../engine/Playback";
import { CUSTOM_DRUM_ID, ChordProgression, DrumPattern } from "../data/types";
import { SCALE_LABELS, chordNames, displayNote, toDoremi } from "./format";
import { renderArranger } from "./ArrangerTab";
import { renderMixer } from "./MixerPanel";
import { syncControls } from "./Controls";
import { renderCustomMore, EXTRA_PARTS } from "./CustomMore";
import type { TestFeature } from "./Preferences";
import {
  growCategoryName, growPresetChoices, growPresetIds, growPresetNames, isGrowLoaded, standardGrowPreset,
} from "../engine/Grow";
import { BAR_OPTIONS, GROOVE, chordCandidates, drumCandidates, playFromBar } from "./CustomState";
import { METER_LABELS, currentMeter } from "../engine/Meter";

// カスタムモード画面の表示（設定タブ・情報バー。アレンジャー・ミキサーはそれぞれのモジュールを呼ぶ）。
// 状態の更新は CustomState.ts、イベントの登録は CustomScreen.ts

const $ = (id: string) => document.getElementById(id);
const $select = (id: string) => document.getElementById(id) as HTMLSelectElement;

// コードの音色のセレクト（grow のプリセット。空 = ジャンルに合わせる）。
// 選択肢はコードのパートで選べるカテゴリ（Grow.ts の PART_CATEGORIES）のプリセットを、カテゴリの見出しごとに並べる。
// grow の音作りのパネルでほかのカテゴリのプリセットを選んでいたら、その音も「その他」に足す
function renderChordInstrument(): void {
  const s = getState();
  const select = $select("c-chord-instrument");
  const ids = growPresetIds(), names = growPresetNames();
  const loaded = isGrowLoaded();
  const label = (id: string) => (loaded ? names[ids.indexOf(id)] : undefined) ?? id;
  const option = (id: string) => `<option value="${id}" data-term="sound.${id}">${label(id)}</option>`;
  const standard = loaded ? label(ids[standardGrowPreset("chord")]) : "";
  const groups = loaded ? growPresetChoices("chord") : [];
  const listed = groups.flatMap(g => g.presets.map(i => ids[i]));
  const others = s.growChordPreset && !listed.includes(s.growChordPreset) ? [s.growChordPreset] : [];
  const html = `<option value="" data-term="sound.auto">ジャンルに合わせる${standard ? `（${standard}）` : ""}</option>`
    + groups.map(g => `<optgroup label="${growCategoryName(g.category)}">${g.presets.map(i => option(ids[i])).join("")}</optgroup>`).join("")
    + (others.length ? `<optgroup label="その他">${others.map(option).join("")}</optgroup>` : "");
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = s.growChordPreset ?? "";
}

// 追加パートの表示名（設定タブではまとめて ON/OFF するだけ。並びは CustomMore.ts の EXTRA_PARTS）
const EXTRA_PART_LABELS: Partial<Record<LayerName, string>> = {
  pad: "パッド", arp: "アルペジオ", signature: "シグネチャー", counter: "カウンターメロディ", perc: "パーカッション",
};

export function chordLabel(c: ChordProgression, key: string): string {
  try {
    return `${chordNames(c, key).replace(/ - /g, "-")}（${c.name}）`;
  } catch (e) {
    // DB に未定義のディグリーがあっても一覧全体は表示できるようにする
    console.warn(`コード名の解決に失敗: ${c.id}`, e);
    return c.name;
  }
}

function drumLabel(d: DrumPattern): string {
  if (d.id === CUSTOM_DRUM_ID) return `${d.name}（ピアノロールで作成）`;
  return `#${d.id.replace(/\D/g, "")} ${d.name}`;
}

// select の選択肢を作り直す。選択中のものが候補になければ先頭に足して表示する
function fillSelect<T extends { id: string }>(
  select: HTMLSelectElement, items: T[], current: T | null, label: (item: T) => string
): void {
  const list = current && !items.some(i => i.id === current.id) ? [current, ...items] : items;
  select.innerHTML = "";
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = label(item);
    select.appendChild(opt);
  }
  if (current) select.value = current.id;
}

export function render(): void {
  const s = getState();
  if (s.screen !== "custom") return;

  const playing = Playback.isPlaying();
  const scale   = s.chordPattern?.base_scale ?? "";

  // 情報バー
  $("c-info-bpm")!.textContent  = `${s.bpm}`;
  $("c-info-key")!.textContent  = `${s.key}${SCALE_LABELS[scale] ?? ""}`;
  $("c-info-bars")!.textContent = `${s.bars}`;
  const fromBar = playFromBar();
  $("c-stop")!.hidden = !playing;  // 停止ボタンは鳴っている間だけ出す
  $("c-play")!.textContent = fromBar > 0
    ? `${playing ? "↺" : "▷"} ${fromBar + 1}小節目から`
    : playing ? "↺ 最初から" : "▷ 再生";

  // 基本設定
  const bpmRange = $("c-bpm-range") as HTMLInputElement;
  if (document.activeElement !== bpmRange) bpmRange.value = String(s.bpm);
  $("c-bpm-value")!.textContent = `${s.bpm}`;

  // グルーヴ（null = ジャンルの標準の量を表示し、「標準」ボタンを押した状態にする）
  for (const g of GROOVE) {
    const input = $(g.id) as HTMLInputElement;
    const value = g.amount();
    if (document.activeElement !== input) input.value = String(value);
    $(`${g.id}-value`)!.textContent = `${value}`;
    $(`${g.id}-auto`)!.classList.toggle("is-active", s[g.key] === null);
  }
  $select("c-swing-unit").value = s.swingUnit;
  $select("c-meter").value = currentMeter();
  $("c-info-meter")!.textContent = METER_LABELS[currentMeter()];
  syncControls();
  $("c-tap")!.classList.toggle("is-active", s.tempoPreset === "custom");
  const metronomeOn = isMetronomeOn();
  $("c-metronome")!.textContent = metronomeOn ? "■ 停止" : "♪ メトロノーム";
  $("c-metronome")!.classList.toggle("is-active", metronomeOn);

  // 小節数：選択肢にない値（シンプルモードから引き継いだ値など）も表示できるようにする
  const barsSelect = $select("c-bars");
  const barOptions = [...new Set([...BAR_OPTIONS, s.bars])].sort((a, b) => a - b);
  if (barsSelect.options.length !== barOptions.length) {
    barsSelect.innerHTML = barOptions.map(b => `<option value="${b}">${b}小節</option>`).join("");
  }
  barsSelect.value = String(s.bars);

  $select("c-genre").value = s.genre;

  // スケール・キー
  // ルート音は単音なので、ドレミ表記なら読みを添える（値・キー名は CDE 表記のまま）
  Array.from($select("c-key").options).forEach(o => {
    o.textContent = s.noteNames === "doremi" ? `${o.value}（${toDoremi(o.value)}）` : o.value;
  });
  $select("c-key").value   = s.key;
  // ジャンルに合うスケール（genre_scales.json）には「おすすめ」を付ける（ほかのスケールも選べる）
  const recommended = scalesForGenre(s.genre) ?? [];
  for (const option of Array.from($select("c-scale").options)) {
    const label = SCALE_LABELS[option.value] ?? option.value;
    const text  = recommended.includes(option.value) ? `${label}（おすすめ）` : label;
    if (option.textContent !== text) option.textContent = text;
  }
  $select("c-scale").value = scale;
  const lock = $("c-scale-lock")!;
  lock.classList.toggle("is-on", s.scaleLock);
  lock.setAttribute("aria-checked", String(s.scaleLock));
  $("c-scale-lock-label")!.textContent = s.scaleLock ? "有効" : "無効";

  // スケールの音（試聴中は鳴っている音を光らせる。最後の和音では和音の音と、1オクターブ上の主音を光らせる）
  const notes = scalePreviewNotes(s.key, scale);
  const step  = scalePreviewStep();
  const chordStep = step === notes.length;
  const chord     = scalePreviewChord(s.key, scale);
  const last      = notes.length - 1;  // 1オクターブ上の主音
  $("c-scale-notes")!.innerHTML = notes.map((n, i) => {
    const lit = chordStep ? (i === last || chord.includes(n.midi)) : i === step;
    return `<span class="scale-note${i === 0 || i === last ? " is-root" : ""}${lit ? " is-lit" : ""}">${displayNote(n.name.replace(/-?\d+$/, ""))}</span>`;
  }).join("");
  const scaleOn = isScalePreviewOn();
  $("c-scale-preview")!.textContent = scaleOn ? "■ 停止" : "▷ 試聴";
  $("c-scale-preview")!.classList.toggle("is-active", scaleOn);

  // コード進行
  $select("c-mood").value = s.mood;
  fillSelect($select("c-chord"), chordCandidates(), s.chordPattern, c => chordLabel(c, s.key));
  renderChorusSelect();
  $select("c-rhythm").value = s.chordRhythm;
  // 転調（しないときは範囲を選べなくする。サビがない曲では鳴らしても変わらない）
  $select("c-modulation").value = String(s.modulation);
  $select("c-modulation-scope").value = s.modulationScope;
  $select("c-modulation-scope").disabled = s.modulation === 0;
  renderChordInstrument();

  // ドラム
  $select("c-drum-category").value = s.drumCategory;

  // FX / SE（「ジャンルの標準」には今のジャンルで鳴る種類を添える）
  const fxSelect = $select("c-fx-type");
  fxSelect.options[0].textContent = s.fxType === "auto" ? `ジャンルの標準（${fxLabel()}）` : "ジャンルの標準";
  fxSelect.value = s.fxType;
  fillSelect($select("c-drum"), drumCandidates(), s.drumPattern, drumLabel);

  // ドラムの演奏（テスト中の機能：フィル・揺らぎ・エンディング）
  document.querySelectorAll<HTMLElement>("[data-test-toggle]").forEach(el => {
    const on = s[el.dataset.testToggle as TestFeature];
    el.classList.toggle("is-on", on);
    el.textContent = on ? "ON" : "OFF";
    el.setAttribute("aria-pressed", String(on));
  });

  // 追加パート：まとめて ON/OFF する入り口と、今 ON のパートの一覧（表示だけ。1つずつの切り替えはアレンジャー・ミキサー）
  const onCount = EXTRA_PARTS.filter(p => s.parts[p]).length;
  const extra = $("c-extra-parts")!;
  extra.classList.toggle("is-on", onCount > 0);
  extra.textContent = onCount === EXTRA_PARTS.length ? "ON" : onCount === 0 ? "OFF" : "一部";
  extra.setAttribute("aria-pressed", onCount === EXTRA_PARTS.length ? "true" : onCount === 0 ? "false" : "mixed");
  extra.title = onCount === EXTRA_PARTS.length ? "追加パートをすべて止める" : "追加パートをすべて鳴らす";
  const partNotes: Partial<Record<LayerName, string>> = { signature: signatureLabel(s.genre), perc: percLabel(s.genre) };
  $("c-extra-parts-list")!.innerHTML = EXTRA_PARTS.map(p => {
    const note = partNotes[p] ? `<span class="pill-note">（${partNotes[p]}）</span>` : "";
    return `<span class="extra-part${s.parts[p] ? "" : " is-off"}" data-part="${p}"><span data-term="${p}">${EXTRA_PART_LABELS[p]}</span>${note}</span>`;
  }).join("");

  // サブベース
  const subSelect = $select("c-bass-sub");
  subSelect.options[0].textContent = `ジャンルに合わせる（${bassSubStandard(s.genre) ? "ON" : "OFF"}）`;
  subSelect.value = s.bassSub === null ? "auto" : s.bassSub ? "on" : "off";

  renderMixer();
  renderCustomMore();

  // アレンジャー
  renderArranger();
}

// サビの進行：「なし」（Aメロと同じ進行）と、今の進行と同じ長さ・スケールの進行
function renderChorusSelect(): void {
  const s = getState();
  const select = $select("c-chorus");
  const candidates = s.chordPattern ? chorusCandidates(s.chordPattern, s.genre, s.mood) : [];
  select.innerHTML = `<option value="">なし（Aメロと同じ進行）</option>${candidates
    .map(c => `<option value="${c.id}">${chordLabel(c, s.key)}</option>`).join("")}`;
  select.value = chorusProgression()?.id ?? "";
  // 候補がなければ ◀ ▶ を押せなくする（attachStepper が select の直後に置く）
  select.parentElement?.querySelectorAll<HTMLButtonElement>(".stepper-btn")
    .forEach(b => { b.disabled = candidates.length === 0; });
}

// スケールに合わせてコード進行を変えたことを、スケールの下に少しの間だけ出し、進行の欄を光らせる
// （出している間かどうかは表示上の一時的な状態としてここに持つ）
const NOTICE_MS = 4000;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function notifyChordChange(next: ChordProgression): void {
  const notice = $("c-scale-notice")!;
  notice.textContent = `スケールに合わせてコード進行を「${chordLabel(next, getState().key)}」に変えました`;
  notice.hidden = false;
  const row = $select("c-chord").closest(".form-row");
  row?.classList.remove("is-flash");
  void (row as HTMLElement | null)?.offsetWidth;  // 続けて変えたときもアニメーションをやり直す
  row?.classList.add("is-flash");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
    row?.classList.remove("is-flash");
  }, NOTICE_MS);
}
