// grow の AudioWorklet（Grow.ts が文字列として読み込み、Blob の URL にして登録する）。
// wasm（grow/wasm/grow_wasm.cpp）をこのスレッドでインスタンス化して、128 サンプルずつ描く。
//
// 音符は AudioParam の1サンプルだけの合図で受け取る（オフラインの書き出しでもサンプル単位で合う。
// port のメッセージは届くのが遅れることがあるので、音符には使わない）：
//   on  = ノート番号 + 1 + 強さ × 0.5（強さ 0〜1 を小数部に入れる）
//   off = ノート番号 + 1
// パラメーター・BPM・全部止めるは port のメッセージで受ける（時間に厳しくないもの）。
class GrowProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "on",  defaultValue: 0, automationRate: "a-rate" },
      { name: "off", defaultValue: 0, automationRate: "a-rate" },
    ];
  }

  constructor(options) {
    super();
    const { wasm, values, bpm, overlap } = options.processorOptions;
    const module  = new WebAssembly.Module(wasm);
    // STANDALONE_WASM が求める取り込み（WASI など）は使わないので、何もしない関数で埋める
    const imports = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.kind !== "function") continue;
      (imports[imp.module] ??= {})[imp.name] = () => 0;
    }
    const instance = new WebAssembly.Instance(module, imports);
    this.ex = instance.exports;
    this.ex._initialize?.();
    this.ex.grow_init(sampleRate);
    values.forEach((v, i) => this.ex.grow_set_param(i, v));
    this.ex.grow_set_bpm(bpm);

    const block = this.ex.grow_block_size();
    this.left   = new Float32Array(this.ex.memory.buffer, this.ex.grow_left(), block);
    this.right  = new Float32Array(this.ex.memory.buffer, this.ex.grow_right(), block);

    this.prevOn  = 0;
    this.prevOff = 0;
    // 前の音の off が、同じ高さの次の音の on のあとに来たときは無視する（Grow.ts は off を少し遅らせて送る）
    this.overlapFrames = Math.ceil((overlap ?? 0.002) * sampleRate) + 2;
    this.lastOnFrame   = new Float64Array(128).fill(-Infinity);
    this.alive = true;

    this.port.onmessage = e => {
      const msg = e.data;
      if (msg.type === "params") msg.values.forEach(([i, v]) => this.ex.grow_set_param(i, v));
      else if (msg.type === "bpm") this.ex.grow_set_bpm(msg.bpm);
      else if (msg.type === "allOff") this.ex.grow_all_notes_off();
      else if (msg.type === "dispose") this.alive = false;
    };
  }

  handle(onValue, offValue, frame) {
    if (onValue !== 0 && onValue !== this.prevOn) {
      const code = onValue - 1;
      const note = Math.floor(code);
      if (note >= 0 && note < 128) {
        this.ex.grow_note_on(note, Math.min(1, (code - note) * 2));
        this.lastOnFrame[note] = frame;
      }
    }
    if (offValue !== 0 && offValue !== this.prevOff) {
      const note = Math.round(offValue - 1);
      if (note >= 0 && note < 128 && frame - this.lastOnFrame[note] > this.overlapFrames) {
        this.ex.grow_note_off(note);
      }
    }
    this.prevOn  = onValue;
    this.prevOff = offValue;
  }

  process(_inputs, outputs, parameters) {
    if (!this.alive) return false;
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const n = L.length;
    const on  = parameters.on;
    const off = parameters.off;

    // 合図の変わり目で区切って描く
    let from = 0;
    for (let i = 0; i < n; i++) {
      const onValue  = on.length > 1 ? on[i] : on[0];
      const offValue = off.length > 1 ? off[i] : off[0];
      if (onValue === this.prevOn && offValue === this.prevOff) continue;
      if (i > from) this.renderTo(L, R, from, i);
      from = i;
      this.handle(onValue, offValue, currentFrame + i);
    }
    this.renderTo(L, R, from, n);
    return true;
  }

  renderTo(L, R, from, to) {
    if (to <= from) return;
    this.ex.grow_render(to - from);
    L.set(this.left.subarray(0, to - from), from);
    if (R !== L) R.set(this.right.subarray(0, to - from), from);
  }
}

registerProcessor("grow", GrowProcessor);
