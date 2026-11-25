// grow の AudioWorklet（Grow.ts が文字列として読み込み、Blob の URL にして登録する）。
// wasm（grow/wasm/grow_wasm.cpp）をこのスレッドでインスタンス化して、128 サンプルずつ描く。
// 1つのノードで複数の音色（スロット。最大 MAX_SLOTS）を鳴らす（マルチティンバー）。スロットごとに出力（左右）を1つ持つ。
// ノードと一緒に開くスロットの最初の値・BPM は processorOptions で受ける（書き出しでも確実に間に合う）。
// 再生用のノード（keep）は、全部のスロットを閉じても残り、空いたスロットを open のメッセージで開き直して使い回す。
// ノードを作り直すと、この（オーディオ）スレッドで wasm とエンジンの準備に数 ms かかり、鳴っている音が途切れることがあるため
//
// 音符はスロットごとの AudioParam の1サンプルだけの合図で受け取る（オフラインの書き出しでもサンプル単位で合う。
// port のメッセージは届くのが遅れることがあるので、音符には使わない）：
//   on{n}  = ノート番号 + 1 + 強さ × 0.5（強さ 0〜1 を小数部に入れる）
//   off{n} = ノート番号 + 1
// 時刻を決めて当てるパラメーター（GrowInstrument.setParamAtTime）も同じく合図で受ける：
//   pidx{n} = パラメーターの番号 + 1（1サンプルだけ）、pval{n} = そのサンプルの値
// 同じサンプルでは パラメーター → 発音・消音 の順に当てる。
// すぐ当てればよいパラメーター（音作りのパネル）・BPM・スロットを開く／閉じるは port のメッセージで受ける。
// 毎ブロック呼ばれる所では、文字列・配列・関数を新しく作らない（ごみ集めで音が途切れないように）
const MAX_SLOTS = 16;

// パラメーターの名前（スロットごと。毎ブロック文字列を作らないよう、先に作っておく）
const PARAM_NAMES = Array.from({ length: MAX_SLOTS }, (_, s) => ({ on: `on${s}`, off: `off${s}`, pidx: `pidx${s}`, pval: `pval${s}` }));

class GrowProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAM_NAMES.flatMap(names => Object.values(names).map(name => ({ name, defaultValue: 0, automationRate: "a-rate" })));
  }

  constructor(options) {
    super();
    const { wasm, slots, overlap, keep } = options.processorOptions;
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
    this.keep       = keep === true;

    // 前の音の off が、同じ高さの次の音の on のあとに来たときは無視する（Grow.ts は off を少し遅らせて送る）
    this.overlapFrames = Math.ceil((overlap ?? 0.002) * sampleRate) + 2;

    // スロットごとの状態（開いていないスロットは open が false）
    this.slots = PARAM_NAMES.map(() => ({
      open: false, sync: false, prevOn: 0, prevOff: 0, prevPidx: 0,
      lastOnFrame: new Float64Array(128), held: new Uint8Array(128), retrig: new Uint8Array(128),
    }));
    this.openCount = 0;
    slots.forEach(({ values, bpm }, s) => this.openSlot(s, values, bpm, false));
    this.views();

    this.port.onmessage = e => this.receive(e.data);
  }

  receive(msg) {
    if (msg.type === "open") {
      this.openSlot(msg.slot, msg.values, msg.bpm, true);
      this.port.postMessage({ type: "opened", slot: msg.slot, id: msg.id });
      return;
    }
    const slot = this.slots[msg.slot];
    if (!slot?.open) return;
    if (msg.type === "params") msg.values.forEach(([i, v]) => this.ex.grow_set_param_slot(msg.slot, i, v));
    else if (msg.type === "bpm") this.ex.grow_set_bpm_slot(msg.slot, msg.bpm);
    else if (msg.type === "allOff") {
      this.ex.grow_all_notes_off_slot(msg.slot);
      slot.held.fill(0);
      slot.retrig.fill(0);
    }
    else if (msg.type === "close") {
      this.ex.grow_close(msg.slot);
      slot.open = false;
      this.openCount--;
    }
  }

  // スロットを開く（エンジンを作り、音作りの値・BPM を当てる）。
  // sync なら、次のブロックの最初のサンプルに残っている値は読まない：使い回すスロットの AudioParam に前の音色の合図が
  // 残っていても鳴らさないため（前の音色の合図は Grow.ts の dispose でも消している）
  openSlot(s, values, bpm, sync) {
    const slot = this.slots[s];
    if (!slot.open) this.openCount++;
    this.ex.grow_open(s);
    for (let i = 0; i < values.length; i++) this.ex.grow_set_param_slot(s, i, values[i]);
    this.ex.grow_set_bpm_slot(s, bpm);
    slot.open = true;
    slot.sync = sync;
    slot.prevOn = slot.prevOff = slot.prevPidx = 0;
    // 音ごとの最後の on の位置・押している（on のあと off がない）か・押したまま弾き直したか
    slot.lastOnFrame.fill(-Infinity);
    slot.held.fill(0);
    slot.retrig.fill(0);
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
        slot.retrig[note] = slot.held[note];
        slot.held[note]   = 1;
      }
    }
    if (offValue !== 0 && offValue !== slot.prevOff) {
      const note = Math.round(offValue - 1);
      if (note >= 0 && note < 128) {
        // 前の音の off が、同じ高さを押したまま弾き直した次の音の on の直後に来たときだけ無視する
        // （弾き直しでない音の off は捨てない。捨てると鳴りっぱなしになる）
        if (slot.retrig[note] && frame - slot.lastOnFrame[note] <= this.overlapFrames) {
          slot.retrig[note] = 0;
        } else {
          this.ex.grow_note_off_slot(s, note);
          slot.held[note]   = 0;
          slot.retrig[note] = 0;
        }
      }
    }
    slot.prevPidx = pidxValue;
    slot.prevOn   = onValue;
    slot.prevOff  = offValue;
  }

  process(_inputs, outputs, parameters) {
    if (this.openCount <= 0) return this.keep;  // 全部のスロットを閉じたら終わり（再生用は残して使い回す）
    this.views();
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (this.slots[s].open && outputs[s]) this.renderSlot(s, outputs[s], parameters);
    }
    return true;
  }

  renderSlot(s, out, parameters) {
    const slot = this.slots[s];
    const L = out[0];
    const R = out[1] ?? out[0];
    const n = L.length;
    const names = PARAM_NAMES[s];
    const on = parameters[names.on], off = parameters[names.off], pidx = parameters[names.pidx], pval = parameters[names.pval];
    // 変化のない AudioParam は値が1つだけ
    const onLast = on.length - 1, offLast = off.length - 1, pidxLast = pidx.length - 1, pvalLast = pval.length - 1;

    if (slot.sync) {
      // 開き直した直後：最初のサンプルに残っている値は、前の音色の合図なので読まない。
      // 次のサンプルからは読む（opened を受けた Grow.ts の合図は、いちばん早いとここに入る）
      slot.sync = false;
      slot.prevOn   = on[0];
      slot.prevOff  = off[0];
      slot.prevPidx = pidx[0];
    }

    // 合図の変わり目で区切って描く
    let from = 0;
    for (let i = 0; i < n; i++) {
      const onValue   = on[Math.min(i, onLast)];
      const offValue  = off[Math.min(i, offLast)];
      const pidxValue = pidx[Math.min(i, pidxLast)];
      if (onValue === slot.prevOn && offValue === slot.prevOff && pidxValue === slot.prevPidx) continue;
      if (i > from) this.renderTo(s, L, R, from, i);
      from = i;
      this.handle(s, slot, pidxValue, pval[Math.min(i, pvalLast)], onValue, offValue, currentFrame + i);
    }
    this.renderTo(s, L, R, from, n);
  }

  renderTo(s, L, R, from, to) {
    const n = to - from;
    if (n <= 0) return;
    this.ex.grow_render_slot(s, n);
    // 区切らずに描いたとき（ほとんどのブロック）は、配列を作らずにそのまま写す
    L.set(n === this.block ? this.left : this.left.subarray(0, n), from);
    if (R !== L) R.set(n === this.block ? this.right : this.right.subarray(0, n), from);
  }
}

registerProcessor("grow", GrowProcessor);
