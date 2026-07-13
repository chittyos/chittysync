import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only run source tests, not compiled dist/ tests
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    environment: "node",
  },
});
