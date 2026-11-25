import { getState } from "../engine/AppState";
import { currentSongFields, findSong, hasUnsavedChanges, saveCurrentSong, SongStorageError } from "../engine/SongLibrary";
import * as Playback from "../engine/Playback";
import { songBeforeRating } from "./RatingScreen";

// ミュージックリストへの保存と、保存していない変更の確かめ方（ミュージックリスト・情報バーの「♪ 保存」「＋ 新規作成」・書き出しのダイアログで共通）

// 保存していない変更があるか。サンプルの試聴・メロディの評価で一時的に差し替えているときは、差し替える前の内容で比べる
export function hasUnsavedSong(): boolean {
  const fields = { ...(songBeforeRating() ?? currentSongFields()), ...Playback.sampleOriginal() };
  return hasUnsavedChanges(fields);
}

// 今の曲がミュージックリストにあるか（保存したことがあるか）
export function isListedSong(): boolean {
  return !!findSong(getState().songId);
}

// 失われる変更の説明（リストにある曲なら保存したあとの変更、ない曲なら曲そのもの）
export function lossMessage(): string {
  return isListedSong()
    ? "最後に保存したあとの変更は失われます。"
    : "この曲はミュージックリストに保存されていないため失われます。";
}

// ミュージックリストに書き込めなかったときの案内
export const STORAGE_HINT = "ミュージックリストの不要な曲を削除して整理してください。";

// ミュージックリストを書き換える操作を行う。書き込めなかったら知らせて false を返す
export function withStorage(action: () => void): boolean {
  try {
    action();
    return true;
  } catch (e) {
    if (!(e instanceof SongStorageError)) throw e;
    alert(`${e.message}。変更は保存されていません。\n${STORAGE_HINT}`);
    return false;
  }
}

// 今の曲をミュージックリストに保存する。書き込めなければ知らせる（編集中の曲は消えないので、整理してから保存し直せる）
export function saveToList(): boolean {
  try {
    saveCurrentSong();
    return true;
  } catch (e) {
    if (!(e instanceof SongStorageError)) throw e;
    alert(`${e.message}。この曲はミュージックリストに保存されていません。\n${STORAGE_HINT}\n`
        + "編集中の曲は消えていないので、整理したあとにもう一度「♪ 保存」してください。");
    return false;
  }
}
