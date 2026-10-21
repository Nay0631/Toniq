/*import * as Tone from "tone";

// ===== WAVヘッダー生成 =====
function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate  = buffer.sampleRate;
  const bitDepth    = 16;
  const numSamples  = buffer.length;
  const byteRate    = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign  = numChannels * (bitDepth / 8);
  const dataSize    = numSamples * numChannels * (bitDepth / 8);
  const bufferSize  = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view        = new DataView(arrayBuffer);

  // RIFFヘッダー
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0,  "RIFF");
  view.setUint32(4,  bufferSize - 8, true);
  writeStr(8,  "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16,           true); // fmtチャンクサイズ
  view.setUint16(20, 1,            true); // PCM形式
  view.setUint16(22, numChannels,  true);
  view.setUint32(24, sampleRate,   true);
  view.setUint32(28, byteRate,     true);
  view.setUint16(32, blockAlign,   true);
  view.setUint16(34, bitDepth,     true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  // PCMデータを書き込む（インターリーブ）
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = buffer.getChannelData(ch)[i];
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ===== WAVエクスポート本体 =====
export async function exportWav(
  renderFn: (context: Tone.OfflineContext) => Promise<void>,
  durationSec: number,
  filename: string = "toniq_export.wav"
): Promise<void> {
  console.log(`WAVレンダリング開始 (${durationSec}秒)`);

  // OfflineContextでレンダリング
  const offlineContext = new Tone.OfflineContext(2, durationSec, 44100);
  await renderFn(offlineContext);
  const audioBuffer = await offlineContext.render();

  console.log("レンダリング完了・WAV変換中");

  // WAVに変換してダウンロード
  const blob = encodeWav(audioBuffer);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  console.log("WAVダウンロード完了");
}*/