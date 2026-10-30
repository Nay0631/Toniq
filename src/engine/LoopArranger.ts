import * as Tone from "tone";
import { ChordProgression, DrumPattern } from "../data/types";
import { MelodyNote } from "./MelodyGenerator";
import { loadDrumPattern } from "./DrumEngine";
import { loadChordProgression } from "./ChordPlayer";
import { loadBassLine } from "./BassPlayer";
import { loadArpPattern } from "./ArpPlayer";
import { loadPadPattern } from "./PadPlayer";
import { loadMelody } from "./MelodyPlayer";
import { loadFx } from "./FxPlayer";

// ジャンルごとの周回アレンジ定義（パートは一度入ると以降の周回でも鳴り続ける）
const LOOP_SCHEDULE: Record<string, Record<number, string[]>> = {
  "EDM": {
    1: ["drum", "chord"],
    2: ["drum", "chord", "bass", "fx"],
    3: ["drum", "chord", "bass", "arp", "pad", "fx"],
    4: ["drum", "chord", "bass", "arp", "pad", "melody", "fx"],
  },
  "8bit": {
    1: ["drum", "chord"],
    2: ["drum", "chord", "melody"],
    3: ["drum", "chord", "melody", "bass", "fx"],
    4: ["drum", "chord", "melody", "bass", "arp", "fx"],
  },
  "ローファイ": {
    1: ["drum", "chord", "pad"],
    2: ["drum", "chord", "pad", "bass"],
    3: ["drum", "chord", "pad", "bass", "melody"],
    4: ["drum", "chord", "pad", "bass", "melody", "arp"],
  },
  "ゲームBGM": {
    1: ["drum", "chord"],
    2: ["drum", "chord", "bass", "pad"],
    3: ["drum", "chord", "bass", "pad", "melody", "fx"],
    4: ["drum", "chord", "bass", "pad", "melody", "arp", "fx"],
  },
  "テクノ": {
    1: ["drum"],
    2: ["drum", "bass", "fx"],
    3: ["drum", "bass", "arp", "chord", "fx"],
    4: ["drum", "bass", "arp", "chord", "pad", "melody", "fx"],
  },
};

interface LoopArrangerParams {
  genre:        string;
  chordPattern: ChordProgression;
  drumPattern:  DrumPattern;
  melodyNotes:  MelodyNote[];
  key:          string;
  bpm:          number;
  onLoopChange?: (loop: number, parts: string[]) => void;
}

let loopCount    = 0;
let repeatPart: Tone.Part | null = null;

export function startLoopArranger(params: LoopArrangerParams) {
  const {
    genre, chordPattern, drumPattern,
    melodyNotes, key, bpm, onLoopChange
  } = params;

  loopCount = 0;
  const schedule = LOOP_SCHEDULE[genre] ?? LOOP_SCHEDULE["ローファイ"];
  const maxLoop  = Math.max(...Object.keys(schedule).map(Number));
  const loopBars = chordPattern.length_bars;
  const loopSec  = (loopBars * 4 * 60) / bpm;

  // ループごとにパートを切り替えるRepeatを設定
  repeatPart = new Tone.Part((time) => {
    loopCount++;
    const currentLoop  = Math.min(loopCount, maxLoop);
    const activeParts  = schedule[currentLoop] ?? schedule[maxLoop];

    Tone.getDraw().schedule(() => {
      console.log(`周回 ${loopCount} / アクティブパート: ${activeParts.join(", ")}`);
      onLoopChange?.(loopCount, activeParts);

      // 各パートをON/OFF
      if (activeParts.includes("drum"))
        loadDrumPattern(drumPattern);

      if (activeParts.includes("chord"))
        loadChordProgression(chordPattern, key, 4);

      if (activeParts.includes("bass"))
        loadBassLine(chordPattern, key, 2);
      
      if (activeParts.includes("arp"))
        loadArpPattern(chordPattern, key, 5, "8n");

      if (activeParts.includes("pad"))
        loadPadPattern(chordPattern, key, 4);

      if (activeParts.includes("melody"))
        loadMelody(melodyNotes, `${loopBars}m`);

      if (activeParts.includes("fx"))
        loadFx(chordPattern);

    }, time);
  }, [
    // 各ループの開始タイミングを登録（最大8周まで）
    ...Array.from({ length: 8 }, (_, i) => ({ time: `+${i * loopSec}` }))
  ]);

  repeatPart.start(0);
}

export function stopLoopArranger() {
  repeatPart?.dispose();
  repeatPart = null;
  loopCount  = 0;
}

export function getCurrentLoop(): number {
  return loopCount;
}