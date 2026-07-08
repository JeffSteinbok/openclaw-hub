import { defineConfig } from "tsup";

/**
 * Shared tsup config for all plugins. Each plugin's tsup.config.ts re-exports
 * this so the build settings live in one place.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/adapter.ts", "src/handlers.ts"],
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
