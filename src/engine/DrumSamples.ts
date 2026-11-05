import * as Tone from "tone";

// ===== ドラムのワンショット音源（WAV など）の読み込み =====
//
// 置き場所：public/samples/drums/<フォルダ>/<トラック名>.wav
//   フォルダはジャンルごと（DRUM_SAMPLE_DIRS）。ジャンルのフォルダにない音は default フォルダの音を使い、
//   どちらにもなければ、そのトラックだけ Tone.js のシンセで鳴らす（SynthFactory.ts）。
//   トラック名は kick / snare / hihat_closed / hihat_open / clap / rim。
//
// 読み込んだ AudioBuffer はコンテキストに依存しないので、WAV書き出し（Tone.Offline）でもそのまま使う。

// ジャンル → 音源のフォルダ名（URL に日本語を入れないよう英字にする）
export const DRUM_SAMPLE_DIRS: Record<string, string> = {
  EDM:          "edm",
  "8bit":       "8bit",
  ローファイ:   "lofi",
  ゲームBGM:    "gamebgm",
  テクノ:       "techno",
  ハウス:       "house",
  アンビエント: "ambient",
};

const DEFAULT_DIR = "default";
const TRACKS      = ["kick", "snare", "hihat_closed", "hihat_open", "clap", "rim"];
const EXTENSIONS  = ["wav"];

// URL → 読み込み結果（null = ファイルがない・読めない）。失敗も覚えて何度も読みに行かない
const cache = new Map<string, Promise<AudioBuffer | null>>();

function sampleUrl(dir: string, track: string, ext: string): string {
  // 相対パスにして、開発サーバー（http）とビルド後の Electron（file://）の両方で読めるようにする
  return `samples/drums/${dir}/${track}.${ext}`;
}

// file:// では fetch が使えないので XMLHttpRequest で読む
function fetchArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload  = () => {
      // file:// は成功しても status が 0 になる
      const ok = xhr.status === 200 || (xhr.status === 0 && xhr.response);
      // 開発サーバーはファイルがないと index.html を返すので、HTML は「ない」として扱う
      const isHtml = (xhr.getResponseHeader("Content-Type") ?? "").includes("text/html");
      resolve(ok && !isHtml ? xhr.response as ArrayBuffer : null);
    };
    xhr.onerror = () => resolve(null);
    xhr.send();
  });
}

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetchArrayBuffer(url).then(async data => {
      if (!data) return null;
      try {
        return await Tone.getContext().rawContext.decodeAudioData(data);
      } catch {
        console.warn(`[ドラム音源] 読み込めない音源ファイル: ${url}`);
        return null;
      }
    });
    cache.set(url, p);
  }
  return p;
}

async function findSample(dirs: string[], track: string): Promise<AudioBuffer | null> {
  for (const dir of dirs) {
    for (const ext of EXTENSIONS) {
      const buf = await loadBuffer(sampleUrl(dir, track, ext));
      if (buf) return buf;
    }
  }
  return null;
}

// ジャンル → トラック名 → 音源（読み込み済みのものだけ）
const loaded = new Map<string, Record<string, AudioBuffer>>();

// ジャンルの音源を読み込んでおく。再生・試聴・書き出しの前に呼ぶ（2回目以降はすぐ終わる）
export async function prepareDrumSamples(genre: string): Promise<void> {
  if (loaded.has(genre)) return;
  const dirs = [DRUM_SAMPLE_DIRS[genre], DEFAULT_DIR].filter((d): d is string => !!d);
  const result: Record<string, AudioBuffer> = {};
  const missing: string[] = [];
  await Promise.all(TRACKS.map(async track => {
    const buf = await findSample(dirs, track);
    if (buf) result[track] = buf;
    else missing.push(track);
  }));
  if (missing.length > 0) {
    console.info(`[ドラム音源] ${genre}: 音源がないので Tone.js のシンセで鳴らすトラック → ${missing.join(", ")}`);
  }
  loaded.set(genre, result);
}

// 読み込み済みの音源（なければ undefined。そのトラックはシンセで鳴らす）
export function getDrumSample(genre: string, track: string): AudioBuffer | undefined {
  return loaded.get(genre)?.[track];
}
