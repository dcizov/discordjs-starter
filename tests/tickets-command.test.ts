import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import type { CommandContext } from "../apps/bot/src/commands/context";

const f = vi.hoisted(() => ({
  countOpenForMember: vi.fn(),
  getTicketByChannel: vi.fn(),
  openTicket: vi.fn(),
  claimTicket: vi.fn(),
  closeTicket: vi.fn(),
  reopenTicket: vi.fn(),
  setTicketChannel: vi.fn(),
  touchTicket: vi.fn(),
  audit: vi.fn(),
  createTicketChannel: vi.fn(),
  collectTranscriptLines: vi.fn(),
  deleteTicketChannel: vi.fn(),
}));

vi.mock("@orbit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/db")>();
  return {
    ...actual,
    countOpenForMember: f.countOpenForMember,
    getTicketByChannel: f.getTicketByChannel,
    openTicket: f.openTicket,
    claimTicket: f.claimTicket,
    closeTicket: f.closeTicket,
    reopenTicket: f.reopenTicket,
    setTicketChannel: f.setTicketChannel,
    touchTicket: f.touchTicket,
    audit: f.audit,
  };
});
vi.mock("../apps/bot/src/features/tickets/service", () => ({
  createTicketChannel: f.createTicketChannel,
  collectTranscriptLines: f.collectTranscriptLines,
  deleteTicketChannel: f.deleteTicketChannel,
}));

import { ticketsCommand } from "../apps/bot/src/commands/tickets";
import { defaultConfig, type GuildConfig } from "@orbit/core";

/**
 * The interesting thing about `/ticket` is who is allowed to do what, and what
 * they are told when the bot cannot do what they asked. Both are checked
 * server-side against live state, because a subcommand's own permissions are a
 * hint to the client and nothing more.
 */

const GUILD = "700000000000000001";
const ALICE = "700000000000000002";
const BOB = "700000000000000003";
const STAFF = "700000000000000004";
const CHANNEL = "700000000000000005";

function context(over: {
  sub: string;
  options?: Record<string, any>;
  permissions?: bigint;
  roleIds?: string[];
  tickets?: Partial<GuildConfig["tickets"]>;
  moduleOn?: boolean;
  actorId?: string;
}) {
  const config = structuredClone(defaultConfig) as GuildConfig;
  config.modules.tickets = over.moduleOn !== false;
  config.tickets = {
    ...config.tickets,
    supportRoleIds: ["role-support"],
    maxOpenPerMember: 1,
    ...over.tickets,
  };
  const reply = vi.fn(async () => undefined);
  const actorId = over.actorId ?? ALICE;
  const perms = over.permissions ?? 0n;
  const ctx = {
    i: {
      id: "interaction-1",
      commandName: "ticket",
      user: { id: actorId, username: "alice", avatar: null, bot: false },
      channelId: CHANNEL,
      client: { channels: { fetch: async () => CHANNEL_OBJECT } },
      options: {
        getSubcommand: () => over.sub,
        getString: (key: string) => over.options?.[key] ?? null,
      },
    },
    guild: {
      id: GUILD,
      channels: { fetch: async () => CHANNEL_OBJECT },
    },
    member: {
      id: actorId,
      roles: { cache: new Map((over.roleIds ?? []).map((id) => [id, id])) },
      permissions: {
        has: (bit: bigint | string) => {
          const flag =
            typeof bit === "string"
              ? (PermissionFlagsBits as unknown as Record<string, bigint>)[bit]
              : bit;
          return (perms & flag) === flag;
        },
      },
    },
    config,
    reply,
  } as unknown as CommandContext;
  return { ctx, reply };
}

const ticket = (over: Record<string, any> = {}) => ({
  id: "ticket-1",
  guildId: GUILD,
  number: 7,
  channelId: CHANNEL,
  openerId: ALICE,
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

const CHANNEL_OBJECT = {
  id: CHANNEL,
  type: 0,
  isTextBased: () => true,
  send: vi.fn(async () => undefined),
  messages: { fetch: async () => new Map() },
};

const okChannel = () =>
  f.createTicketChannel.mockResolvedValue({
    ok: true,
    channel: { id: "new-chan", send: vi.fn(async () => undefined) },
  });

beforeEach(() => {
  vi.clearAllMocks();
  f.countOpenForMember.mockResolvedValue(0);
  f.getTicketByChannel.mockResolvedValue(null);
  f.openTicket.mockResolvedValue(ticket());
  f.claimTicket.mockResolvedValue(
    ticket({ state: "claimed", claimerId: STAFF })
  );
  f.closeTicket.mockResolvedValue(ticket({ state: "closed" }));
  f.reopenTicket.mockResolvedValue(ticket({ state: "open" }));
  f.collectTranscriptLines.mockResolvedValue([]);
  f.deleteTicketChannel.mockResolvedValue({ ok: true });
});

describe("/ticket open", () => {
  it("opens a channel and records it against the ticket", async () => {
    okChannel();
    const { ctx, reply } = context({
      sub: "open",
      options: { subject: "Help" },
    });
    await ticketsCommand(ctx);
    expect(f.openTicket).toHaveBeenCalledWith({
      guildId: GUILD,
      openerId: ALICE,
      subject: "Help",
    });
    expect(f.setTicketChannel).toHaveBeenCalledWith(
      GUILD,
      "ticket-1",
      "new-chan"
    );
    expect(((reply.mock.calls as any[][])[0][0] as any).description).toContain(
      "<#new-chan>"
    );
    expect(f.audit).toHaveBeenCalledOnce();
  });

  it("refuses when the member is already at their limit", async () => {
    f.countOpenForMember.mockResolvedValue(1);
    const { ctx } = context({ sub: "open" });
    await expect(ticketsCommand(ctx)).rejects.toThrow(
      /already have an open ticket/
    );
    expect(f.openTicket).not.toHaveBeenCalled();
  });

  it("refuses when the module is paused", async () => {
    const { ctx } = context({ sub: "open", moduleOn: false });
    await expect(ticketsCommand(ctx)).rejects.toThrow(/paused/);
  });

  it("asks for a subject when the server requires one", async () => {
    const { ctx } = context({ sub: "open" });
    await expect(ticketsCommand(ctx)).rejects.toThrow(/Describe what you need/);
    expect(f.openTicket).not.toHaveBeenCalled();
  });

  it("does not ask for a subject when the server does not", async () => {
    okChannel();
    const { ctx } = context({ sub: "open", tickets: { askSubject: false } });
    await ticketsCommand(ctx);
    expect(f.openTicket).toHaveBeenCalled();
  });

  it("says so plainly when the bot cannot make the channel", async () => {
    // The ticket is recorded but unusable. Silence would be worse: the member
    // would think help is coming and nobody would know.
    f.createTicketChannel.mockResolvedValue({
      ok: false,
      permission: true,
      reason: "Orbit needs the **Manage Channels** permission.",
    });
    const { ctx, reply } = context({
      sub: "open",
      options: { subject: "Help" },
    });
    await ticketsCommand(ctx);
    const card = (reply.mock.calls as any[][])[0][0] as any;
    expect(card.tone).toBe("error");
    expect(card.description).toContain("Manage Channels");
    expect(card.footer).toContain("without a channel");
    expect(f.setTicketChannel).not.toHaveBeenCalled();
  });
});

describe("/ticket authorization", () => {
  it("lets the opener close their own ticket", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({ sub: "close" });
    await ticketsCommand(ctx);
    expect(f.closeTicket).toHaveBeenCalled();
  });

  it("does not let a stranger close someone else's ticket", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({ sub: "close", actorId: BOB });
    await expect(ticketsCommand(ctx)).rejects.toThrow(
      /belongs to someone else/
    );
    expect(f.closeTicket).not.toHaveBeenCalled();
  });

  it("does not let a plain member claim, even in their own ticket", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({ sub: "claim" });
    await expect(ticketsCommand(ctx)).rejects.toThrow(/support staff/);
    expect(f.claimTicket).not.toHaveBeenCalled();
  });

  it("does not let a plain member reopen", async () => {
    f.getTicketByChannel.mockResolvedValue(
      ticket({ state: "closed", openerId: ALICE })
    );
    const { ctx } = context({ sub: "reopen" });
    await expect(ticketsCommand(ctx)).rejects.toThrow(/support staff/);
    expect(f.reopenTicket).not.toHaveBeenCalled();
  });

  it("lets a configured support role claim", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({
      sub: "claim",
      roleIds: ["role-support"],
      actorId: STAFF,
    });
    await ticketsCommand(ctx);
    expect(f.claimTicket).toHaveBeenCalled();
  });

  it("lets Manage Server act as support without the role", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({
      sub: "claim",
      permissions: PermissionFlagsBits.ManageGuild,
      actorId: STAFF,
    });
    await ticketsCommand(ctx);
    expect(f.claimTicket).toHaveBeenCalled();
  });

  it("does not let an unrelated role claim", async () => {
    // A stranger is neither staff nor the opener. The honest answer is whose
    // ticket it is, not a complaint about their roles: telling someone they
    // lack a role invites them to go and get one.
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({
      sub: "claim",
      roleIds: ["role-other"],
      actorId: BOB,
    });
    await expect(ticketsCommand(ctx)).rejects.toThrow(
      /belongs to someone else/
    );
    expect(f.claimTicket).not.toHaveBeenCalled();
  });

  it("refuses to act outside a ticket channel", async () => {
    f.getTicketByChannel.mockResolvedValue(null);
    const { ctx } = context({ sub: "close" });
    await expect(ticketsCommand(ctx)).rejects.toThrow(
      /inside a ticket channel/
    );
  });
});

describe("/ticket close", () => {
  it("reads the transcript before deleting the channel", async () => {
    // Order matters: once the channel is gone there is nothing left to read.
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    f.collectTranscriptLines.mockResolvedValue([
      {
        authorId: ALICE,
        authorName: "Alice",
        sentAt: "now",
        content: "hi",
        attachmentNames: [],
        system: false,
      },
    ]);
    const { ctx } = context({
      sub: "close",
      actorId: STAFF,
      permissions: PermissionFlagsBits.ManageGuild,
    });
    await ticketsCommand(ctx);

    const collectOrder = (
      f.collectTranscriptLines.mock.invocationCallOrder as number[]
    )[0];
    const deleteOrder = (
      f.deleteTicketChannel.mock.invocationCallOrder as number[]
    )[0];
    expect(collectOrder).toBeLessThan(deleteOrder);

    const saved = (f.closeTicket.mock.calls as any[][])[0][2];
    expect(saved.transcript).toContain("Alice");
    expect(saved.transcript).toContain("Ticket #7");
  });

  it("keeps the channel when the server asked it to", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({
      sub: "close",
      actorId: STAFF,
      permissions: PermissionFlagsBits.ManageGuild,
      tickets: { keepChannelOnClose: true },
    });
    await ticketsCommand(ctx);
    expect(f.deleteTicketChannel).not.toHaveBeenCalled();
  });

  it("still closes when the transcript cannot be read", async () => {
    // Best effort. Failing to build a transcript must never block closing,
    // because closing is what stops the channel existing.
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    f.collectTranscriptLines.mockResolvedValue(null);
    const { ctx } = context({
      sub: "close",
      actorId: STAFF,
      permissions: PermissionFlagsBits.ManageGuild,
    });
    await ticketsCommand(ctx);
    expect(f.closeTicket).toHaveBeenCalled();
    const saved = (f.closeTicket.mock.calls as any[][])[0][2];
    expect(saved.transcript).toBeNull();
  });

  it("records who closed it and why", async () => {
    f.getTicketByChannel.mockResolvedValue(ticket({ openerId: ALICE }));
    const { ctx } = context({
      sub: "close",
      actorId: STAFF,
      permissions: PermissionFlagsBits.ManageGuild,
      options: { reason: "Sorted it out" },
    });
    await ticketsCommand(ctx);
    const saved = (f.closeTicket.mock.calls as any[][])[0][2];
    expect(saved.closerId).toBe(STAFF);
    expect(saved.reason).toBe("Sorted it out");
    expect(f.audit).toHaveBeenCalled();
  });
});

describe("/ticket info", () => {
  it("describes the ticket you are standing in", async () => {
    f.getTicketByChannel.mockResolvedValue(
      ticket({ subject: "Billing", claimerId: STAFF, state: "claimed" })
    );
    const { ctx, reply } = context({ sub: "info" });
    await ticketsCommand(ctx);
    const card = (reply.mock.calls as any[][])[0][0] as any;
    expect(card.title).toContain("#7");
    expect(card.description).toContain("Billing");
    expect(card.description).toContain("claimed");
  });

  it("says how many you have open when you are not in one", async () => {
    f.getTicketByChannel.mockResolvedValue(null);
    f.countOpenForMember.mockResolvedValue(2);
    const { ctx, reply } = context({ sub: "info" });
    await ticketsCommand(ctx);
    expect(((reply.mock.calls as any[][])[0][0] as any).description).toContain(
      "2 open tickets"
    );
  });

  it("says the module is paused rather than showing a zero", async () => {
    const { ctx, reply } = context({ sub: "info", moduleOn: false });
    await ticketsCommand(ctx);
    expect(((reply.mock.calls as any[][])[0][0] as any).description).toContain(
      "paused"
    );
  });
});
