#!/usr/bin/env node
/**
 * Fail fast when the shared dependency tree is missing packages Orbit needs.
 *
 * Why this exists: every workspace is intentionally dependency-free and all
 * third-party packages are declared once in the root `package.json`
 * (`next`, `marked`, `discord.js`, …). The documented Docker workflow seeds a
 * **named volume** at `/app/node_modules`. A volume created by an older image
 * keeps masking the freshly installed tree, so a package added to the root
 * manifest later ("marked", used by the in-app documentation renderer) is
 * present in the image but invisible to the build, and webpack reports only
 * `Module not found: Can't resolve 'marked'` with an import trace.
 *
 * The check is deliberately boring: it resolves a short list of build/runtime
 * critical packages and prints one remediation block. It never prints tokens or
 * environment values, and it runs before `dev`, `build`, `start` and `test`.
 *
 * Only production dependencies belong in this list — `npm start` runs in the
 * runtime image where devDependencies are pruned.
 */
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/** Packages whose absence breaks a build or a service at startup. */
export const REQUIRED_DEPENDENCIES = [
  // Web build + prerendered documentation.
  "next",
  "react",
  "react-dom",
  "marked",
  "sanitize-html",
  // Shared domain/runtime packages used by web, bot and worker.
  "discord.js",
  "drizzle-orm",
  "zod",
  "bullmq",
  "ioredis",
];

export const REMEDIATION = [
  "node_modules does not match package.json.",
  "",
  "Host or CI checkout:",
  "  npm ci",
  "",
  "Docker Compose checkouts rebuild the image but reuse named volumes, so an",
  "old dependency volume keeps masking the new tree. Remove only that volume",
  "(never the database volume), then rebuild:",
  "  docker volume ls | grep dev_node_modules",
  "  docker volume rm <project>_dev_node_modules",
  "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build",
  "",
  "Dev Container: rebuild the container, or delete the named node_modules",
  "volume in Docker Desktop and reopen the workspace.",
  "",
  "Why this happens: all dependencies are declared once in the root",
  "package.json. A volume created before a dependency was added still has the",
  "old tree; `npm install` inside the container does not fix a masked volume.",
].join("\n");

/**
 * @param {{ resolve: (id: string) => string, list?: string[] }} options
 * @returns {{ missing: string[] }}
 */
export function checkDependencies({ resolve, list = REQUIRED_DEPENDENCIES }) {
  const missing = [];
  for (const id of list) {
    try {
      resolve(id);
    } catch {
      missing.push(id);
    }
  }
  return { missing };
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const require = createRequire(import.meta.url);
  const { missing } = checkDependencies({
    resolve: (id) => require.resolve(id),
  });
  if (missing.length) {
    console.error(
      `\nOrbit cannot start: ${missing.join(", ")} not found in node_modules.\n\n${REMEDIATION}\n`
    );
    process.exit(1);
  }
}
