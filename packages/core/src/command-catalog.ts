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
  general: ["ping"],
  roles: ["roles", "role-panel"],
  moderation: ["warn", "timeout", "kick", "ban", "purge", "cases"],
  economy: ["balance", "daily", "transfer", "leaderboard", "shop", "inventory"],
  music: [
    "play",
    "queue",
    "pause",
    "resume",
    "skip",
    "stop",
    "shuffle",
    "volume",
    "repeat",
  ],
  deals: ["deals"],
  news: ["news"],
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
      "The economy module must be enabled. Balances, cooldowns, transfer settings, purchase entitlements, and role delivery permissions are checked at execution."
    );
  if (module === "music")
    notes.push(
      path === "queue"
        ? "Reads the queue snapshot; it does not start audio. Queue history can be read even when the music module is paused."
        : "Requires the music module, a configured Lavalink backend, an approved source, and a voice channel. Same-room, DJ-role, Connect, and Speak checks apply at execution."
    );
  if (module === "deals")
    notes.push(
      "Requires the deals module. Search and live deal checks need a configured IsThereAnyDeal API key; watchlist creation uses the supplied game ID. Watchlists belong to this server."
    );
  if (module === "news")
    notes.push(
      "Requires the news module and a source configured in this server. A source test fetches a preview; it does not deliver a Discord message."
    );
  if (path === "deals watch" || path === "news test") {
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
