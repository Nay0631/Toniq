// タイピングピアノ：パソコンのキーボードをピアノの鍵盤のように使う（ピアノロールの鍵盤入力・lidless の試し弾きで共通）。
// キーの物理的な位置（KeyboardEvent.code）を、基準のオクターブの C からの半音数に割り当てる（日本語配列でも同じ位置）。
// 下の2段（Z〜/ が白鍵、S D G H J L ; が黒鍵）が基準のオクターブの C〜1オクターブ上の E、
// 上の2段（Q〜] が白鍵、2 3 5 6 7 9 0 = が黒鍵）が1オクターブ上の C〜2オクターブ上の G
export const TYPING_KEYMAP: Readonly<Record<string, number>> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20,
  KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
  BracketLeft: 29, Equal: 30, BracketRight: 31,
};

// 押したキーの MIDI ノート番号（割り当てのないキーは null）。octave は基準のオクターブ（4 なら Z = C4 = 60）
export function typingKeyMidi(code: string, octave: number): number | null {
  const offset = TYPING_KEYMAP[code];
  return offset === undefined ? null : (octave + 1) * 12 + offset;
}
