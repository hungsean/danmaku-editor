import { defineConfig } from "vite"
import { copyFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

// content script 必須是單一 IIFE 檔案：MV3 的 content_scripts 不支援 ES module。
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "extension/content/main.ts"),
      output: {
        format: "iife",
        entryFileNames: "content.js",
        assetFileNames: "[name][extname]",
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    {
      name: "copy-manifest",
      closeBundle() {
        mkdirSync(resolve(__dirname, "dist"), { recursive: true })
        copyFileSync(
          resolve(__dirname, "extension/manifest.json"),
          resolve(__dirname, "dist/manifest.json"),
        )
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
