import * as Tone from "tone";
import { getState, setState, NoteNames } from "../engine/AppState";
import type { DrumSource } from "../engine/SynthFactory";
import { prepareDrumSamples } from "../engine/DrumSamples";
import { reloadLayer } from "../engine/LayerManager";
import { applyLoopPlayback } from "../engine/Playback";

// 端末ごとの設定（設定画面）：音名の表記・ループ再生・ドラムの音源。
// 値は AppState に置き、ここで localStorage に保存・読み込みする（曲には保存しない。SONG_FIELDS に入れない）
// 配色・スキンは Theme.ts、用語のツールチップは Glossary.ts が受け持つ

const KEYS = {
  noteNames:    "toniq.noteNames",
  loopPlayback: "toniq.loop",
  drumSource:   "toniq.drumSource",
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;  // 保存領域が使えないときは初期値
  }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても今の画面には反映する */ }
}

export function setNoteNames(noteNames: NoteNames): void {
  setState({ noteNames });
  write(KEYS.noteNames, noteNames);
}

export function setLoopPlayback(on: boolean): void {
  setState({ loopPlayback: on });
  write(KEYS.loopPlayback, on ? "on" : "off");
  applyLoopPlayback();  // 曲の再生中なら、今の再生の終わり方もすぐ切り替える
}

// ドラムの音源。キットは読み込み時に作るので、再生中ならドラムだけ読み込み直す（音源は先に読み込んでおく）
export async function setDrumSource(drumSource: DrumSource): Promise<void> {
  setState({ drumSource });
  write(KEYS.drumSource, drumSource);
  const s = getState();
  if (drumSource === "sample") await prepareDrumSamples(s.genre);
  if (Tone.getTransport().state === "started" && getState().parts.drum) reloadLayer("drum");
}

export function initPreferences(): void {
  const noteNames = read(KEYS.noteNames);
  const drumSource = read(KEYS.drumSource);
  setState({
    noteNames:    noteNames === "doremi" ? "doremi" : "cde",
    loopPlayback: read(KEYS.loopPlayback) === "on",
    drumSource:   drumSource === "sample" ? "sample" : "synth",
  });
}
