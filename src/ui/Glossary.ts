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
  grow:        { title: "grow", desc: "Toniq の内部シンセサイザーです。メロディ・コード・ベース・パッド・アルペジオ・シグネチャー・FX / SE の音を出しています。まずはプリセットを選んでみましょう。" },
  key:         { title: "キー", desc: "曲の中心になる音（ルート音）とスケールの組み合わせです。キーを変えると、曲全体が同じ形のまま高く・低くなります。" },
  root:        { title: "ルート音", desc: "キーやコードの土台になる音です。曲はこの音に戻ってくると「落ち着いた」感じがします。" },
  scale:       { title: "スケール（音階）", desc: "曲で使う音を高さの順に並べたものです。メジャーは明るく、マイナーは暗い・切ない響きになります。" },
  scaleLock:   { title: "スケールロック", desc: "今のスケールに合う音（コード進行）だけを選べるようにする機能です。外れた音にならないので安心して試せます。" },
  chord:       { title: "コード（和音）", desc: "高さの違う音をいくつか同時に鳴らしたものです。曲の明るさ・暗さなどの雰囲気を作ります。" },
  progression: { title: "コード進行", desc: "コードを鳴らす順番です。同じメロディでもコード進行が変わると曲の雰囲気が変わります。" },
  chordCategory: { title: "コード進行の雰囲気", desc: "コード進行を雰囲気（明るい・暗い など）で分けたものです。選んだ雰囲気の進行から選べます。スケールを変えると、そのスケールの進行に切り替わります。" },
  extraParts:  { title: "追加パート", desc: "パッド・アルペジオ・シグネチャー・カウンターメロディ・パーカッションです。曲に厚みや動きを足します。1つずつ鳴らす・止めるのはアレンジャーで切り替えます。" },
  chordRhythm: { title: "リズム（コード）", desc: "コードを鳴らす間隔です。全音符は1小節に1回、8分音符は1小節に8回刻みます。" },
  drum:        { title: "ドラム", desc: "リズムを刻むパートです。キック（低いドン）・スネア（パン）・ハイハット（チッ）などの打楽器を組み合わせます。" },
  drumPattern: { title: "ドラムパターン", desc: "1小節を16マスに分けて、どのマスでどの打楽器を鳴らすかを決めたリズムの型です。" },
  drumCategory:{ title: "カテゴリ（ドラム）", desc: "ドラムパターンをジャンルで分けたものです。ほかのジャンルのパターンを使うこともできます。" },
  bass:        { title: "ベース", desc: "低い音でコードの土台を支えるパートです。ドラムと一緒に曲のノリを作ります。" },
  melody:      { title: "メロディ", desc: "曲の主役になる旋律で、口ずさめる部分です。" },
  pad:         { title: "パッド", desc: "後ろで長く伸ばして鳴らす、やわらかい和音の音です。曲に厚みと広がりを出します。" },
  arp:         { title: "アルペジオ", desc: "和音の音を同時ではなく、1つずつ順番に鳴らす弾き方です。キラキラした動きが出ます。" },
  signature:   { title: "シグネチャー", desc: "ジャンルらしさを出す Toniq の追加パートです。EDM ならコードの刻み、ローファイならレコードのノイズなど、ジャンルごとに鳴り方が変わります。" },
  counter:     { title: "カウンターメロディ", desc: "メロディに寄り添うもう1本の旋律です。サビではメロディの少し下でハモり、Aメロではメロディが休んでいる所に短い合いの手を入れます。" },
  perc:        { title: "パーカッション", desc: "シェイカー（シャカシャカ）やタンバリン、コンガ（ポコポコ）などの小さな打楽器です。ドラムに重ねると、リズムが細かくにぎやかになります。" },
  modulation:  { title: "転調", desc: "曲の途中でキーを上げることです。最後のサビで半音〜全音上げると、ぐっと盛り上がって聞こえます。" },
  "modulation.last":   { title: "最後のサビから", desc: "最後のサビからキーを上げ、そのまま曲の終わりまで上げたキーで鳴らします（ラスサビ転調）。" },
  "modulation.chorus": { title: "サビだけ", desc: "サビのたびにキーを上げ、Aメロでは元のキーに戻ります。サビとの違いがはっきりします。" },
  subBass:     { title: "サブベース", desc: "ベースの1オクターブほど下で鳴らす、とても低いサイン波の音です。耳で聞くより体で感じる低音で、EDM などの迫力を出します。" },
  fx:          { title: "FX / SE", desc: "効果音のことです。曲の区切りの前で盛り上げたり（ライザー）、頭で「ドーン」と鳴らしたりして、場面の切り替わりを分かりやすくします。" },
  groove:      { title: "グルーヴ", desc: "曲のノリのことです。音を鳴らすタイミングや音量の揺れ方で、体が動きたくなる感じが生まれます。" },
  swingUnit:   { title: "跳ねる単位", desc: "スウィングでずらす音の細かさです。8分音符にすると「タッタ タッタ」とゆったり跳ねるシャッフルになります。" },
  "swingUnit.16n": { title: "16分音符", desc: "細かい16分音符の裏をずらします。ハウスやローファイの軽い跳ね方です。" },
  "swingUnit.8n":  { title: "8分音符（シャッフル）", desc: "8分音符の裏をずらします。スウィングを大きくすると3連符のシャッフル（ブルースやジャズのノリ）になります。" },
  swing:       { title: "スウィング", desc: "細かい音の裏側（2つ目）を少し後ろへずらして、「タッタ タッタ」と跳ねたノリにします。ローファイやハウスでよく使います。0 でまっすぐなリズムです。" },
  sidechain:   { title: "サイドチェイン", desc: "キックが鳴るたびに、ベースやコードの音量を一瞬下げてすぐ戻す技です。音が「ふわっ ふわっ」と呼吸するように揺れ、EDM やハウスらしい勢いが出ます。" },
  arranger:    { title: "アレンジャー", desc: "どの小節でどのパートを鳴らすかを決める画面です。パートを出し入れすると曲に展開（盛り上がり）が生まれます。" },
  pianoroll:   { title: "ピアノロール", desc: "縦が音の高さ、横が時間のマス目です。マスに音符を置いてメロディを作ります。「ドラム」に切り替えると、キックやスネアを置いてオリジナルのドラムを作れます。" },
  section:     { title: "セクション", desc: "曲の部分のことです。Aメロ（落ち着いた部分）とサビ（いちばん盛り上がる部分）で、コード進行とメロディを切り替えます。" },
  arrangePreset: { title: "構成", desc: "曲の流れ（どこで静かにして、どこで盛り上げるか）です。選ぶだけで、セクションごとに鳴らすパートが決まります。" },
  "arrangePreset.standard": { title: "標準", desc: "ジャンルに合わせた構成です。Aメロ → Aメロ → サビ → Aメロ の順に、少しずつパートを入れ替えます。" },
  "arrangePreset.quiet":    { title: "静かに始まる", desc: "コードとパッドだけで静かに始まり、途中からドラムなどほかのパートが入ります。" },
  "arrangePreset.drop":     { title: "サビを強く", desc: "サビの前でドラムとベースを抜いて「ため」を作り、サビで全部のパートが一気に鳴ります。" },
  "arrangePreset.short":    { title: "短く繰り返す", desc: "Aメロ1回ですぐサビに入り、Aメロ → サビ をくり返します。短い曲に向いています。" },
  "arrangePreset.buildup":  { title: "だんだん盛り上がる", desc: "少ないパートから始めて、セクションごとにパートを足していきます。最後まで盛り上がりが続きます。" },
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
  chiptune:    { title: "チップチューン", desc: "昔のゲーム機の音源チップで鳴らしたような、単純な波形のピコピコした音楽です。8bit とも呼ばれます。" },
  vinyl:       { title: "レコードのノイズ", desc: "古いレコードを再生したときの「サー」「プチプチ」という小さな雑音です。わざと混ぜると懐かしい雰囲気になります。" },
  bgm:         { title: "BGM", desc: "バックグラウンドミュージックの略で、作業中やゲーム・動画の後ろで流す音楽のことです。" },
  phrase:      { title: "フレーズ", desc: "ひとまとまりに聞こえる短い音の並びです。同じフレーズをくり返すと覚えやすく、ノリも出ます。" },
  fourOnFloor: { title: "4つ打ち", desc: "1小節の4拍すべてでキックを「ドン・ドン・ドン・ドン」と鳴らすリズムです。ハウスやテクノなどダンス音楽の基本です。" },
  kick:        { title: "キック", desc: "ドラムのいちばん低い「ドン」という音です。曲のリズムの土台になります。" },
  synth:       { title: "シンセ（シンセサイザー）", desc: "電子的に音を作る楽器です。つまみで音色を変えて、ほかの楽器にはない音を作れます。" },
  rhythm:      { title: "リズム", desc: "音を鳴らすタイミングと長さの並びです。ドラムなどが刻むリズムで、曲のノリが決まります。" },
  loop:        { title: "周回", desc: "コード進行1回分を1周として、今が何周目かを表します。曲は周回を重ねながらパートが増えたり減ったりします。" },
  strings:     { title: "Str（ストリングス）", desc: "Strings の略で、バイオリンやチェロなど弦楽器の合奏の音です。パッドと同じく後ろで長く伸ばして曲に厚みを出す役目なので、ここではまとめて扱っています。" },

  // ===== 選択肢（<option data-term>）の説明。ドロップダウンのリストで項目にカーソルを乗せると出す =====
  // スケール（カスタムモードの「スケール・キー」）
  "scale.major":    { title: "メジャー", desc: "明るく元気な響きのスケールです。「ドレミファソラシド」がこれで、楽しい曲や前向きな曲によく使います。" },
  "scale.minor":    { title: "マイナー", desc: "暗く切ない響きのスケールです。「ラシドレミファソラ」がこれで、悲しい曲やかっこいい曲によく使います。" },
  "scale.dorian":   { title: "ドリアン", desc: "マイナーに似ていますが、1音だけ明るい音が混ざったスケールです。暗すぎず、おしゃれでクールな響きになります。" },
  "scale.phrygian": { title: "フリジアン", desc: "マイナーよりさらに暗く、2つ目の音がすぐ隣にある緊張感の強いスケールです。妖しい・エキゾチックな響きになります。" },

  // コードのリズム（「コード進行」の「リズム」）
  "chordRhythm.whole":   { title: "全音符", desc: "コードが変わるまで1回だけ鳴らして伸ばします。いちばんゆったりして、落ち着いた感じになります。" },
  "chordRhythm.half":    { title: "2分音符", desc: "1小節に2回（2拍ごとに）コードを鳴らします。ゆったりしつつ、少し動きが出ます。" },
  "chordRhythm.quarter": { title: "4分音符", desc: "1拍ごと、1小節に4回コードを鳴らします。リズムがはっきりして、歩くようなノリになります。" },
  "chordRhythm.eighth":  { title: "8分音符", desc: "半拍ごと、1小節に8回コードを刻みます。細かく刻むので勢いが出て、にぎやかになります。" },

  // FX / SE の種類
  "fx.auto":       { title: "ジャンルの標準", desc: "ジャンルに合った効果音を自動で選びます。迷ったらこれで大丈夫です。" },
  "fx.riser":      { title: "ライザー", desc: "「シュワーッ」と音がだんだん高く・大きくなっていく効果音です。区切りの直前に鳴らして、次の盛り上がりへの期待感を高めます。" },
  "fx.build":      { title: "ライザー＋インパクト", desc: "ライザーで盛り上げて、次の頭で「ドーン」とインパクトを鳴らします。サビに入る瞬間を派手に演出できます。" },
  "fx.impact":     { title: "インパクト", desc: "区切りの頭で「ドーン」と鳴る、低く重い一撃の効果音です。新しい部分が始まったことをはっきり伝えます。" },
  "fx.downlifter": { title: "ダウンリフター", desc: "ライザーの逆で、高い音から「ヒューン」と下がっていく効果音です。盛り上がりを落ち着かせる場面に合います。" },
  "fx.reverse":    { title: "リバースシンバル", desc: "シンバルの音を逆再生した「フワァッ」と吸い込まれるような効果音です。次の頭に向かって音が膨らみます。" },
  "fx.chip":       { title: "チップSE（8bit）", desc: "昔のゲーム機のような「ピロピロ」「ピュン」という電子音の効果音です。8bit の曲によく合います。" },

  // 音色（コードの「音色」・grow のプリセット）。キーは grow のプリセットの ID
  "sound.auto":     { title: "ジャンルに合わせる", desc: "ジャンルに合った音色を自動で選びます。カッコ内が今のジャンルで使う音色です。" },
  "sound.soft_pad": { title: "ソフトパッド", desc: "角のない、ふんわりやわらかい音色です。後ろで静かに支えたいときに合います。" },
  "sound.wide_pad": { title: "ワイドパッド", desc: "左右に大きく広がる、厚みのあるパッドの音色です。曲全体を包み込むような広がりが出ます。" },
  "sound.hard_pad": { title: "ハードパッド", desc: "芯がはっきりした、少し硬めのパッドの音色です。ほかの音に埋もれにくく、力強い響きになります。" },
  "sound.epiano":   { title: "エレピ", desc: "エレクトリックピアノの、丸くて温かい音色です。ローファイやおしゃれな曲によく合います。" },
  "sound.strings":  { title: "ストリングス", desc: "バイオリンなど弦楽器の合奏のような音色です。なめらかで、映画やゲームの曲のような雰囲気になります。" },
  "sound.organ":    { title: "オルガン", desc: "息の長い、少しざらっとしたオルガンの音色です。ハウスやテクノのコードの刻みでよく使われます。" },
  "sound.square":   { title: "スクエア", desc: "四角い形の波（矩形波）の、ピコピコした音色です。昔のゲーム機のような 8bit の音になります。" },
  "sound.supersaw": { title: "スーパーソウ", desc: "ギザギザの波を何本も少しずつずらして重ねた、分厚くきらびやかな音色です。EDM やトランスの定番です。" },

  // メロディの音色（「インスト」）
  "melodySound.grow":     { title: "grow（Toniq専用シンセ）", desc: "Toniq の内部シンセサイザーで鳴らします。下の音作りのパネルでプリセットを選んだり、音を細かく変えたりできます。" },
  "melodySound.auto":     { title: "ジャンルに合わせる", desc: "ジャンルに合った音色を自動で選びます。" },
  "melodySound.supersaw": { title: "SuperSaw リード", desc: "ギザギザの波を重ねた、分厚く派手なリードの音色です。EDM のメロディの定番です。" },
  "melodySound.epiano":   { title: "エレピ", desc: "エレクトリックピアノの、丸くて温かい音色です。ローファイによく合います。" },
  "melodySound.bell":     { title: "ベル", desc: "「キラーン」と澄んだ、鐘のような音色です。ゲームBGM やかわいい曲に合います。" },
  "melodySound.square":   { title: "スクエア", desc: "四角い形の波（矩形波）の、ピコピコした音色です。昔のゲーム機のような 8bit の音になります。" },
  "melodySound.acid":     { title: "アシッド", desc: "「ビュンビュン」とクセのある、うねるような電子音です。テクノでよく使われます。" },
  "melodySound.lead":     { title: "シンセリード", desc: "メロディを目立たせるための、くっきりしたシンセの音色です。どのジャンルでも使いやすい音です。" },
  "melodySound.pluck":    { title: "プラック", desc: "弦をはじいたように、鳴ってすぐ消える短い音色です。ハウスなどで軽やかなメロディになります。" },
  "melodySound.soft":     { title: "ソフトサイン", desc: "丸くやさしい、笛のような音色です。アンビエントなど静かな曲に合います。" },
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
  // ドロップダウンの選択肢はリストを隠さないよう横に出す（右に入りきらなければ左）
  if (el instanceof HTMLOptionElement) {
    const right = rect.right + margin * 1.5;
    const x = right + width <= window.innerWidth - margin ? right : rect.left - width - margin * 1.5;
    const y = Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - margin);
    tip.style.left = `${Math.max(margin, x)}px`;
    tip.style.top  = `${Math.max(margin, y)}px`;
    return;
  }
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
  // ドロップダウンのリスト（最前面のトップレイヤー）より上に出すため、popover として出し直す
  if (tip.popover) {
    try {
      if (tip.matches(":popover-open")) tip.hidePopover();
      tip.showPopover();
    } catch { /* popover が使えなければ普通に出す */ }
  }
  position(el);
  el.setAttribute("aria-describedby", tip.id);
}

function hide(): void {
  if (showTimer !== null) clearTimeout(showTimer);
  showTimer = null;
  if (tip) {
    tip.hidden = true;
    try { if (tip.popover && tip.matches(":popover-open")) tip.hidePopover(); } catch { /* 何もしない */ }
  }
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
  if ("popover" in tip) tip.popover = "manual";
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
