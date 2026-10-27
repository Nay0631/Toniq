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
    ]),
  ],
  build: {
    outDir: "dist",
  },
});