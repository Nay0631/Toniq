import * as Tone from "tone";
import { DrumPattern } from "../data/types";
import drumDB from "../data/drum_patterns.json";
import { getState, ArrangeBlock } from "./AppState";
import { createDrumKit, DrumKit } from "./SynthFactory";
import { createVolumeNode } from "./VolumeManager";
import { arrangementBlockAt } from "./LoopArranger";

const DRUM_PATTERNS = drumDB as unknown as DrumPattern[];

// DB に出てくるトラック名すべて。ブロックごとにパターンを切り替えても音が欠けないよう、キットは全トラック分作る
const ALL_TRACKS = [...new Set(DRUM_PATTERNS.flatMap(p => Object.keys(p.tracks)))];

// クローズドハイハットが鳴ったら止める音（実機と同じくオープンハイハットを切る）
const CHOKES: Record<string, string[]> = {
  hihat_closed: ["hihat_open"],
};

export function drumPatternById(id: string): DrumPattern | undefined {
  return DRUM_PATTERNS.find(p => p.id === id);
}

// ブロックで鳴らすパターン（ブロックに指定がない・DB に見つからないときは曲の設定のパターン）
export function blockDrumPattern(block?: ArrangeBlock | null): DrumPattern | null {
  const own = block?.drum ? drumPatternById(block.drum) : undefined;
  return own ?? getState().drumPattern;
}

let currentSeq: Tone.Sequence | null = null;
let kit: DrumKit | null = null;
let drumVol: Tone.Volume | null = null;

// 周回の頭で読み込み直したとき、直前に予約済みの音（頭のキックなど）を切らないよう
// 古いキットは少し待ってから破棄する
const RETIRE_MS = 1500;
const retiredKits = new Set<DrumKit>();

// キットはジャンルで音作りが変わるので、パターンを読み込むたびに作り直す。
// pattern は曲の設定のパターン。アレンジのブロックに別のパターンがあれば、その小節はそちらで鳴らす
export function loadDrumPattern(pattern: DrumPattern) {
  currentSeq?.dispose();
  currentSeq = null;
  if (kit) {
    const old = kit;
    retiredKits.add(old);
    setTimeout(() => {
      if (retiredKits.delete(old)) old.dispose();
    }, RETIRE_MS);
    kit = null;
  }

  drumVol = createVolumeNode("drum");  // 現在のオーディオコンテキスト用のノード
  const { genre, drumSource } = getState();
  const trackNames = [...new Set([...ALL_TRACKS, ...Object.keys(pattern.tracks)])];
  kit = createDrumKit(genre, trackNames, drumSource);
  kit.output.connect(drumVol);
  const voices = kit.voices;
  // 鳴らすかどうかとパターンは、発音時刻にあるブロックで決める（再生中のアレンジの編集もすぐ反映される）
  const blockAt = arrangementBlockAt("drum");

  currentSeq = new Tone.Sequence(
    (time, step) => {
      const block = blockAt(time);
      if (block === undefined) return;
      const current = block === null ? pattern : blockDrumPattern(block) ?? pattern;
      const i = step % current.steps;
      const hit = new Set<string>();
      Object.entries(current.tracks).forEach(([name, track]) => {
        if (!track.pattern[i]) return;
        voices[name]?.trigger(time, track.velocity?.[i] ?? 1);
        hit.add(name);
      });
      hit.forEach(name => {
        for (const target of CHOKES[name] ?? []) {
          if (!hit.has(target)) voices[target]?.choke?.(time);
        }
      });
    },
    [...Array(pattern.steps).keys()],
    pattern.step_unit as Tone.Unit.Time
  );

  currentSeq.start(0);
}

export function disposeDrum() {
  currentSeq?.dispose();
  kit?.dispose();
  retiredKits.forEach(k => k.dispose());
  retiredKits.clear();
  currentSeq = null;
  kit        = null;
}
