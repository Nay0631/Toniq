import * as Tone from "tone";
import { getState } from "./AppState";
import { NOTE_INDEX } from "../data/degree_resolver";
import {
  GrowInstrument, prepareGrowContext, growPresetCategories, growSettings, growValues,
  type GrowCategory, type GrowPart,
} from "./Grow";

// grow の音色の試聴：音色（プリセット）を選び直したとき、そのパートの今の音作りで1音だけ鳴らす
// （カスタムモードのコードの音色・grow の音作りのパネルのプリセット）。
// 曲の再生中は鳴らさない（音色の変更が再生中のパートにそのまま反映されて聞こえるため）。
// 次の試聴・曲の再生の開始（Playback.ts）で前の音を短くフェードして止める。
// 鳴っている音は表示上の一時的な状態としてモジュール内に持つ（保存しない）。
// Playback.ts から呼ばれるので、ここからは Playback.ts を import しない（循環を避ける）

// 音の長さ（秒）。立ち上がりの遅いパッド・質感・FX は長めにする
const NOTE_SECONDS: Partial<Record<GrowCategory, number>> = { pad: 2.5, texture: 2.5, fx: 2 };
const DEFAULT_SECONDS = 1;
// 音を離してから破棄するまで（リリース・リバーブの余韻が消えるまで）
const TAIL_SECONDS = 4;
// 前の音を止めるときのフェード（秒。クリックを防ぐ）
const FADE_SECONDS = 0.05;

let token = 0;  // 新しい試聴・停止のたびに進める（準備を待っている間に次が来たら、前の試聴は取りやめる）
const sounding = new Set<GrowInstrument>();

// 曲のキーの主音（MIDI ノート番号）。ベースは A1〜G#2、それ以外は A3〜G#4
function previewNote(category: GrowCategory): number {
  const root = NOTE_INDEX[getState().key] ?? 0;
  const base = category === "bass" ? 33 : 57;  // 33 = A1、57 = A3
  return base + ((root - 9 + 12) % 12);
}

// ===== キーボードでの試し弾き（タイピングピアノ。KeyboardPreview.ts から呼ぶ） =====
// 押している間だけ鳴らす。音色はパートごとに1つ作り、同じパートなら使い回す（音作りの値は applyGrowLive ですぐ当たる）。
// 曲の再生中も鳴らせる（曲に合わせて音色を確かめられるように）。鳴らした音はミキサーを通さない

let keyInst: GrowInstrument | null = null;
let keyPart: GrowPart | null = null;
let keyToken = 0;  // 準備を待っている間に離された・止められたら取りやめる
const keyHeld = new Set<number>();

// 試し弾きの音色を止めて破棄する
export function stopGrowKeys(): void {
  keyToken++;
  keyHeld.clear();
  if (!keyInst) return;
  const inst = keyInst;
  keyInst = null;
  keyPart = null;
  inst.output.gain.rampTo(0, FADE_SECONDS);
  setTimeout(() => inst.dispose(), FADE_SECONDS * 1000 + 50);
}

// part の今の音作りで midi の音を鳴らし始める（離すまで伸ばす）
export async function growKeyDown(part: GrowPart, midi: number): Promise<void> {
  if (keyPart !== part) stopGrowKeys();
  stopGrowPreview();  // プリセットを選んだときの1音と重ねない
  const my = keyToken;
  keyHeld.add(midi);
  if (!keyInst) {
    try {
      await Tone.start();
      if (!(await prepareGrowContext())) return;
    } catch (e) {
      console.warn("grow の試し弾きを鳴らせませんでした:", e);
      return;
    }
    if (my !== keyToken || !keyHeld.has(midi)) return;
    if (!keyInst) {
      keyInst = new GrowInstrument(growValues(part));
      keyInst.connect(Tone.getDestination());
      keyPart = part;
    }
  }
  keyInst.triggerAttack(Tone.Frequency(midi, "midi").toNote(), undefined, 0.8);
}

// midi の音を離す
export function growKeyUp(midi: number): void {
  if (!keyHeld.delete(midi) || !keyInst) return;
  keyInst.triggerRelease(Tone.Frequency(midi, "midi").toNote());
}

// 鳴っている試聴の音を短くフェードして止める
export function stopGrowPreview(): void {
  token++;
  sounding.forEach(inst => {
    inst.output.gain.rampTo(0, FADE_SECONDS);
    setTimeout(() => inst.dispose(), FADE_SECONDS * 1000 + 50);
  });
  sounding.clear();
}

// パートの今の音作り（プリセット＋変えた値）で1音鳴らす。鳴らしたら true
export async function previewGrowSound(part: GrowPart): Promise<boolean> {
  stopGrowPreview();
  const my = token;
  if (Tone.getTransport().state === "started") return false;
  try {
    await Tone.start();
    if (!(await prepareGrowContext())) return false;
  } catch (e) {
    console.warn("grow の試聴を鳴らせませんでした:", e);
    return false;
  }
  // 待っている間にほかの試聴・停止・曲の再生が始まったら取りやめる
  if (my !== token || Tone.getTransport().state === "started") return false;

  const category = growPresetCategories()[growSettings(part).preset] ?? "lead";
  const seconds  = NOTE_SECONDS[category] ?? DEFAULT_SECONDS;
  const inst = new GrowInstrument(growValues(part));
  inst.connect(Tone.getDestination());
  inst.triggerAttackRelease(Tone.Frequency(previewNote(category), "midi").toNote(), seconds, undefined, 0.8);
  sounding.add(inst);
  setTimeout(() => {
    if (!sounding.delete(inst)) return;  // もう止めた
    inst.dispose();
  }, (seconds + TAIL_SECONDS) * 1000);
  return true;
}
