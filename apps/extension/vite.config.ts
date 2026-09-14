import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { buildManifest } from "./manifest.ts";

// MV3 needs two builds. This is the first: the side panel and the output window (two
// ordinary HTML documents) and the service worker (a module), which may share chunks
// freely. The content script is one self-contained classic script and is built
// separately by vite.content.config.ts.
//
// CRXJS would cover all of it, but a forty-line plugin is cheaper to own than a plugin
// whose maintenance has stalled before.

function emitManifest(): Plugin {
  return {
    name: "make-it-shorter:manifest",
    apply: "build",
    closeBundle() {
      const manifest = buildManifest();
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
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        output: resolve(import.meta.dirname, "output.html"),
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
