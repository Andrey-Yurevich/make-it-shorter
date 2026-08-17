import { resolve } from "node:path";
import { defineConfig } from "vite";

// The lazy extractor gets a build of its own so that it comes out as one self-contained
// module. Built together with the rest, it ends up importing a shared chunk — and that
// chunk is neither web-accessible nor stably named, so the import would fail inside the
// page at exactly the moment a whole page is being read.
//
// Runs after the main build: it must not empty dist or copy public/ again.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/extract.ts"),
      formats: ["es"],
      fileName: () => "extract.js",
    },
  },
  publicDir: false,
});
