import * as Tone from "tone";
import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import { loadDrumPattern, disposeDrum }       from "./DrumEngine";
import { loadChordProgression, disposeChord } from "./ChordPlayer";
import { loadBassLine, disposeBass }          from "./BassPlayer";
import { loadArpPattern, disposeArp }         from "./ArpPlayer";
import { loadPadPattern, disposePad }         from "./PadPlayer";
import { loadMelody, disposeMelody }          from "./MelodyPlayer";
import { getState, setState }                 from "./AppState";

export type LayerName = "drum" | "chord" | "bass" | "arp" | "pad" | "melody";

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
    reloadLayer(layer);
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
    // メロディをスケール外警告対象としてマーク（UIで表示）
    return {
      success: false,
      warning: `スケールが変わります（${state.chordPattern?.base_scale} → ${newProgression.base_scale}）。メロディの再生成を推奨します。`,
    };
  }

  setState({ chordPattern: newProgression });
  disposeChord();
  disposeBass();
  disposeArp();
  disposePad();
  loadChordProgression(newProgression, state.key, 4);
  loadBassLine(newProgression, state.key, 2);
  loadArpPattern(newProgression, state.key, 5, "8n");
  loadPadPattern(newProgression, state.key, 4);

  console.log(`コード進行差し替え: ${newProgression.name}`);
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

// ===== 全レイヤーを一括再ロード =====
export function reloadAllLayers() {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;
  (["drum","chord","bass","arp","pad","melody"] as LayerName[]).forEach(layer => {
    if (s.parts[layer]) reloadLayer(layer);
  });
}