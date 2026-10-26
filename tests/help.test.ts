import { defaultConfig } from "@orbit/core";
import { getCommandCatalog } from "@orbit/core/command-catalog";
import { describe, expect, it, vi } from "vitest";
import {
  commandReply,
  helpCommandCard,
  helpOverviewCard,
} from "../apps/bot/src/interactions/replies";
import { helpCommand, helpDocsUrl } from "../apps/bot/src/commands/help";

const catalogWith = (music = true) => {
  const config = structuredClone(defaultConfig);
  config.modules.music = music;
  return getCommandCatalog(config);
};
const embed = (card: any) => commandReply("help", card).embeds[0].toJSON();

describe("/help overview", () => {
  it("lists every registered root command exactly once", () => {
    const catalog = catalogWith();
    const data = embed(
      helpOverviewCard(catalog, "https://example.test/docs/commands")
    );
    const text = (data.fields ?? []).map((field) => field.value).join(" ");
    for (const root of new Set(catalog.commands.map((c) => c.root))) {
      const occurrences = text.split(`${root}\``).length - 1;
      expect(occurrences, `/${root} should appear once in the overview`).toBe(
        1
      );
    }
    expect(data.description).toContain(
      `${new Set(catalog.commands.map((c) => c.root)).size} commands`
    );
    // Subcommands are reachable through /help command:<path>, not listed as roots.
    expect(text).not.toContain("/deals search");
  });
  it("marks permission-restricted commands and paused modules", () => {
    const live = embed(helpOverviewCard(catalogWith(true), "https://x.test"));
    const paused = embed(
      helpOverviewCard(catalogWith(false), "https://x.test")
    );
    const find = (data: any, name: string) =>
      data.fields.find((field: any) => field.value.includes(`/${name}\``))
        ?.value as string;
    expect(find(live, "ban")).toContain("🔒");
    expect(find(live, "play")).not.toContain("🔒");
    expect(find(live, "play")).not.toContain("paused");
    expect(find(paused, "play")).toContain("paused");
  });
  it("links the docs page for the module and never invents one", () => {
    expect(
      helpDocsUrl("music", "https://orbit.example").endsWith("/docs/music")
    ).toBe(true);
    expect(
      helpDocsUrl("general", "https://orbit.example").endsWith("/docs/commands")
    ).toBe(true);
    // A local or missing APP_URL is not sent to Discord users.
    expect(helpDocsUrl("general", "http://localhost:3000")).toBe(
      "https://github.com/dcizov/discordjs-starter/blob/main/docs/COMMANDS.md"
    );
    expect(helpDocsUrl("general", undefined)).toContain(
      "github.com/dcizov/discordjs-starter/blob/main/docs/COMMANDS.md"
    );
  });
});

describe("/help command detail", () => {
  const catalog = catalogWith();
  const command = (path: string) =>
    catalog.commands.find((c) => c.path === path)!;
  it("shows the real usage, options and permissions", () => {
    const data = embed(
      helpCommandCard(command("timeout"), "https://example.test/docs/commands")
    );
    expect(data.title).toBe("/timeout");
    const fields = Object.fromEntries(
      (data.fields ?? []).map((field: any) => [field.name, field.value])
    );
    expect(fields.Usage).toContain("/timeout <member> <reason> <minutes>");
    expect(fields.Options).toContain("`member` (required)");
    expect(fields.Options).toContain("`minutes` (required");
    expect(fields["Who can use it"]).toContain("Moderate Members");
  });
  it("explains a paused module instead of pretending the command works", () => {
    const paused = catalogWith(false).commands.find((c) => c.path === "play")!;
    const data = embed(
      helpCommandCard(paused, "https://example.test/docs/music")
    );
    const fields = Object.fromEntries(
      (data.fields ?? []).map((field: any) => [field.name, field.value])
    );
    expect(fields["On this server"]).toContain("paused");
    expect(fields["Setup and limits"]).toContain("Lavalink");
  });
  it("does not claim a permission for open commands", () => {
    const data = embed(
      helpCommandCard(command("ping"), "https://example.test/docs/commands")
    );
    const fields = Object.fromEntries(
      (data.fields ?? []).map((field: any) => [field.name, field.value])
    );
    expect(fields["Who can use it"]).toContain("Any member");
    expect(fields["Who can use it"]).not.toContain("Discord restricts");
  });
});

describe("/help handler", () => {
  const context = (command?: string) =>
    ({
      config: structuredClone(defaultConfig),
      guild: { id: "120000000000000001" },
      member: { id: "120000000000000002" },
      i: {
        commandName: "help",
        options: { getString: vi.fn(() => command ?? null) },
      },
      reply: vi.fn<(card: unknown) => Promise<undefined>>(),
    }) as any;
  it("replies with the overview when no command is given", async () => {
    const reply = vi.fn<(card: any) => Promise<undefined>>(
      async () => undefined
    );
    await helpCommand({ ...context(), reply });
    expect(reply).toHaveBeenCalledOnce();
    expect(embed(reply.mock.calls[0]![0]).title).toBe("Orbit commands");
  });
  it("answers an unknown command with the real list pointer, not a guess", async () => {
    const reply = vi.fn<(card: any) => Promise<undefined>>(
      async () => undefined
    );
    await helpCommand({ ...context("dance"), reply });
    expect(reply.mock.calls[0]![0]).toContain("No command named `/dance`");
  });
  it("accepts a subcommand path", async () => {
    const reply = vi.fn<(card: any) => Promise<undefined>>(
      async () => undefined
    );
    await helpCommand({ ...context("deals search"), reply });
    expect(embed(reply.mock.calls[0]![0]).title).toBe("/deals search");
  });
});
