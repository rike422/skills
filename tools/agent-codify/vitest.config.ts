import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/index.ts", "src/claude.ts"],
      thresholds: {
        statements: 70,
        branches: 45,
        functions: 70,
        lines: 70
      }
    }
  }
});
