import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@eib/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@eib/knowledge": fileURLToPath(
        new URL("./packages/knowledge/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
      thresholds: {
        branches: 75,
        functions: 90,
        lines: 80,
        statements: 80,
      },
    },
  },
});
