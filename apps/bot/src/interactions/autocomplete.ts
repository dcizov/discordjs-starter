import type { AutocompleteInteraction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { listCommunityPosts, getGuild, listResources } from "@orbit/db";
import { getCommandCatalog } from "@orbit/core/command-catalog";
import { dealGameSelection } from "../features/deals/selection";
export async function handleAutocomplete(i: AutocompleteInteraction) {
  if (!i.guild) return;

  if (i.commandName === "help") {
    // The catalog is the source, so autocomplete can never offer an invocation the
    // bot does not register. Subcommand paths are offered by their full path.
    const stored = await getGuild(i.guild.id);
    const focused = String(i.options.getFocused()).toLowerCase();
    const commands = stored ? getCommandCatalog(stored.config).commands : [];
    await i.respond(
      commands
        .filter((command) => command.path.includes(focused))
        .slice(0, 25)
        .map((command) => ({
          name: `/${command.path} — ${command.description}`.slice(0, 100),
          value: command.path,
        }))
    );
    return;
  }

  if (["poll", "announce"].includes(i.commandName)) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.respond([]);
      return;
    }
    const kind = i.commandName === "poll" ? "poll" : "announcement";
    const page = await listCommunityPosts(i.guild.id, {
      kind,
      pageSize: 20,
    });
    const q = i.options.getFocused().toLowerCase();
    await i.respond(
      page.items
        .filter((p) => p.title.toLowerCase().includes(q))
        .map((p) => ({
          name: `${p.title} · ${p.state}`.slice(0, 100),
          value: p.id,
        }))
    );
    return;
  }
  if (i.commandName === "deals") {
    const focused = i.options.getFocused(true);
    const sub = i.options.getSubcommand(false);
    if (focused.name !== "game" || !["info", "watch"].includes(sub ?? "")) {
      await i.respond([]);
      return;
    }
    const stored = await getGuild(i.guild.id);
    const allowed =
      stored?.config.modules.deals &&
      (sub !== "watch" ||
        i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    await i.respond(
      allowed
        ? dealGameSelection.choices(
            i.guild.id,
            i.user.id,
            String(focused.value)
          )
        : []
    );
    return;
  }
  const kind =
    i.commandName === "shop"
      ? "shop"
      : i.commandName === "news"
        ? "source"
        : "panel";
  const q = i.options.getFocused().toLowerCase();
  const resources = (await listResources(i.guild.id, kind))
    .filter((r) => r.enabled && r.name.toLowerCase().includes(q))
    .slice(0, 25);
  await i.respond(
    resources.map((r) => ({ name: r.name.slice(0, 100), value: r.id }))
  );
  return;
}
