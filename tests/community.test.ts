import {
  isCommunityChannel,
  newerCommunityPage,
  type CommunityPage,
} from "@orbit/core/community";
import { describe, expect, it } from "vitest";
import { configSchema, defaultConfig } from "@orbit/core";
import {
  communityInputSchema,
  communityQuerySchema,
  communityDate,
  validateCommunitySchedule,
  assertCommunityPublishable,
  assertCommunityEditable,
  type CommunityPost,
} from "@orbit/core/community";
import { moduleSetup } from "@orbit/core/module-setup";
import { createDemo } from "../packages/db/src/demo-seed";
const poll = () => ({
  kind: "poll" as const,
  title: "Game night",
  channelId: "120000000000000201",
  body: "",
  poll: {
    question: "What shall we play?",
    answers: ["Co-op", "Board games"],
    durationHours: 24,
    allowMultiselect: false,
  },
});
const post = (state: CommunityPost["state"] = "draft"): CommunityPost => ({
  ...poll(),
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  guildId: "120000000000000001",
  state,
  version: 1,
  actorId: "120000000000000099",
  requestKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  scheduledFor: null,
  attemptedAt: null,
  messageId: null,
  lastError: null,
  result: null,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
});
describe("opt-in, bounded community publishing policy", () => {
  it("keeps new modules off and music fairness unlimited for old JSON configs", () => {
    const old = structuredClone(defaultConfig) as any;
    delete old.modules.polls;
    delete old.modules.announcements;
    delete old.music.maxPerMember;
    expect(configSchema.parse(old)).toMatchObject({
      modules: { polls: false, announcements: false },
      music: { maxPerMember: 0 },
    });
    expect(defaultConfig.modules.polls).toBe(false);
    expect(defaultConfig.modules.announcements).toBe(false);
  });
  it("validates native answer/question/hour limits, distinct answers and payload kind", () => {
    expect(communityInputSchema.safeParse(poll()).success).toBe(true);
    for (const change of [
      { answers: ["Same", "same"] },
      { answers: ["one"] },
      { answers: Array.from({ length: 11 }, (_, i) => String(i)) },
      { question: "x".repeat(301) },
      { answers: ["x".repeat(56), "y"] },
      { durationHours: 0 },
      { durationHours: 169 },
      { durationHours: 1.5 },
    ])
      expect(
        communityInputSchema.safeParse({
          ...poll(),
          poll: { ...poll().poll, ...change },
        }).success
      ).toBe(false);
    expect(
      communityInputSchema.safeParse({ ...poll(), unexpected: "send now" })
        .success
    ).toBe(false);
    expect(
      communityInputSchema.safeParse({ ...poll(), channelId: "foreign" })
        .success
    ).toBe(false);
    expect(
      communityInputSchema.safeParse({
        kind: "announcement",
        title: "Notice",
        channelId: poll().channelId,
        body: "x".repeat(1801),
        poll: null,
      }).success
    ).toBe(false);
  });
  it("suppresses mentions and rejects markup instead of rendering untrusted HTML", () => {
    const value = communityInputSchema.parse({
      ...poll(),
      poll: { ...poll().poll, question: "@everyone <@12345678901234567>" },
    });
    expect(value.poll?.question).toBe("＠everyone [mention]");
    expect(
      communityInputSchema.safeParse({
        ...poll(),
        title: "<script>alert(1)</script>",
      }).success
    ).toBe(false);
    expect(
      communityInputSchema.safeParse({
        ...poll(),
        poll: { ...poll().poll, answers: ["@everyone", "＠everyone"] },
      }).success
    ).toBe(false);
  });
  it("bounds pagination and states", () => {
    for (const input of [
      { page: 0 },
      { page: 1001 },
      { pageSize: 21 },
      { state: "sent" },
    ])
      expect(
        communityQuerySchema.safeParse({ kind: "poll", ...input }).success
      ).toBe(false);
  });
  it("requires UTC, a minute of lead time and a bounded 30-day horizon", () => {
    const now = Date.parse("2026-10-25T00:00:00Z");
    expect(validateCommunitySchedule("2026-10-25T00:01:00Z", now)).toBe(
      "2026-10-25T00:01:00.000Z"
    );
    for (const value of [
      "2026-10-25T00:00:59Z",
      "2026-11-25T00:00:00Z",
      "2026-10-25T02:30:00+02:00",
      "tomorrow",
    ])
      expect(() => validateCommunitySchedule(value, now)).toThrow();
  });
  it.each([
    "sending",
    "unconfirmed",
    "published",
    "closed",
    "cancelled",
    "scheduled",
    "missed",
  ] as const)("never manually republishes %s records", (state) => {
    expect(() => assertCommunityPublishable(post(state), false, 0)).toThrow();
  });
  it("rejects early, overdue and cancelled scheduled revisions", () => {
    const p = {
      ...post("scheduled"),
      kind: "announcement" as const,
      poll: null,
      scheduledFor: "2026-10-25T00:00:00Z",
    };
    const due = Date.parse(p.scheduledFor);
    expect(() => assertCommunityPublishable(p, true, due)).not.toThrow();
    expect(() => assertCommunityPublishable(p, true, due - 1)).toThrow();
    expect(() =>
      assertCommunityPublishable(p, true, due + 15 * 60000 + 1)
    ).toThrow();
    expect(() =>
      assertCommunityPublishable({ ...p, state: "cancelled" }, true, due)
    ).toThrow();
    expect(() => assertCommunityEditable(post("published"))).toThrow(
      /immutable/
    );
  });
  it("formats both Berlin DST fold occurrences explicitly and independent of host/browser locale", () => {
    expect(communityDate("2026-10-25T00:30:00Z", "Europe/Berlin")).toBe(
      "25 Oct 2026, 02:30"
    );
    expect(communityDate("2026-10-25T01:30:00Z", "Europe/Berlin")).toBe(
      "25 Oct 2026, 02:30"
    );
    expect(communityDate("2026-10-25T01:30:00Z", "Asia/Tokyo")).toBe(
      "25 Oct 2026, 10:30"
    );
  });
  it("derives honest setup guidance without assuming new permission grants", () => {
    const d = createDemo();
    const context = {
      guild: d.guilds[0],
      resources: d.resources,
      health: [],
      integrations: { itad: false, lavalink: false },
      demo: true,
    };
    expect(moduleSetup(context, "polls").state).toBe("paused");
    context.guild.config.modules.polls = true;
    expect(moduleSetup(context, "polls").state).toBe("configured");
    context.guild.channels = context.guild.channels.map((c) => ({
      ...c,
      permissionBits: undefined,
    }));
    expect(moduleSetup(context, "polls").state).toBe("not-verified");
  });
});

it("keeps newer community snapshots when an old dashboard refresh completes late", () => {
  const current: CommunityPage = {
    asOf: "2026-10-25T12:00:01.000Z",
    kind: "announcement",
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
  };
  expect(
    newerCommunityPage(current, {
      ...current,
      asOf: "2026-10-25T12:00:00.000Z",
      total: 1,
    })
  ).toBe(current);
  expect(
    newerCommunityPage(current, {
      ...current,
      asOf: "2026-10-25T12:00:02.000Z",
      kind: "poll",
    })
  ).toBe(current);
  const next = { ...current, asOf: "2026-10-25T12:00:02.000Z", total: 1 };
  expect(newerCommunityPage(current, next)).toBe(next);
});

it("does not assume unsupported or unknown text-channel subtypes are community destinations", () => {
  const channel = {
    id: "120000000000000201",
    name: "updates",
    type: "text" as const,
    canSend: true,
  };
  expect(isCommunityChannel(channel)).toBe(false);
  expect(isCommunityChannel({ ...channel, supportsCommunityPosts: true })).toBe(
    true
  );
  expect(
    isCommunityChannel({ ...channel, supportsCommunityPosts: false }, true)
  ).toBe(false);
  expect(isCommunityChannel(channel, true)).toBe(true);
  expect(
    isCommunityChannel({
      ...channel,
      type: "voice",
      supportsCommunityPosts: true,
    })
  ).toBe(false);
});
