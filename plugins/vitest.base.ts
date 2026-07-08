import { defineConfig } from "vitest/config";

/**
 * Shared vitest config for plugins that keep tests under tests/. Each plugin's
 * vitest.config.ts re-exports this so the test settings live in one place.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
