import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// テスト（npm test）。vite.config.ts（Electron の起動）は使わない。
// Tone.js は Web Audio API が前提で Node では動かないので、テストでは tests/stubs/tone.ts に差し替える
export default defineConfig({
  resolve: {
    alias: { tone: fileURLToPath(new URL("./tests/stubs/tone.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
