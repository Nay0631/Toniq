import { getState, setState } from "../engine/AppState";

// 用語のツールチップ：data-term="…" を付けた要素にカーソルを乗せる（キーボードならフォーカスする）と、
// 初心者向けの短い説明を出す。説明は TERMS に1か所でまとめて持つ

interface Term {
  title: string;
  desc:  string;
}

export const TERMS: Record<string, Term> = {
  bpm:         { title: "BPM", desc: "1分間に刻む拍の数で、曲の速さを表します。数字が大きいほど速い曲になります（120 なら1秒に2拍）。" },
  tempo:       { title: "テンポ", desc: "曲の速さのことです。Toniq では BPM の数字で表します。" },
  tap:         { title: "タップテンポ", desc: "ボタンを曲のリズムに合わせて何回か押すと、その速さを BPM にします。" },
  meter:       { title: "拍子", desc: "1小節に何拍あるかを表します。4/4 拍子は「1・2・3・4」と4拍で1小節で、ポップスやダンス音楽のほとんどがこれです。" },
  bar:         { title: "小節", desc: "拍をいくつかまとめた区切りです。4/4 拍子なら4拍で1小節。楽譜の縦線で区切られた1マスにあたります。" },
  bars:        { title: "小節数", desc: "曲全体の長さを小節の数で表したものです。コード進行やドラムは、この長さになるまで繰り返します。" },
  genre:       { title: "ジャンル", desc: "曲のスタイルのことです。ジャンルによってテンポ・ドラム・音色・ミックスの作り方が変わります。" },
  instrument:  { title: "音色（インスト）", desc: "どんな楽器のような音で鳴らすかです。同じメロディでも音色で印象が大きく変わります。" },
  key:         { title: "キー", desc: "曲の中心になる音（ルート音）とスケールの組み合わせです。キーを変えると、曲全体が同じ形のまま高く・低くなります。" },
  root:        { title: "ルート音", desc: "キーやコードの土台になる音です。曲はこの音に戻ってくると「落ち着いた」感じがします。" },
  scale:       { title: "スケール（音階）", desc: "曲で使う音を高さの順に並べたものです。メジャーは明るく、マイナーは暗い・切ない響きになります。" },
  scaleLock:   { title: "スケールロック", desc: "今のスケールに合う音（コード進行）だけを選べるようにする機能です。外れた音にならないので安心して試せます。" },
  chord:       { title: "コード（和音）", desc: "高さの違う音をいくつか同時に鳴らしたものです。曲の明るさ・暗さなどの雰囲気を作ります。" },
  progression: { title: "コード進行", desc: "コードを鳴らす順番です。同じメロディでもコード進行が変わると曲の雰囲気が変わります。" },
  chordCategory: { title: "カテゴリ", desc: "コード進行を雰囲気（明るい・暗い など）で分けたものです。選んだ雰囲気の進行から選べます。" },
  chordRhythm: { title: "リズム（コード）", desc: "コードを鳴らす間隔です。全音符は1小節に1回、8分音符は1小節に8回刻みます。" },
  drum:        { title: "ドラム", desc: "リズムを刻むパートです。キック（低いドン）・スネア（パン）・ハイハット（チッ）などの打楽器を組み合わせます。" },
  drumPattern: { title: "ドラムパターン", desc: "1小節を16マスに分けて、どのマスでどの打楽器を鳴らすかを決めたリズムの型です。" },
  drumCategory:{ title: "カテゴリ（ドラム）", desc: "ドラムパターンをジャンルで分けたものです。ほかのジャンルのパターンを使うこともできます。" },
  bass:        { title: "ベース", desc: "低い音でコードの土台を支えるパートです。ドラムと一緒に曲のノリを作ります。" },
  melody:      { title: "メロディ", desc: "曲の主役になる旋律で、口ずさめる部分です。" },
  pad:         { title: "パッド", desc: "後ろで長く伸ばして鳴らす、やわらかい和音の音です。曲に厚みと広がりを出します。" },
  arp:         { title: "アルペジオ", desc: "和音の音を同時ではなく、1つずつ順番に鳴らす弾き方です。キラキラした動きが出ます。" },
  signature:   { title: "シグネチャー", desc: "ジャンルらしさを出す Toniq の追加パートです。EDM ならコードの刻み、ローファイならレコードのノイズなど、ジャンルごとに鳴り方が変わります。" },
  fx:          { title: "FX / SE", desc: "効果音のことです。曲の区切りの前で盛り上げたり（ライザー）、頭で「ドーン」と鳴らしたりして、場面の切り替わりを分かりやすくします。" },
  groove:      { title: "グルーヴ", desc: "曲のノリのことです。音を鳴らすタイミングや音量の揺れ方で、体が動きたくなる感じが生まれます。" },
  swing:       { title: "スウィング", desc: "細かい音の裏側（2つ目）を少し後ろへずらして、「タッタ タッタ」と跳ねたノリにします。ローファイやハウスでよく使います。0 でまっすぐなリズムです。" },
  sidechain:   { title: "サイドチェイン", desc: "キックが鳴るたびに、ベースやコードの音量を一瞬下げてすぐ戻す技です。音が「ふわっ ふわっ」と呼吸するように揺れ、EDM やハウスらしい勢いが出ます。" },
  arranger:    { title: "アレンジャー", desc: "どの小節でどのパートを鳴らすかを決める画面です。パートを出し入れすると曲に展開（盛り上がり）が生まれます。" },
  pianoroll:   { title: "ピアノロール", desc: "縦が音の高さ、横が時間のマス目です。マスに音符を置いてメロディを作ります。" },
  section:     { title: "セクション", desc: "曲の部分のことです。Aメロ（落ち着いた部分）とサビ（いちばん盛り上がる部分）で、コード進行とメロディを切り替えます。" },
  chorus:      { title: "サビ", desc: "曲でいちばん盛り上がる部分です。Aメロとは別のコード進行にすると、曲に展開が生まれます（同じ長さ・スケールの進行から選べます）。" },
  ending:      { title: "エンディング", desc: "曲の終わり方です。最後の小節を主和音（その曲の「家」のコード）でのばすと、きれいに終わった感じになります。" },
  drumFill:    { title: "フィル", desc: "区切りの直前にドラムが入れる短い「おかず」です。次の部分へ進む合図になります。" },
  humanize:    { title: "揺らぎ", desc: "人が叩いたように、ドラムの強さやタイミングをほんの少しずらすことです。機械っぽさが減ります。" },
  qualityCheck: { title: "自動チェック", desc: "作曲でよくある決まりごと（強い拍ではコードの音を使う、最後は主音で終わる など）に合っているかを調べた結果です。" },
  layer:       { title: "レイヤー", desc: "曲を作っているパート（ドラム・コード・メロディなど）のことです。重ねて1曲になります。" },
  octave:      { title: "オクターブ", desc: "「ド」から次の高い「ド」までの音の幅です。オクターブを上げると、同じ音名のまま高い音になります。" },
  noteLength:  { title: "音符の長さ", desc: "音を伸ばす長さです。4分音符が1拍、8分音符はその半分、2分音符は2拍です。" },
  midi:        { title: "MIDI", desc: "音そのものではなく「どの高さの音をいつ・どれくらい鳴らすか」の楽譜のようなデータです。ほかの作曲ソフト（DAW）で読み込んで編集できます。" },
  wav:         { title: "WAV", desc: "音声のファイルです。そのまま再生したり、動画やゲームに使ったりできます。" },
  mp3:         { title: "MP3", desc: "小さく圧縮した音声のファイルです。WAV より音質はわずかに落ちますが、スマホで聴いたり人に送ったりしやすくなります。" },
  mixer:       { title: "ミキサー", desc: "パートごとの音量を調整する場所です。目立たせたいパートを上げ、じゃまなパートを下げてバランスを整えます。ON/OFF ボタンでパートを鳴らす・鳴らさないも切り替えられます。" },
  loop:        { title: "周回", desc: "コード進行1回分を1周として、今が何周目かを表します。曲は周回を重ねながらパートが増えたり減ったりします。" },
};

const SHOW_DELAY_MS = 350;  // すぐ出すと操作のじゃまになるので少し待つ

// ON/OFF（設定画面）。端末ごとに localStorage に保存し、<html data-tooltips> で下線の表示も切り替える
const STORAGE_KEY = "toniq.tooltips";

function loadTooltips(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function applyTooltips(): void {
  const on = getState().tooltips;
  document.documentElement.dataset.tooltips = on ? "on" : "off";
  if (!on) hide();
}

export function setTooltips(on: boolean): void {
  setState({ tooltips: on });
  try { localStorage.setItem(STORAGE_KEY, on ? "on" : "off"); } catch { /* 保存できなくても切り替える */ }
  applyTooltips();
}

let tip: HTMLElement | null = null;
let current: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

function termOf(el: HTMLElement): Term | undefined {
  return TERMS[el.dataset.term ?? ""];
}

function position(el: HTMLElement): void {
  if (!tip) return;
  const rect   = el.getBoundingClientRect();
  const margin = 8;
  tip.style.left = "0px";
  tip.style.top  = "0px";
  const { width, height } = tip.getBoundingClientRect();
  const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
  // 下に出す。入りきらなければ上に出す
  const below = rect.bottom + margin;
  const top   = below + height > window.innerHeight - margin ? rect.top - height - margin : below;
  tip.style.left = `${left}px`;
  tip.style.top  = `${Math.max(margin, top)}px`;
}

function show(el: HTMLElement): void {
  const term = termOf(el);
  if (!term || !tip) return;
  current = el;
  tip.querySelector(".term-tip-title")!.textContent = term.title;
  tip.querySelector(".term-tip-desc")!.textContent  = term.desc;
  tip.hidden = false;
  position(el);
  el.setAttribute("aria-describedby", tip.id);
}

function hide(): void {
  if (showTimer !== null) clearTimeout(showTimer);
  showTimer = null;
  if (tip) tip.hidden = true;
  current?.removeAttribute("aria-describedby");
  current = null;
}

function schedule(el: HTMLElement): void {
  if (!getState().tooltips || el === current) return;
  hide();
  showTimer = setTimeout(() => show(el), SHOW_DELAY_MS);
}

const termTarget = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>("[data-term]") : null;

export function initGlossary(): void {
  setState({ tooltips: loadTooltips() });
  applyTooltips();

  tip = document.createElement("div");
  tip.id = "term-tip";
  tip.className = "term-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  tip.innerHTML = `<div class="term-tip-title"></div><div class="term-tip-desc"></div>`;
  document.body.appendChild(tip);

  document.addEventListener("mouseover", e => {
    const el = termTarget(e.target);
    if (el) schedule(el);
    else if (current || showTimer !== null) hide();
  });
  document.addEventListener("mouseout", e => {
    const from = termTarget(e.target);
    if (from && !from.contains(e.relatedTarget as Node | null)) hide();
  });
  document.addEventListener("focusin", e => {
    const el = termTarget(e.target);
    if (el) schedule(el);
  });
  document.addEventListener("focusout", hide);
  // 押した・スクロールした・Esc を押したら閉じる
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
}
