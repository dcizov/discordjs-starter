#!/usr/bin/env node
/**
 * Fail fast when the shared dependency tree does not match the manifest.
 *
 * Every third-party package Orbit uses is declared once in the root
 * `package.json`; the workspaces are dependency-free. Two provisioning paths can
 * therefore be *behind* the manifest without the manifest itself being wrong:
 *
 * - a host checkout that has not run `npm ci` since a dependency was added;
 * - the Docker dev stack, where `dev_node_modules` is mounted at
 *   `/app/node_modules`. Docker seeds that volume from the image only on its
 *   first use; a volume created by an older image keeps its old contents while
 *   the image underneath is rebuilt.
 *
 * In both cases the only symptom is a deep build error
 * (`Module not found: Can't resolve 'marked'`, import trace
 * `lib/docs-content.ts → app/docs/layout.tsx`). This check runs in ~50 ms,
 * before `dev`/`build`/`build:web`/`start`, and prints the packages and the
 * remedy instead.
 *
 * What it is not: it installs nothing, never edits the lockfile, and is not a
 * package-manager replacement. It only reports that the tree is incomplete.
 */
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packages whose absence breaks a build or a service at startup.
 *
 * Only production dependencies belong here: `npm start` runs in the runtime
 * image, where devDependencies are pruned.
 */
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

/**
 * Verified remedy text (no environment values, no volume deletion beyond the
 * dependency volume).
 *
 * Order matters. `npm ci` inside a running dev container does repair the volume:
 * Compose mounts the volume at `/app/node_modules`, which *is* the directory npm
 * installs into, and the bind-mounted checkout supplies the current
 * `package-lock.json`. Recreating the volume is only for the cases where npm
 * cannot write to it (a volume created by a different user, or a read-only
 * mount).
 */
export const REMEDIATION = [
  "Dependencies are missing from node_modules. Install from the current lockfile:",
  "",
  "  npm ci",
  "",
  "Host or CI checkout: run that in the repository root.",
  "",
  "Docker Compose / Dev Container: run it inside the running container, which is",
  "the same install location as the mounted dependency volume:",
  "",
  "  docker compose exec web npm ci",
  "  # Dev Container: npm ci in the workspace terminal",
  "",
  "If npm cannot write to the volume (for example it reports EACCES because the",
  "volume was created by another user), recreate only the dependency volume:",
  "",
  "  docker volume ls | grep dev_node_modules",
  "  docker volume rm <compose-project>_dev_node_modules",
  "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build",
  "",
  "Never delete the database, Redis, demo-data or Next-cache volumes, and never",
  "use `docker compose down -v`: the new volume is seeded from a fresh image",
  "build.",
].join("\n");

/**
 * @param {{ resolve: (id: string) => unknown, list?: readonly string[] }} options
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

// Compare resolved paths, not suffixes: `process.argv[1]` may be relative.
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
