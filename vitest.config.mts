import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
const path = (p: string) => new URL(p, import.meta.url).pathname;
export default defineConfig({
  // The repository is a Next app, so no React plugin is wired up for Vite.
  // Component tests import `.tsx` directly and need the JSX transform and the
  // automatic runtime, which is what this supplies.
  plugins: [react()],
  test: {
    environment: "node",
    // `.tsx` is included because component tests need JSX; the DOM-dependent
    // ones opt in per file with `@vitest-environment jsdom` so the rest of the
    // suite keeps running in plain node.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
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
