import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/adapter.ts", "src/executor.ts", "src/manifest.ts", "src/security.ts"],
  format: ["esm"],
  outDir: "dist",
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  shims: false,
  skipNodeModulesBundle: true,
});
