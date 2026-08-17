import { resolve } from "node:path";
import { defineConfig } from "vite";

// The content script alone, and separately from everything else, because it is the one
// bundle Chrome loads as a classic script: no imports, no code splitting, one file.
// Readability is not in here — it arrives through a dynamic import() of extract.js,
// which the first build emits as a module.
//
// Runs after the main build, so it must not empty dist or copy public/ a second time.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "makeItShorterContent",
      fileName: () => "content.js",
    },
  },
  publicDir: false,
});
