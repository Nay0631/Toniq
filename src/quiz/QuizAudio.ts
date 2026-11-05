// 音楽クイズの音（Web Audio API で直接鳴らす。曲の再生（Tone.js）とは別のオーディオコンテキスト）
// 音の高さは MIDI ノート番号（60 = C4）で受け取る

let ctx: AudioContext | null = null;
// 今鳴らしている音のまとめ先。新しい音を鳴らすとき・問題を替えるときに切り離して前の音を止める
let bus: GainNode | null = null;

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// 鳴っている音（予約済みの音も含む）を止める
export function stopQuizSound(): void {
  if (!ctx || !bus) return;
  const old = bus;
  old.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  setTimeout(() => old.disconnect(), 200);
  bus = null;
}

// 前の音を止めて、新しいまとめ先と開始時刻を返す
function begin(): { c: AudioContext; out: GainNode; t: number } {
  stopQuizSound();
  const c = audio();
  bus = c.createGain();
  bus.connect(c.destination);
  return { c, out: bus, t: c.currentTime + 0.03 };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ピアノ風の音（三角波に2倍音のサイン波を薄く重ねる）
function pianoTone(c: AudioContext, dest: AudioNode, midi: number, t: number, level: number): void {
  const freq = midiToFreq(midi);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  gain.connect(dest);

  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  osc.connect(gain);

  const overtone = c.createOscillator();
  const overtoneGain = c.createGain();
  overtone.type = "sine";
  overtone.frequency.value = freq * 2;
  overtoneGain.gain.value = 0.3;
  overtone.connect(overtoneGain).connect(gain);

  [osc, overtone].forEach(o => { o.start(t); o.stop(t + 1.15); });
}

// 和音が大きくなりすぎないよう、音数に合わせて1音の音量を下げる
function chordLevel(count: number): number {
  return 0.26 / Math.sqrt(Math.max(1, count));
}

// ===== 音程・和音 =====

// 同時に鳴らす
export function playNotes(midis: number[]): void {
  const { c, out, t } = begin();
  midis.forEach(m => pianoTone(c, out, m, t, chordLevel(midis.length)));
}

// 1音ずつ順に鳴らす
export function playMelody(midis: number[], gap = 0.55): void {
  const { c, out, t } = begin();
  midis.forEach((m, i) => pianoTone(c, out, m, t + i * gap, chordLevel(1)));
}

// 和音を順に鳴らす（コード進行）
export function playChords(chords: number[][], gap = 0.8): void {
  const { c, out, t } = begin();
  chords.forEach((midis, i) => midis.forEach(m => pianoTone(c, out, m, t + i * gap, chordLevel(midis.length))));
}

// ===== リズム =====

// アクセントの強さ（2 = 小節の頭、1 = 拍のまとまりの頭、0 = 弱拍）の並びをクリック音で鳴らす
export function playClicks(accents: number[], step: number): void {
  const { c, out, t } = begin();
  const tones = [{ freq: 900, level: 0.16 }, { freq: 1150, level: 0.24 }, { freq: 1500, level: 0.34 }];
  accents.forEach((a, i) => {
    const start = t + i * step;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = tones[a].freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(tones[a].level, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + 0.1);
  });
}

// ===== 音響 =====

// 帯域を切り出したノイズ
export function playBandNoise(freq: number, seconds = 1.2): void {
  const { c, out, t } = begin();
  const src = c.createBufferSource();
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.1;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.setTargetAtTime(0, t + seconds - 0.08, 0.02);

  src.connect(filter).connect(gain).connect(out);
  src.start(t);
  src.stop(t + seconds);
}
