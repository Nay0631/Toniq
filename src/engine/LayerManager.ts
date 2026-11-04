import * as Tone from "tone";
import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import { loadDrumPattern, disposeDrum }       from "./DrumEngine";
import { loadChordProgression, disposeChord } from "./ChordPlayer";
import { loadBassLine, disposeBass }          from "./BassPlayer";
import { loadArpPattern, disposeArp }         from "./ArpPlayer";
import { loadPadPattern, disposePad }         from "./PadPlayer";
import { loadMelody, disposeMelody }          from "./MelodyPlayer";
import { loadFx, disposeFx }                  from "./FxPlayer";
import { getState, setState }                 from "./AppState";

export type LayerName = "drum" | "chord" | "bass" | "arp" | "pad" | "melody" | "fx";

// ===== レイヤーON/OFF =====
export function setLayerEnabled(layer: LayerName, enabled: boolean) {
  const state = getState();
  setState({
    parts: { ...state.parts, [layer]: enabled }
  });

  if (!enabled) {
    disposeLayer(layer);
    console.log(`レイヤーOFF: ${layer}`);
  } else {
    // 再生中なら読み込む。どの小節で鳴らすかはパートがアレンジを見て決める
    if (Tone.getTransport().state === "started") reloadLayer(layer);
    console.log(`レイヤーON: ${layer}`);
  }
}

// ===== レイヤー破棄 =====
function disposeLayer(layer: LayerName) {
  switch (layer) {
    case "drum":   disposeDrum();    break;
    case "chord":  disposeChord();   break;
    case "bass":   disposeBass();    break;
    case "arp":    disposeArp();     break;
    case "pad":    disposePad();     break;
    case "melody": disposeMelody();  break;
    case "fx":     disposeFx();      break;
  }
}

// ===== レイヤー再ロード（現在のStateから） =====
export function reloadLayer(layer: LayerName) {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;

  switch (layer) {
    case "drum":
      loadDrumPattern(s.drumPattern);
      break;
    case "chord":
      loadChordProgression(s.chordPattern, s.key, 4);
      break;
    case "bass":
      loadBassLine(s.chordPattern, s.key, 2);
      break;
    case "arp":
      loadArpPattern(s.chordPattern, s.key, 5, "8n");
      break;
    case "pad":
      loadPadPattern(s.chordPattern, s.key, 4);
      break;
    case "melody":
      loadMelody(s.melodyNotes, `${s.chordPattern.length_bars}m`);
      break;
    case "fx":
      loadFx(s.chordPattern);
      break;
  }
}

// ===== ドラムパターンを差し替え =====
export function replaceDrumPattern(newPattern: DrumPattern) {
  setState({ drumPattern: newPattern });
  disposeDrum();
  loadDrumPattern(newPattern);
  console.log(`ドラム差し替え: ${newPattern.name}`);
}

// ===== コード進行を差し替え =====
export function replaceChordProgression(
  newProgression: ChordProgression,
  checkScale: boolean = true
) {
  const state = getState();

  // スケール整合チェック
  if (checkScale && newProgression.base_scale !== state.chordPattern?.base_scale) {
    console.warn(
      `スケール不一致: 現在=${state.chordPattern?.base_scale} / 新=${newProgression.base_scale}`
    );
    return {
      success: false,
      warning: `スケールが変わります（${state.chordPattern?.base_scale} → ${newProgression.base_scale}）。メロディの再生成を推奨します。`,
    };
  }

  // Stateを先に更新
  setState({ chordPattern: newProgression });

  // 既存のPartを破棄
  disposeChord();
  disposeBass();
  disposeArp();
  disposePad();
  disposeFx();

  // Transport動作中でも正しく再開始できるよう少し遅延して再ロード
  const key = state.key;
  setTimeout(() => {
    loadChordProgression(newProgression, key, 4);
    loadBassLine(newProgression, key, 2);
    loadArpPattern(newProgression, key, 5, "8n");
    loadPadPattern(newProgression, key, 4);
    if (getState().parts.fx) loadFx(newProgression);
    console.log(`コード進行差し替え完了: ${newProgression.name}`);
  }, 50);

  return { success: true, warning: null };
}

// ===== メロディを差し替え =====
export function replaceMelody(newNotes: MelodyNote[]) {
  setState({ melodyNotes: newNotes });
  disposeMelody();
  const s = getState();
  loadMelody(newNotes, `${s.chordPattern!.length_bars}m`);
  console.log("メロディ差し替え完了");
}

// ===== 全レイヤーを一括破棄（停止時に前回の Part を残さない） =====
export function disposeAllLayers() {
  (["drum","chord","bass","arp","pad","melody","fx"] as LayerName[]).forEach(disposeLayer);
}

// ===== 全レイヤーを一括再ロード =====
export function reloadAllLayers() {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;
  (["drum","chord","bass","arp","pad","melody","fx"] as LayerName[]).forEach(layer => {
    if (s.parts[layer]) reloadLayer(layer);
  });
}