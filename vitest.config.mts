import { defineConfig } from "vitest/config";
const path = (p: string) => new URL(p, import.meta.url).pathname;
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      { find: /^@\/(.+)$/, replacement: path("./apps/web/") + "$1" },
      {
        find: /^@orbit\/core$/,
        replacement: path("./packages/core/src/index.ts"),
      },
      {
        find: /^@orbit\/core\/(.+)$/,
        replacement: path("./packages/core/src/") + "$1.ts",
      },
      { find: /^@orbit\/db$/, replacement: path("./packages/db/src/index.ts") },
      {
        find: /^@orbit\/db\/src\/(.+)$/,
        replacement: path("./packages/db/src/") + "$1.ts",
      },
    ],
  },
});
