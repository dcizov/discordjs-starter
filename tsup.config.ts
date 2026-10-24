import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    bot: "apps/bot/src/index.ts",
    register: "apps/bot/src/register.ts",
    "export-channels": "apps/bot/src/export-channels.ts",
    worker: "apps/worker/src/index.ts",
    migrate: "packages/db/src/migrate.ts",
  },
  outDir: "dist",
  format: ["cjs"],
  platform: "node",
  target: "node22",
  splitting: false,
  clean: true,
  sourcemap: true,
  external: ["shoukaku"],
});
