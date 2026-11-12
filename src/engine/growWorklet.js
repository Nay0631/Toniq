// grow の AudioWorklet（Grow.ts が文字列として読み込み、Blob の URL にして登録する）。
// wasm（grow/wasm/grow_wasm.cpp）をこのスレッドでインスタンス化して、128 サンプルずつ描く。
// 1つのノードで複数の音色（スロット。最大 MAX_SLOTS）を鳴らす（マルチティンバー）。スロットごとに出力（左右）を1つ持つ。
// スロットの最初の値・BPM はノードを作るときの processorOptions で受ける（書き出しでも確実に間に合う）。
//
// 音符はスロットごとの AudioParam の1サンプルだけの合図で受け取る（オフラインの書き出しでもサンプル単位で合う。
// port のメッセージは届くのが遅れることがあるので、音符には使わない）：
//   on{n}  = ノート番号 + 1 + 強さ × 0.5（強さ 0〜1 を小数部に入れる）
//   off{n} = ノート番号 + 1
// 時刻を決めて当てるパラメーター（GrowInstrument.setParamAtTime）も同じく合図で受ける：
//   pidx{n} = パラメーターの番号 + 1（1サンプルだけ）、pval{n} = そのサンプルの値
// 同じサンプルでは パラメーター → 発音・消音 の順に当てる。
// すぐ当てればよいパラメーター（音作りのパネル）・BPM・スロットを閉じるは port のメッセージで受ける。
const MAX_SLOTS = 16;

class GrowProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const list = [];
    for (let s = 0; s < MAX_SLOTS; s++) {
      for (const name of ["on", "off", "pidx", "pval"]) {
        list.push({ name: `${name}${s}`, defaultValue: 0, automationRate: "a-rate" });
      }
    }
    return list;
  }

  constructor(options) {
    super();
    const { wasm, slots, overlap } = options.processorOptions;
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
    this.ex.grow_set_sample_rate(sampleRate);
    this.paramCount = this.ex.grow_param_count();
    this.block      = this.ex.grow_block_size();

    // 前の音の off が、同じ高さの次の音の on のあとに来たときは無視する（Grow.ts は off を少し遅らせて送る）
    this.overlapFrames = Math.ceil((overlap ?? 0.002) * sampleRate) + 2;

    // スロットごとの状態（開いているか・直前の合図・音ごとの最後の on の位置）
    this.slots = slots.map(({ values, bpm }, s) => {
      this.ex.grow_open(s);
      values.forEach((v, i) => this.ex.grow_set_param_slot(s, i, v));
      this.ex.grow_set_bpm_slot(s, bpm);
      return { open: true, prevOn: 0, prevOff: 0, prevPidx: 0, lastOnFrame: new Float64Array(128).fill(-Infinity) };
    });
    this.openCount = this.slots.length;
    this.views();

    this.port.onmessage = e => {
      const msg = e.data;
      const slot = this.slots[msg.slot];
      if (!slot?.open) return;
      if (msg.type === "params") msg.values.forEach(([i, v]) => this.ex.grow_set_param_slot(msg.slot, i, v));
      else if (msg.type === "bpm") this.ex.grow_set_bpm_slot(msg.slot, msg.bpm);
      else if (msg.type === "allOff") this.ex.grow_all_notes_off_slot(msg.slot);
      else if (msg.type === "close") {
        this.ex.grow_close(msg.slot);
        slot.open = false;
        this.openCount--;
      }
    };
  }

  // wasm の出力の場所を指す配列（メモリが伸びると ArrayBuffer が差し替わるので、そのたびに作り直す）
  views() {
    if (this.left && this.left.buffer === this.ex.memory.buffer) return;
    this.left  = new Float32Array(this.ex.memory.buffer, this.ex.grow_left(), this.block);
    this.right = new Float32Array(this.ex.memory.buffer, this.ex.grow_right(), this.block);
  }

  handle(s, slot, pidxValue, pvalValue, onValue, offValue, frame) {
    if (pidxValue !== 0 && pidxValue !== slot.prevPidx) {
      const index = Math.round(pidxValue - 1);
      if (index >= 0 && index < this.paramCount) this.ex.grow_set_param_slot(s, index, pvalValue);
    }
    if (onValue !== 0 && onValue !== slot.prevOn) {
      const code = onValue - 1;
      const note = Math.floor(code);
      if (note >= 0 && note < 128) {
        this.ex.grow_note_on_slot(s, note, Math.min(1, (code - note) * 2));
        slot.lastOnFrame[note] = frame;
      }
    }
    if (offValue !== 0 && offValue !== slot.prevOff) {
      const note = Math.round(offValue - 1);
      if (note >= 0 && note < 128 && frame - slot.lastOnFrame[note] > this.overlapFrames) {
        this.ex.grow_note_off_slot(s, note);
      }
    }
    slot.prevPidx = pidxValue;
    slot.prevOn   = onValue;
    slot.prevOff  = offValue;
  }

  process(_inputs, outputs, parameters) {
    if (this.openCount <= 0) return false;  // 全部のスロットを閉じたら終わり
    this.views();
    const at = (values, i) => (values.length > 1 ? values[i] : values[0]);

    this.slots.forEach((slot, s) => {
      if (!slot.open) return;
      const out = outputs[s];
      const L = out[0];
      const R = out[1] ?? out[0];
      const n = L.length;
      const on   = parameters[`on${s}`];
      const off  = parameters[`off${s}`];
      const pidx = parameters[`pidx${s}`];
      const pval = parameters[`pval${s}`];

      // 合図の変わり目で区切って描く
      let from = 0;
      for (let i = 0; i < n; i++) {
        const onValue   = at(on, i);
        const offValue  = at(off, i);
        const pidxValue = at(pidx, i);
        if (onValue === slot.prevOn && offValue === slot.prevOff && pidxValue === slot.prevPidx) continue;
        if (i > from) this.renderTo(s, L, R, from, i);
        from = i;
        this.handle(s, slot, pidxValue, at(pval, i), onValue, offValue, currentFrame + i);
      }
      this.renderTo(s, L, R, from, n);
    });
    return true;
  }

  renderTo(s, L, R, from, to) {
    if (to <= from) return;
    this.ex.grow_render_slot(s, to - from);
    L.set(this.left.subarray(0, to - from), from);
    if (R !== L) R.set(this.right.subarray(0, to - from), from);
  }
}

registerProcessor("grow", GrowProcessor);
