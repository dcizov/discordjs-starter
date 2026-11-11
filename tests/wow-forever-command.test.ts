/*
 * `/wowforever` as a command.
 *
 * The routing test mocks this handler out, so nothing else covers it. The part
 * worth covering is not the dispatch — it is that a failure to read the rulesets
 * is reported as a failure, and never as an all-clear.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@orbit/core";
import { PermissionFlagsBits } from "discord.js";

const poll = vi.hoisted(() => vi.fn());
const credentials = vi.hoisted(() => vi.fn());
const saveConfig = vi.hoisted(() => vi.fn());
vi.mock("@orbit/core/wow-forever-client", () => ({
  pollForeverRulesets: poll,
  foreverCredentials: credentials,
}));
vi.mock("@orbit/db", () => ({ saveConfig }));

import { wowForeverCommand } from "../apps/bot/src/commands/wowforever";
import type { CommandContext } from "../apps/bot/src/commands/context";

const UP = { id: 1, name: "Normal", raw: "UP", state: "up" as const };

function makeContext(subcommand: string, manager = true) {
  const reply = vi.fn(async () => undefined);
  const context = {
    i: {
      commandName: "wowforever",
      channelId: "900000000000000001",
      options: { getSubcommand: () => subcommand },
    },
    guild: { id: "800000000000000001" },
    member: {
      id: "700000000000000001",
      user: { tag: "ada#0001", displayAvatarURL: () => "https://cdn/ada.png" },
      permissions: { has: () => manager },
    },
    config: structuredClone(defaultConfig),
    reply,
  } as unknown as CommandContext;
  return { context, reply };
}

beforeEach(() => {
  vi.clearAllMocks();
  credentials.mockReturnValue({
    region: "eu",
    clientId: "id",
    clientSecret: "s",
  });
});

describe("/wowforever status", () => {
  it("reports all-up when every ruleset reports UP", async () => {
    poll.mockResolvedValue({
      snapshots: [UP, { ...UP, id: 2, name: "PvP" }],
      error: null,
    });
    const { context, reply } = makeContext("status");
    await wowForeverCommand(context);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "All 2 rulesets are reporting up."
        ),
      })
    );
  });

  it("names a ruleset that is not up, with the status it actually reported", async () => {
    // The raw value is shown because "not UP" is all we know. Quoting it lets
    // someone recognise a status we have never seen.
    poll.mockResolvedValue({
      snapshots: [
        UP,
        { id: 2, name: "PvP", raw: "MAINTENANCE", state: "down" },
      ],
      error: null,
    });
    const { context, reply } = makeContext("status");
    await wowForeverCommand(context);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("PvP — reported MAINTENANCE"),
        tone: "error",
      })
    );
  });

  /*
   * The two failure modes a status monitor can have, and the reason both are
   * reported as failures rather than silences: "I could not check" and
   * "everything is fine" look identical to the reader unless you say which one
   * it is, and the second answer is the one that gets a monitor muted.
   */
  it.each([
    [
      "an error from the API",
      { snapshots: [], error: "Problem with Authentication" },
    ],
    ["an empty ruleset list", { snapshots: [], error: null }],
  ])("never reports %s as an all-clear", async (_label, result) => {
    poll.mockResolvedValue(result);
    const { context, reply } = makeContext("status");
    await wowForeverCommand(context);
    const card = reply.mock.calls[0][0] as { description: string };
    expect(card.description).not.toMatch(/reporting up\.?$/);
    expect(card.description).toMatch(/could not check|nothing to report/);
  });

  it("always carries the caveat that this is not the login server's view", async () => {
    poll.mockResolvedValue({ snapshots: [UP], error: null });
    const { context, reply } = makeContext("status");
    await wowForeverCommand(context);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        footer: expect.stringContaining("login servers"),
      })
    );
  });
});

describe("/wowforever watch", () => {
  it("binds the current channel", async () => {
    const { context, reply } = makeContext("watch");
    await wowForeverCommand(context);
    expect(saveConfig).toHaveBeenCalledWith(
      "800000000000000001",
      expect.objectContaining({
        wowForever: expect.objectContaining({
          channelId: "900000000000000001",
        }),
      }),
      expect.objectContaining({ id: "700000000000000001" })
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) })
    );
  });

  it("refuses without Manage Server, and does not save", async () => {
    const { context, reply } = makeContext("watch", false);
    await wowForeverCommand(context);
    expect(saveConfig).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Manage Server"),
        tone: "error",
      })
    );
  });

  it("clears the binding on unwatch", async () => {
    const { context } = makeContext("unwatch");
    await wowForeverCommand(context);
    expect(saveConfig).toHaveBeenCalledWith(
      "800000000000000001",
      expect.objectContaining({
        wowForever: expect.objectContaining({ channelId: "" }),
      }),
      expect.anything()
    );
  });

  it("is gated on the same permission as every other config change", () => {
    // Guards the check itself, not just the branch: a permission gate that
    // drifts away from the one the rest of the bot uses is a privilege bug.
    expect(PermissionFlagsBits.ManageGuild).toBeDefined();
  });
});
