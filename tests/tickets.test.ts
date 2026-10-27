import { describe, expect, it } from "vitest";
import {
  defaultTicketConfig,
  isOrphaned,
  isStale,
  isSupport,
  mayAct,
  mayOpen,
  OPENER_ALLOW,
  renderTranscript,
  SUPPORT_ALLOW,
  ticketChannelName,
  ticketConfigSchema,
  withinRetention,
  type TicketConfig,
} from "@orbit/core/tickets";

const config = (over: Partial<TicketConfig> = {}): TicketConfig => ({
  ...defaultTicketConfig,
  ...over,
});

const OPEN = "500000000000000001";
const STAFF = "500000000000000002";
const OTHER = "500000000000000003";

describe("opening a ticket", () => {
  it("allows the first ticket", () => {
    expect(
      mayOpen({
        openCount: 0,
        config: config(),
        moduleEnabled: true,
      })
    ).toEqual({ ok: true, needsSubject: true });
  });

  it("refuses a second ticket when the cap is one", () => {
    // One person opening fifty channels is the failure mode this exists for.
    const result = mayOpen({
      openCount: 1,
      config: config(),
      moduleEnabled: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(/already have an open ticket/);
  });

  it("names the count when the cap is higher", () => {
    const result = mayOpen({
      openCount: 3,
      config: config({ maxOpenPerMember: 3 }),
      moduleEnabled: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/3 open tickets/);
  });

  it("treats zero as no limit", () => {
    expect(
      mayOpen({
        openCount: 9,
        config: config({ maxOpenPerMember: 0 }),
        moduleEnabled: true,
      })
    ).toEqual({ ok: true, needsSubject: true });
  });

  it("refuses when the module is paused", () => {
    const result = mayOpen({
      openCount: 0,
      config: config(),
      moduleEnabled: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/paused/);
  });

  it("skips the subject question when configured to", () => {
    expect(
      mayOpen({
        openCount: 0,
        config: config({ askSubject: false }),
        moduleEnabled: true,
      })
    ).toEqual({ ok: true, needsSubject: false });
  });
});

describe("who counts as support", () => {
  it("falls back to Manage Server when no support roles are set", () => {
    expect(
      isSupport(config(), { memberRoleIds: [], canManageGuild: true })
    ).toBe(true);
    expect(
      isSupport(config(), { memberRoleIds: [], canManageGuild: false })
    ).toBe(false);
  });

  it("grants a configured support role", () => {
    expect(
      isSupport(config({ supportRoleIds: ["role-a"] }), {
        memberRoleIds: ["role-a"],
        canManageGuild: false,
      })
    ).toBe(true);
    expect(
      isSupport(config({ supportRoleIds: ["role-a"] }), {
        memberRoleIds: ["role-b"],
        canManageGuild: false,
      })
    ).toBe(false);
  });

  it("never removes the ability from someone with Manage Server", () => {
    // Configuring support roles is additive. Operators are surprised by that
    // far less often than by losing access they already had.
    expect(
      isSupport(config({ supportRoleIds: ["role-a"] }), {
        memberRoleIds: [],
        canManageGuild: true,
      })
    ).toBe(true);
  });
});

describe("who may claim, close or reopen", () => {
  const ticket = (over: Partial<Parameters<typeof mayAct>[0]> = {}) => ({
    state: "open" as const,
    openerId: OPEN,
    claimerId: null,
    closedAt: null,
    lastActivityAt: new Date().toISOString(),
    ...over,
  });

  it("lets the opener close their own ticket", () => {
    // Making someone wait for staff to close their own ticket is the most
    // annoying thing a ticket system can do.
    const r = mayAct(ticket(), {
      actorId: OPEN,
      canManageGuild: false,
      isSupportMember: false,
    });
    expect(r.close).toBe(true);
  });

  it("does not let the opener claim it", () => {
    // "Claim" means "I am handling this", which belongs to staff.
    const r = mayAct(ticket(), {
      actorId: OPEN,
      canManageGuild: false,
      isSupportMember: false,
    });
    expect(r.claim).toBe(false);
  });

  it("does not let the opener reopen it", () => {
    const r = mayAct(ticket({ state: "closed" }), {
      actorId: OPEN,
      canManageGuild: false,
      isSupportMember: false,
    });
    expect(r.reopen).toBe(false);
    expect(r.reason).toMatch(/support staff/);
  });

  it("lets staff claim an unclaimed ticket, but not a claimed one", () => {
    const staff = {
      actorId: STAFF,
      canManageGuild: false,
      isSupportMember: true,
    };
    expect(mayAct(ticket(), staff).claim).toBe(true);
    expect(mayAct(ticket({ claimerId: STAFF }), staff).claim).toBe(false);
  });

  it("keeps a stranger out entirely", () => {
    const r = mayAct(ticket(), {
      actorId: OTHER,
      canManageGuild: false,
      isSupportMember: false,
    });
    expect(r).toMatchObject({ claim: false, close: false, reopen: false });
    expect(r.reason).toMatch(/belongs to someone else/);
  });

  it("lets staff close someone else's ticket", () => {
    expect(
      mayAct(ticket(), {
        actorId: STAFF,
        canManageGuild: false,
        isSupportMember: true,
      }).close
    ).toBe(true);
  });
});

describe("staleness", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const at = (iso: string) => ({ lastActivityAt: iso });

  it("closes a ticket past the window", () => {
    expect(isStale(at("2026-10-28T06:00:00Z"), 4, now)).toBe(true);
  });

  it("leaves a ticket inside the window", () => {
    expect(isStale(at("2026-10-28T11:00:00Z"), 4, now)).toBe(false);
  });

  it("never closes when disabled", () => {
    expect(isStale(at("2020-01-01T00:00:00Z"), 0, now)).toBe(false);
  });

  it("does not close when the last activity is unknown", () => {
    // An unknown timestamp must not silently close a ticket someone is still
    // waiting on an answer to.
    expect(isStale({ lastActivityAt: null }, 4, now)).toBe(false);
    expect(isStale({ lastActivityAt: "not-a-date" }, 4, now)).toBe(false);
  });

  it("does not close when the clock ran backwards", () => {
    // A future timestamp means our clock is wrong, not that the ticket is old.
    expect(isStale(at("2027-01-01T00:00:00Z"), 4, now)).toBe(false);
  });
});

describe("retention", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("keeps a recent transcript", () => {
    expect(withinRetention("2026-10-20T00:00:00Z", 30, now)).toBe(true);
  });
  it("expires an old one", () => {
    expect(withinRetention("2026-01-01T00:00:00Z", 30, now)).toBe(false);
  });
  it("deletes immediately when retention is zero", () => {
    expect(withinRetention("2026-10-28T11:00:00Z", 0, now)).toBe(false);
  });
  it("keeps an unclosed or unparseable ticket", () => {
    expect(withinRetention(null, 30, now)).toBe(true);
    expect(withinRetention("garbage", 30, now)).toBe(true);
  });
});

describe("channel names", () => {
  it("pads the number so channels sort in order", () => {
    expect(ticketChannelName(7)).toBe("ticket-0007");
    expect(ticketChannelName(42, "Payment problem")).toBe(
      "ticket-0042-payment-problem"
    );
  });

  it("drops punctuation rather than escaping it", () => {
    expect(ticketChannelName(3, "Help!!! <@123> ??")).toBe(
      "ticket-0003-help-123"
    );
  });

  it("survives an empty or unusable subject", () => {
    expect(ticketChannelName(9, "")).toBe("ticket-0009");
    expect(ticketChannelName(9, "!!!")).toBe("ticket-0009");
  });

  it("caps the slug so the name stays within Discord's limit", () => {
    const name = ticketChannelName(1, "a".repeat(200));
    expect(name.length).toBeLessThanOrEqual(100);
  });
});

describe("transcripts", () => {
  const ticket = {
    number: 12,
    subject: "Billing",
    openedAt: "2026-10-27T10:00:00Z",
    closedAt: "2026-10-27T11:00:00Z",
  };
  const line = (n: number) => ({
    authorId: `u${n}`,
    authorName: `Member ${n}`,
    sentAt: "2026-10-27T10:30:00Z",
    content: `Message ${n}`,
  });

  it("headers the ticket and lists the messages", () => {
    const { text, truncated } = renderTranscript(ticket, [line(1), line(2)]);
    expect(text).toContain("Ticket #12");
    expect(text).toContain("Subject: Billing");
    expect(text).toContain("Message 1");
    expect(truncated).toBe(false);
  });

  it("records who said it, not just what", () => {
    const { text } = renderTranscript(ticket, [line(1)]);
    expect(text).toContain("Member 1 (u1)");
  });

  it("names attachments without retaining them", () => {
    const { text } = renderTranscript(ticket, [
      { ...line(1), content: "", attachmentNames: ["screenshot.png"] },
    ]);
    expect(text).toContain("screenshot.png");
    expect(text).toContain("(no text)");
  });

  it("says so when it truncates by line count", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i));
    const { text, truncated } = renderTranscript(ticket, lines, {
      maxLines: 10,
    });
    expect(truncated).toBe(true);
    expect(text).toContain("truncated at 10 lines");
    expect(text).not.toContain("Message 49");
  });

  it("says so when it truncates by size", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      ...line(i),
      content: "x".repeat(2000),
    }));
    const { text, truncated } = renderTranscript(ticket, lines, {
      maxBytes: 5000,
    });
    expect(truncated).toBe(true);
    expect(text).toContain("truncated for size");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(6000);
  });

  it("does not split a multi-byte character when cutting for size", () => {
    // Cutting by bytes would otherwise leave a broken surrogate pair behind.
    const lines = Array.from({ length: 30 }, () => ({
      ...line(1),
      content: "🚀".repeat(200),
    }));
    const { text } = renderTranscript(ticket, lines, { maxBytes: 4000 });
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text))
    ).not.toThrow();
  });
});

describe("orphaned channels", () => {
  it("flags an open ticket whose channel is gone", () => {
    expect(isOrphaned({ state: "open", channelExists: false })).toBe(true);
    expect(isOrphaned({ state: "claimed", channelExists: false })).toBe(true);
  });

  it("does not flag a closed ticket, which has no channel by design", () => {
    expect(isOrphaned({ state: "closed", channelExists: false })).toBe(false);
  });

  it("does not flag a healthy ticket", () => {
    expect(isOrphaned({ state: "open", channelExists: true })).toBe(false);
  });
});

describe("the overwrite permission sets", () => {
  it("does not let the opener delete messages", () => {
    // Routinely requested and always a mistake: it lets someone destroy the
    // record of what they said.
    expect(OPENER_ALLOW).not.toContain("ManageMessages");
    expect(OPENER_ALLOW).toContain("ViewChannel");
    expect(OPENER_ALLOW).toContain("SendMessages");
    expect(OPENER_ALLOW).toContain("ReadMessageHistory");
  });

  it("gives support strictly more than the opener", () => {
    for (const permission of OPENER_ALLOW)
      expect(SUPPORT_ALLOW).toContain(permission);
    expect(SUPPORT_ALLOW.length).toBeGreaterThan(OPENER_ALLOW.length);
  });
});

describe("the config schema", () => {
  it("rejects a retention longer than a year", () => {
    expect(() => ticketConfigSchema.parse({ retentionDays: 999 })).toThrow();
  });

  it("rejects an unbounded per-member cap", () => {
    expect(() => ticketConfigSchema.parse({ maxOpenPerMember: 999 })).toThrow();
  });

  it("rejects a malformed snowflake in the support roles", () => {
    expect(() =>
      ticketConfigSchema.parse({ supportRoleIds: ["nope"] })
    ).toThrow();
  });

  it("accepts an empty category, which means 'next to the panel'", () => {
    expect(ticketConfigSchema.parse({ categoryId: "" }).categoryId).toBe("");
  });

  it("parses with no input at all", () => {
    expect(ticketConfigSchema.parse({}).maxOpenPerMember).toBe(1);
  });
});
