// Server-only source of truth. Do not import Discord builders into client components.
import {
  ApplicationCommandOptionType as OptionType,
  PermissionFlagsBits,
  type APIApplicationCommandOption,
} from "discord.js";
import { commandDefinitions } from "./commands";
import type {
  CommandArgument,
  CommandCatalog,
  CommandModule,
  CommandReference,
} from "./command-catalog-types";
import type { GuildConfig } from "./types";

const moduleRoots: Record<CommandModule, readonly string[]> = {
  general: ["ping", "help"],
  roles: ["roles", "role-panel"],
  moderation: ["warn", "timeout", "kick", "ban", "purge", "cases"],
  economy: [
    "balance",
    "daily",
    "transfer",
    "leaderboard",
    "shop",
    "inventory",
    "transactions",
  ],
  music: [
    "play",
    "search",
    "queue",
    "pause",
    "resume",
    "skip",
    "stop",
    "shuffle",
    "volume",
    "repeat",
    "seek",
  ],
  deals: ["deals"],
  news: ["news"],
  polls: ["poll"],
  announcements: ["announce"],
};
function moduleFor(root: string): CommandModule {
  const entry = Object.entries(moduleRoots).find(([, names]) =>
    names.includes(root)
  );
  if (!entry)
    throw new Error(
      `Command /${root} needs a reference module classification.`
    );
  return entry[0] as CommandModule;
}
function argumentsFor(
  options: APIApplicationCommandOption[]
): CommandArgument[] {
  return options.map((o) => {
    if (
      o.type === OptionType.Subcommand ||
      o.type === OptionType.SubcommandGroup
    )
      throw new Error(
        "Subcommands must be flattened before serializing arguments."
      );
    return {
      name: o.name,
      description: o.description,
      type: OptionType[o.type],
      required: o.required ?? false,
      autocomplete: "autocomplete" in o && o.autocomplete === true,
      choices:
        "choices" in o
          ? (o.choices ?? []).map(({ name, value }) => ({ name, value }))
          : [],
      minLength: "min_length" in o ? (o.min_length ?? null) : null,
      maxLength: "max_length" in o ? (o.max_length ?? null) : null,
      minValue: "min_value" in o ? (o.min_value ?? null) : null,
      maxValue: "max_value" in o ? (o.max_value ?? null) : null,
    };
  });
}
function permissionsFor(bitfield: string | null | undefined) {
  const bits = BigInt(bitfield ?? "0");
  const seen = new Set<bigint>();
  const names = Object.entries(PermissionFlagsBits)
    .filter(([, flag]) => {
      if (seen.has(flag) || (bits & flag) !== flag) return false;
      seen.add(flag);
      return true;
    })
    .map(([name]) => name);
  return { bitfield: bitfield ?? null, names };
}
function runtimeNotes(path: string, module: CommandModule) {
  const notes: string[] = [];
  const runtimePermissions: string[] = [];
  if (module === "polls" || module === "announcements") {
    runtimePermissions.push("ManageGuild");
    notes.push(
      "Fresh Manage Server membership, manager channel visibility, installation, module, revision and destination permissions are checked at execution. Create/edit drafts in the dashboard. New modules default off, including legacy configurations. Lists, cancellation and poll refresh/close remain available while paused; publication does not. No blind resend after unconfirmed delivery."
    );
  }
  if (module === "roles")
    notes.push(
      "Role hierarchy, managed roles, panel settings, and the bot’s Manage Roles permission are checked when assigning or publishing roles."
    );
  if (module === "moderation")
    notes.push(
      "Actions check actor and bot permissions, role hierarchy, protected targets, and the moderation module. Case history remains readable when the module is paused."
    );
  if (module === "economy")
    notes.push(
      path === "transactions"
        ? "Private authenticated-user ledger only, within this server. Available while the economy is paused; no account selector and no new transactions are created."
        : "The economy module must be enabled. Balances, cooldowns, transfer settings, purchase entitlements, and role delivery permissions are checked at execution."
    );
  if (module === "music")
    notes.push(
      path === "queue"
        ? "Reads the queue snapshot; it does not start audio. Queue history can be read even when the music module is paused."
        : path === "search"
          ? "Searches the same approved sources as /play and lists up to five tracks to choose from. Each menu belongs to the member who ran it, works once, and expires after two minutes; the chosen tracks are re-checked and queue admission applies, so nothing is queued twice."
          : path === "seek"
            ? "Requires an active player with a known duration. Live or unknown-length sources cannot seek. The position is clamped to the track, and playback resumes from the server-reported position."
            : "Requires the music module, a configured Lavalink backend, an approved source, and a voice channel. Same-room, DJ-role, Connect, and Speak checks apply at execution."
    );
  if (module === "deals")
    notes.push(
      "Requires the deals module and a server-side IsThereAnyDeal API key for live data. Rich search/info/now replies are ephemeral previews, not channel posts. General feeds require top-500 ITAD popularity membership plus configured Steam reviews/score; missing evidence is excluded. Feeds/watchlists belong to this server."
    );
  if (module === "news")
    notes.push(
      "Requires the news module and a source configured in this server. A source test fetches a preview; it does not deliver a Discord message."
    );
  if (
    ["deals watch", "deals feed", "deals pause", "news test"].includes(path)
  ) {
    runtimePermissions.push("ManageGuild");
    notes.push(
      "Manage Server is enforced at execution for this subcommand, even though its parent command is visible to everyone by default."
    );
  }
  return { notes, runtimePermissions };
}

/** Derived from exactly the builders used by commands:register, not Discord's live registry. */
export function getCommandCatalog(config: GuildConfig): CommandCatalog {
  const references: CommandReference[] = [];
  for (const builder of commandDefinitions) {
    const definition = builder.toJSON();
    const category = moduleFor(definition.name);
    const add = (
      path: string[],
      description: string,
      options: APIApplicationCommandOption[]
    ) => {
      const args = argumentsFor(options);
      const joined = path.join(" ");
      references.push({
        id: joined,
        root: definition.name,
        path: joined,
        description,
        usage: `/${joined}${args.map((o) => ` ${o.required ? `<${o.name}>` : `[${o.name}]`}`).join("")}`,
        module: category,
        moduleEnabled: category === "general" || config.modules[category],
        serverOnly: definition.dm_permission === false,
        defaultPermissions: permissionsFor(
          definition.default_member_permissions
        ),
        ...runtimeNotes(joined, category),
        arguments: args,
      });
    };
    const walk = (
      path: string[],
      description: string,
      options: APIApplicationCommandOption[]
    ) => {
      const children = options.filter(
        (o) =>
          o.type === OptionType.Subcommand ||
          o.type === OptionType.SubcommandGroup
      );
      if (!children.length) add(path, description, options);
      else
        for (const child of children) {
          if (
            child.type === OptionType.Subcommand ||
            child.type === OptionType.SubcommandGroup
          )
            walk([...path, child.name], child.description, child.options ?? []);
        }
    };
    walk([definition.name], definition.description, definition.options ?? []);
  }
  return {
    source: "registration-definitions",
    registrationVerified: false,
    rootCount: commandDefinitions.length,
    invocationCount: references.length,
    commands: references,
  };
}
