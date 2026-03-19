import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "core/index": "src/core/index.ts",
    "core/renderer": "src/core/renderer.tsx",
    "core/BlocksProvider": "src/core/BlocksProvider.tsx",
    "core/EnhancedBlocksRenderer": "src/core/EnhancedBlocksRenderer.tsx",
    "registry/index": "src/registry/index.ts",
    "types/index": "src/types/index.ts",
    "utils/index": "src/utils/index.ts",
    "renderers/index": "src/renderers/index.ts",
    "renderers/pressable-renderer": "src/renderers/pressable-renderer.tsx",
    "renderers/button-renderer": "src/renderers/button-renderer.tsx",
    "renderers/link-renderer": "src/renderers/link-renderer.tsx",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: [
    "react",
    "react-dom",
    "@opensite/ui",
    "@page-speed/img",
    "@page-speed/video",
    "@page-speed/pressable",
    "@page-speed/router",
  ],
  esbuildOptions(options) {
    options.banner = {
      js: '"use client";',
    };
  },
});
