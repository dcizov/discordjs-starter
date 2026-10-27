import { getCommandCatalog } from "@orbit/core/command-catalog";
import { sourceFileLink } from "@orbit/core/source-links";
import type { CommandModule } from "@orbit/core/command-catalog-types";
import type { CommandContext } from "./context";
import { helpCommandCard, helpOverviewCard } from "../interactions/replies";

/** Documentation page per module. Content lives in `docs/`, not in this file. */
const MODULE_DOCS: Record<CommandModule, { slug: string; file: string }> = {
  general: { slug: "commands", file: "COMMANDS.md" },
  roles: { slug: "commands", file: "COMMANDS.md" },
  music: { slug: "music", file: "MUSIC.md" },
  economy: { slug: "commands", file: "COMMANDS.md" },
  deals: { slug: "deals", file: "DEALS.md" },
  news: { slug: "news", file: "NEWS-FORMATTING.md" },
  moderation: { slug: "permissions", file: "PERMISSIONS.md" },
  polls: { slug: "commands", file: "COMMANDS.md" },
  announcements: { slug: "commands", file: "COMMANDS.md" },
  xp: { slug: "leveling", file: "LEVELING.md" },
};

/**
 * Docs base URL.
 *
 * `APP_URL` is the operator's own dashboard, so its `/docs` pages are the right
 * target when it is a public HTTPS origin. Otherwise the public repository copy is
 * linked rather than a localhost URL that only the server can open.
 */
export function helpDocsUrl(
  module: CommandModule,
  appUrl = process.env.APP_URL
) {
  const base = appUrl?.replace(/\/+$/, "");
  const doc = MODULE_DOCS[module];
  if (
    base &&
    base.startsWith("https://") &&
    !/localhost|127\.0\.0\.1/.test(base)
  )
    return `${base}/docs/${doc.slug}`;
  // Same helper as the docs site: one repository URL, one configured ref.
  return sourceFileLink(`docs/${doc.file}`);
}

/**
 * `/help` — the catalog is `getCommandCatalog()`, derived from the same builders
 * `commands:register` uploads, so a command cannot appear in one and not the other.
 * Everything is ephemeral (the dispatcher defers ephemerally), because the answer
 * describes this server's configuration and the member's own access.
 */
export async function helpCommand(context: CommandContext) {
  const catalog = getCommandCatalog(context.config);
  const requested = context.i.options
    .getString("command")
    ?.trim()
    .toLowerCase();
  if (!requested) {
    await context.reply(helpOverviewCard(catalog, helpDocsUrl("general")));
    return;
  }
  const command = catalog.commands.find(
    (entry) =>
      entry.path === requested ||
      (entry.root === requested && entry.path === entry.root)
  );
  if (!command) {
    await context.reply(
      `No command named \`/${requested.replace(/[`@<>]/g, "")}\`. Run \`/help\` for the list.`
    );
    return;
  }
  await context.reply(helpCommandCard(command, helpDocsUrl(command.module)));
}
