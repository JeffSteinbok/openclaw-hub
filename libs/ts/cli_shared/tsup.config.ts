import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/runtime.ts", "src/generate-cli.ts"],
  format: ["esm"],
  outDir: "dist",
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  shims: false,
});
