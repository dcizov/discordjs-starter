import { defineConfig } from "vitest/config";

// TEST_DATABASE_URL wins so tests keep their own database when the app runs
// with DATABASE_URL pointed at the dev database (for example inside compose).
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/bot_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: databaseUrl,
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
