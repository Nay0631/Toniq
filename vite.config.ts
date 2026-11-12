import { defineConfig } from "vite";
import electron from "vite-plugin-electron";

export default defineConfig({
  plugins: [
    electron([
      {
        entry: "electron/main.ts",
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        // preload はサンドボックスで動くので CommonJS（preload.cjs）にする
        entry: "electron/preload.ts",
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            lib: { entry: "electron/preload.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
  ],
  build: {
    outDir: "dist",
  },
});
