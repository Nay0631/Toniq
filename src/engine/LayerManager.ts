import * as Tone from "tone";
import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import { loadDrumPattern, disposeDrum }       from "./DrumEngine";
import { loadChordProgression, disposeChord } from "./ChordPlayer";
import { loadBassLine, disposeBass }          from "./BassPlayer";
import { loadArpPattern, disposeArp }         from "./ArpPlayer";
import { loadPadPattern, disposePad }         from "./PadPlayer";
import { loadSignature, disposeSignature }     from "./SignaturePlayer";
import { loadMelody, disposeMelody }          from "./MelodyPlayer";
import { loadFx, disposeFx }                  from "./FxPlayer";
import { loadCounter, disposeCounter }         from "./CounterPlayer";
import { loadPerc, disposePerc }               from "./PercPlayer";
import { getState, setState }                 from "./AppState";
import { songProgression, songMelody }         from "./SongForm";
import { LAYERS }                             from "./LoopArranger";

// パートの一覧（並び）は LoopArranger.ts の LAYERS
export type LayerName =
  "drum" | "perc" | "chord" | "bass" | "arp" | "pad" | "signature" | "melody" | "counter" | "fx";

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
    case "signature": disposeSignature(); break;
    case "melody": disposeMelody();  break;
    case "counter": disposeCounter(); break;
    case "perc":   disposePerc();    break;
    case "fx":     disposeFx();      break;
  }
}

// ===== レイヤー再ロード（現在のStateから） =====
// コードに沿うパートには曲全体の並び（セクションごとの進行・エンディング。SongForm.songProgression）を渡す。
// FX はループの継ぎ目の効果音なので、コード進行1周で読み込む
export function reloadLayer(layer: LayerName) {
  const s = getState();
  const song = songProgression();
  if (!s.chordPattern || !s.drumPattern || !song) return;

  switch (layer) {
    case "drum":
      loadDrumPattern(s.drumPattern);
      break;
    case "chord":
      loadChordProgression(song, s.key);
      break;
    case "bass":
      loadBassLine(song, s.key, 2);
      break;
    case "arp":
      loadArpPattern(song, s.key);
      break;
    case "pad":
      loadPadPattern(song, s.key);
      break;
    case "signature":
      loadSignature(song, s.key);
      break;
    case "melody":
      loadMelody(songMelody(), `${song.length_bars}m`);
      // カウンターメロディはメロディから作るので、メロディを読み込み直したら一緒に作り直す（ピアノロールの編集など）
      if (s.parts.counter) loadCounter(song, songMelody(), s.key);
      break;
    case "counter":
      loadCounter(song, songMelody(), s.key);
      break;
    case "perc":
      loadPerc();
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
  disposeSignature();
  disposeCounter();
  disposeFx();

  // Transport動作中でも正しく再開始できるよう少し遅延して再ロード（曲全体の並びで読み込む）
  setTimeout(() => {
    (["chord", "bass", "arp", "pad", "signature", "counter", "fx"] as LayerName[]).forEach(layer => {
      if (getState().parts[layer]) reloadLayer(layer);
    });
    console.log(`コード進行差し替え完了: ${newProgression.name}`);
  }, 50);

  return { success: true, warning: null };
}

// ===== メロディを差し替え =====
export function replaceMelody(newNotes: MelodyNote[]) {
  setState({ melodyNotes: newNotes });
  disposeMelody();
  reloadLayer("melody");
  console.log("メロディ差し替え完了");
}

// ===== 全レイヤーを一括破棄（停止時に前回の Part を残さない） =====
export function disposeAllLayers() {
  LAYERS.forEach(disposeLayer);
}

// ===== 全レイヤーを一括再ロード =====
export function reloadAllLayers() {
  const s = getState();
  if (!s.chordPattern || !s.drumPattern) return;
  // メロディを読み込むとカウンターメロディも作るので、カウンターメロディだけを2度読み込まない
  LAYERS.filter(layer => !(layer === "counter" && s.parts.melody)).forEach(layer => {
    if (s.parts[layer]) reloadLayer(layer);
  });
}