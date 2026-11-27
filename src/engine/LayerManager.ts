import * as Tone from "tone";
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
import { LAYERS, isArrangementBypassed }       from "./LoopArranger";

// パートの一覧（並び）は LoopArranger.ts の LAYERS
export type LayerName =
  "drum" | "perc" | "chord" | "bass" | "arp" | "pad" | "signature" | "melody" | "counter" | "fx";

// ===== レイヤーON/OFF =====
export function setLayerEnabled(layer: LayerName, enabled: boolean) {
  const state = getState();
  setState({
    parts: { ...state.parts, [layer]: enabled }
  });
  // 試聴・サンプル中は、鳴らすパートを ON/OFF と関係なく決めているので、鳴っているものは変えない（次の曲の再生から効く）
  if (isArrangementBypassed()) return;

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

// layers を1回ずつ読み込む。
// コードに沿うパートには曲全体の並び（セクションごとの進行・エンディング。SongForm.songProgression）を渡す。
// FX はループの継ぎ目の効果音なので、コード進行1周で読み込む
export function loadLayers(layers: readonly LayerName[]) {
  const s = getState();
  const song = songProgression();
  if (!s.chordPattern || !s.drumPattern || !song) return;
  const { chordPattern, drumPattern, key } = s;
  const melody = layers.includes("melody") || layers.includes("counter") ? songMelody() : [];

  for (const layer of layers) switch (layer) {
    case "drum":
      loadDrumPattern(drumPattern);
      break;
    case "chord":
      loadChordProgression(song, key);
      break;
    case "bass":
      loadBassLine(song, key, 2);
      break;
    case "arp":
      loadArpPattern(song, key);
      break;
    case "pad":
      loadPadPattern(song, key);
      break;
    case "signature":
      loadSignature(song, key);
      break;
    case "melody":
      loadMelody(melody, song.length_bars);
      break;
    case "counter":
      loadCounter(song, melody, key);
      break;
    case "perc":
      loadPerc();
      break;
    case "fx":
      loadFx(chordPattern);
      break;
  }
}

// 1つのパートを読み込み直す。メロディを変えたら、メロディから決まるパート（カウンターメロディと、メロディを避けて
// 転回形を決めるコード）も一緒に読み込み直す（どちらも、音の並びが変わらなければ作り直さない）
export function reloadLayer(layer: LayerName) {
  const { parts } = getState();
  const followers = (["counter", "chord"] as const).filter(name => layer === "melody" && parts[name]);
  loadLayers([layer, ...followers]);
}

// ===== 全レイヤーを一括破棄（停止時に前回の Part を残さない） =====
export function disposeAllLayers() {
  LAYERS.forEach(disposeLayer);
}

// ===== 全レイヤーを一括再ロード（ON のパートだけ） =====
export function reloadAllLayers() {
  const { parts } = getState();
  loadLayers(LAYERS.filter(layer => parts[layer]));
}
