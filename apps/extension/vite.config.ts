import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { buildManifest } from "./manifest.ts";

// MV3 needs three builds, and this is the first: the side panel (an ordinary HTML
// document) and the service worker (a module), which may share chunks freely. The other
// two are single self-contained files and are built separately — the extractor in
// vite.extract.config.ts, the content script in vite.content.config.ts.
//
// CRXJS would cover all of it, but the spec ties us to Vite and not to CRXJS, and a
// forty-line plugin is cheaper to own than a plugin whose maintenance has stalled
// before.

const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"));

function emitManifest(): Plugin {
  return {
    name: "make-it-shorter:manifest",
    apply: "build",
    closeBundle() {
      const manifest = buildManifest(packageJson.version);
      if (!manifest.key) {
        this.warn(
          "manifest has no key: this build gets a random extension id and the API will answer 403. " +
            "Set EXTENSION_KEY to the public key of the Chrome Web Store item.",
        );
      }
      writeFileSync(resolve(import.meta.dirname, "dist/manifest.json"), JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), emitManifest()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        background: resolve(import.meta.dirname, "src/background/index.ts"),
      },
      output: {
        // Fixed names: the manifest names these files, so a hash in them would break it.
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
