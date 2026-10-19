import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://postgres:postgres@localhost:5432/bot_test",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/deploy-commands.ts",
        "src/db/seed.ts",
        "src/**/*.test.ts",
        "src/types/**",
      ],
    },
  },
});
