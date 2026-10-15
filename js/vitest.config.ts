import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["@testing-library/jest-dom/vitest"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 15_000,
  },
});
