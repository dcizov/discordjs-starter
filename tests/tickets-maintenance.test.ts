import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";

const f = vi.hoisted(() => ({
  listGuildsWithTickets: vi.fn(),
  listStaleTickets: vi.fn(),
  listOpenTickets: vi.fn(),
  listExpiredTranscripts: vi.fn(),
  closeTicket: vi.fn(),
  clearTranscript: vi.fn(),
  markTicketOrphaned: vi.fn(),
  getGuild: vi.fn(),
}));

vi.mock("@orbit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/db")>();
  return {
    ...actual,
    listGuildsWithTickets: f.listGuildsWithTickets,
    listStaleTickets: f.listStaleTickets,
    listOpenTickets: f.listOpenTickets,
    listExpiredTranscripts: f.listExpiredTranscripts,
    closeTicket: f.closeTicket,
    clearTranscript: f.clearTranscript,
    markTicketOrphaned: f.markTicketOrphaned,
    getGuild: f.getGuild,
  };
});

import { sweepTickets } from "../apps/bot/src/features/tickets/maintenance";
import { defaultConfig, type GuildConfig } from "@orbit/core";

/**
 * The sweep runs across every guild, so the property that matters most is that
 * one server's problem cannot stop the others. The second property is that it
 * is idempotent: running it twice does nothing the second time.
 */

const GUILD_A = "800000000000000001";
const GUILD_B = "800000000000000002";

const configFor = (over: Partial<GuildConfig["tickets"]> = {}): GuildConfig => {
  const config = structuredClone(defaultConfig) as GuildConfig;
  config.modules.tickets = true;
  config.tickets = { ...config.tickets, ...over };
  return config;
};

/** A client whose `channels.fetch` returns whatever the test prescribes. */
function client(
  over: {
    channels?: Record<string, any>;
    throwOn?: string[];
  } = {}
) {
  return {
    channels: {
      fetch: async (id: string) => {
        if (over.throwOn?.includes(id)) throw new Error("Missing Access");
        return over.channels?.[id] ?? null;
      },
    },
  } as any;
}

const textChannel = (id: string, messages: any[] = []) => ({
  id,
  type: ChannelType.GuildText,
  messages: { fetch: async () => new Map(messages.map((m, i) => [i, m])) },
  delete: async () => undefined,
});

const ticket = (over: Record<string, any> = {}) => ({
  id: "ticket-1",
  guildId: GUILD_A,
  number: 3,
  channelId: "chan-1",
  openerId: "u1",
  claimerId: null,
  state: "open",
  subject: null,
  openedAt: new Date().toISOString(),
  closedAt: null,
  closerId: null,
  closeReason: null,
  lastActivityAt: new Date().toISOString(),
  transcript: null,
  transcriptTruncated: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  f.listGuildsWithTickets.mockResolvedValue([]);
  f.listStaleTickets.mockResolvedValue([]);
  f.listOpenTickets.mockResolvedValue([]);
  f.listExpiredTranscripts.mockResolvedValue([]);
  f.closeTicket.mockResolvedValue(ticket({ state: "closed" }));
  f.getGuild.mockResolvedValue({ guildId: GUILD_A, config: configFor() });
});

describe("the sweep", () => {
  it("does nothing when no guild has tickets", async () => {
    const result = await sweepTickets(client());
    expect(result).toEqual({
      autoClosed: 0,
      orphans: 0,
      transcriptsCleared: 0,
      failures: 0,
    });
  });

  it("skips a guild with the module off", async () => {
    const off = configFor();
    off.modules.tickets = false;
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({ guildId: GUILD_A, config: off });
    await sweepTickets(client());
    expect(f.listOpenTickets).not.toHaveBeenCalled();
  });

  it("auto-closes a quiet ticket and captures its transcript first", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ autoCloseHours: 24 }),
    });
    f.listStaleTickets.mockResolvedValue([ticket()]);
    const messages = [
      {
        author: {
          id: "u1",
          globalName: "Alice",
          username: "alice",
          bot: false,
        },
        createdAt: new Date(),
        createdTimestamp: 1,
        content: "hello?",
        attachments: new Map(),
        system: false,
      },
    ];
    const result = await sweepTickets(
      client({ channels: { "chan-1": textChannel("chan-1", messages) } })
    );
    expect(result.autoClosed).toBe(1);
    const saved = (f.closeTicket.mock.calls as any[][])[0][2];
    expect(saved.transcript).toContain("hello?");
    expect(saved.reason).toMatch(/automatically/);
  });

  it("does not auto-close when disabled", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ autoCloseHours: 0 }),
    });
    await sweepTickets(client());
    expect(f.listStaleTickets).not.toHaveBeenCalled();
  });

  it("marks a ticket whose channel is gone, and keeps the record", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.listOpenTickets.mockResolvedValue([ticket()]);
    // fetch returns null: the channel does not exist.
    const result = await sweepTickets(client());
    expect(result.orphans).toBe(1);
    expect(f.markTicketOrphaned).toHaveBeenCalledWith(GUILD_A, "ticket-1");
    // The record is kept. An operator may still need to know it was opened.
    expect(f.closeTicket).not.toHaveBeenCalled();
  });

  it("does not treat a permission error as proof the channel is gone", async () => {
    // Not being able to *see* a channel is not the same as it not existing.
    // Deleting a live ticket's record on that basis would be much worse than
    // leaving an orphan alone.
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.listOpenTickets.mockResolvedValue([ticket()]);
    const result = await sweepTickets(client({ throwOn: ["chan-1"] }));
    expect(result.orphans).toBe(0);
    expect(f.markTicketOrphaned).not.toHaveBeenCalled();
  });

  it("ignores a ticket with no channel", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.listOpenTickets.mockResolvedValue([ticket({ channelId: null })]);
    const result = await sweepTickets(client());
    expect(result.orphans).toBe(0);
  });

  it("clears a transcript that aged out", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ retentionDays: 30 }),
    });
    f.listExpiredTranscripts.mockResolvedValue([
      ticket({
        state: "closed",
        closedAt: new Date(Date.now() - 90 * 86400_000).toISOString(),
      }),
    ]);
    const result = await sweepTickets(client());
    expect(result.transcriptsCleared).toBe(1);
    expect(f.clearTranscript).toHaveBeenCalledWith(GUILD_A, "ticket-1");
  });

  it("leaves a transcript inside its retention window alone", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ retentionDays: 365 }),
    });
    f.listExpiredTranscripts.mockResolvedValue([
      ticket({
        state: "closed",
        closedAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
      }),
    ]);
    const result = await sweepTickets(client());
    expect(result.transcriptsCleared).toBe(0);
  });

  it("keeps sweeping other guilds when one fails", async () => {
    // The sweep is global, so one server with a deleted category must not
    // stop the others being swept.
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A, GUILD_B]);
    f.getGuild.mockImplementation(async (id: string) => {
      if (id === GUILD_A) throw new Error("boom");
      return { guildId: id, config: configFor({ autoCloseHours: 24 }) };
    });
    f.listStaleTickets.mockResolvedValue([ticket({ guildId: GUILD_B })]);
    const result = await sweepTickets(client());
    expect(result.failures).toBe(1);
    expect(result.autoClosed).toBe(1);
  });

  it("counts a failure when the close itself refuses", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ autoCloseHours: 24 }),
    });
    f.listStaleTickets.mockResolvedValue([ticket()]);
    f.closeTicket.mockResolvedValue(null);
    const result = await sweepTickets(client());
    expect(result.autoClosed).toBe(0);
    expect(result.failures).toBe(1);
  });

  it("keeps the channel when the server asked it to", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ autoCloseHours: 24, keepChannelOnClose: true }),
    });
    f.listStaleTickets.mockResolvedValue([ticket()]);
    let deleted = false;
    const channel = textChannel("chan-1");
    channel.delete = async () => {
      deleted = true;
    };
    await sweepTickets(client({ channels: { "chan-1": channel } }));
    expect(deleted).toBe(false);
  });

  it("is idempotent: a second sweep finds nothing to do", async () => {
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ autoCloseHours: 24 }),
    });
    f.listStaleTickets.mockResolvedValue([ticket()]);
    await sweepTickets(client());

    vi.clearAllMocks();
    f.listGuildsWithTickets.mockResolvedValue([GUILD_A]);
    f.getGuild.mockResolvedValue({
      guildId: GUILD_A,
      config: configFor({ autoCloseHours: 24 }),
    });
    f.listStaleTickets.mockResolvedValue([]);
    f.listOpenTickets.mockResolvedValue([]);
    f.listExpiredTranscripts.mockResolvedValue([]);
    const second = await sweepTickets(client());
    expect(second).toEqual({
      autoClosed: 0,
      orphans: 0,
      transcriptsCleared: 0,
      failures: 0,
    });
  });

  it("survives the guild listing failing altogether", async () => {
    f.listGuildsWithTickets.mockRejectedValue(new Error("database down"));
    await expect(sweepTickets(client())).resolves.toEqual({
      autoClosed: 0,
      orphans: 0,
      transcriptsCleared: 0,
      failures: 0,
    });
  });
});
