import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  PermissionFlagsBits as P,
  PermissionsBitField,
  RateLimitError,
  type Client,
  type APIPoll,
} from "discord.js";
import { defaultConfig } from "@orbit/core";
import type { CommunityPost } from "@orbit/core/community";
const db = vi.hoisted(() => ({
  getGuild: vi.fn(),
  getCommunityPost: vi.fn(),
  claimCommunityPost: vi.fn(),
  finishCommunityPost: vi.fn(),
  recordCommunityResult: vi.fn(),
  rejectCommunityPost: vi.fn(),
}));
vi.mock("@orbit/db", () => db);
import {
  communityPayload,
  communityPollResult,
  executeCommunity,
  createCommunityRest,
} from "../apps/bot/src/community";
const gid = "120000000000000001",
  cid = "120000000000000201",
  uid = "120000000000000099",
  botId = "120000000000000010",
  mid = "120000000000000601";
const fixture = (): CommunityPost => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  guildId: gid,
  kind: "poll",
  title: "Friday plan",
  channelId: cid,
  body: "",
  poll: {
    question: "Choose a game",
    answers: ["Co-op", "Strategy"],
    durationHours: 24,
    allowMultiselect: false,
  },
  state: "draft",
  version: 1,
  actorId: uid,
  requestKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  scheduledFor: null,
  attemptedAt: null,
  messageId: null,
  lastError: null,
  result: null,
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
});
const native = (): APIPoll => ({
  question: { text: "Choose a game" },
  answers: [
    { answer_id: 1, poll_media: { text: "Co-op" } },
    { answer_id: 2, poll_media: { text: "Strategy" } },
  ],
  expiry: "2099-01-01T00:00:00Z",
  allow_multiselect: false,
  layout_type: 1,
});
let post: CommunityPost;
let actor: any, me: any, channel: any, guild: any, client: Client;
const rest = { post: vi.fn(), get: vi.fn() };
const input = () => ({
  guildId: gid,
  id: post.id,
  version: 1,
  actorId: uid,
  action: "publish" as const,
  requestedAt: Date.now(),
});
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.clearAllMocks();
  post = fixture();
  actor = { id: uid, permissions: new PermissionsBitField(P.ManageGuild) };
  me = { id: botId };
  channel = {
    id: cid,
    guild: { id: gid },
    type: ChannelType.GuildText,
    permissionsFor: vi.fn(
      () =>
        new PermissionsBitField([
          P.ViewChannel,
          P.SendMessages,
          P.SendPolls,
          P.ReadMessageHistory,
          P.EmbedLinks,
        ])
    ),
  };
  guild = {
    roles: { fetch: vi.fn() },
    members: {
      fetch: vi.fn(async () => actor),
      fetchMe: vi.fn(async () => me),
    },
    channels: { fetch: vi.fn(async () => channel) },
  };
  client = {
    user: { id: botId },
    guilds: { fetch: vi.fn(async () => guild) },
  } as unknown as Client;
  db.getGuild.mockResolvedValue({
    id: gid,
    installed: true,
    config: {
      ...defaultConfig,
      modules: { ...defaultConfig.modules, polls: true },
    },
  });
  db.getCommunityPost.mockImplementation(async () => ({ ...post }));
  db.claimCommunityPost.mockImplementation(async () => ({
    ...post,
    state: "sending",
    version: 2,
  }));
  db.finishCommunityPost.mockImplementation(async (_g, _i, _v, _a, result) => ({
    ...post,
    ...result,
    version: 3,
  }));
  db.recordCommunityResult.mockImplementation(
    async (_g, _i, _v, _a, _r, closed) => ({
      ...post,
      state: closed ? "closed" : "published",
    })
  );
  rest.post.mockResolvedValue({
    id: mid,
    author: { id: botId },
    poll: native(),
  });
  rest.get.mockResolvedValue({
    id: mid,
    author: { id: botId },
    poll: native(),
  });
});
describe("version-matched native poll transport, no live Discord", () => {
  it("rejects direct live transport execution in demo before storage or Discord calls", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /disabled in demo/
    );
    expect(db.getCommunityPost).not.toHaveBeenCalled();
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.get).not.toHaveBeenCalled();
  });

  it("disables hidden SDK 5xx/timeout retries and rate-limit requeueing", () => {
    const options = createCommunityRest("fake-unit-test-token").options;
    expect(options.retries).toBe(0);
    expect(options.timeout).toBe(15_000);
    expect(typeof options.rejectOnRateLimit).toBe("function");
    expect((options.rejectOnRateLimit as () => boolean)()).toBe(true);
  });
  it("records a typed SDK rate-limit refusal as a definite failed attempt", async () => {
    rest.post.mockRejectedValue(
      new RateLimitError({
        timeToReset: 100,
        limit: 1,
        method: "POST",
        hash: "unit-test",
        url: `https://discord.com/api/v10/channels/${cid}/messages`,
        route: "/channels/:id/messages",
        majorParameter: cid,
        global: false,
        retryAfter: 100,
        sublimitTimeout: 0,
        scope: "shared",
      })
    );
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /rate-limited/
    );
    expect(db.finishCommunityPost).toHaveBeenCalledWith(
      gid,
      post.id,
      2,
      uid,
      expect.objectContaining({ state: "failed" })
    );
    expect(rest.post).toHaveBeenCalledTimes(1);
  });
  it("rechecks request age after slow permission preflight", async () => {
    const request = input();
    db.getGuild.mockImplementationOnce(async () => {
      request.requestedAt = Date.now() - 31_000;
      return {
        id: gid,
        installed: true,
        config: {
          ...defaultConfig,
          modules: { ...defaultConfig.modules, polls: true },
        },
      };
    });
    await expect(executeCommunity(client, rest, request)).rejects.toThrow(
      /expired/
    );
    expect(db.claimCommunityPost).not.toHaveBeenCalled();
    expect(rest.post).not.toHaveBeenCalled();
  });

  it("uses native API shape, stable nonce and no mentions/components or custom voting", () => {
    const payload = communityPayload(post);
    expect(payload).toMatchObject({
      enforce_nonce: true,
      allowed_mentions: {
        parse: [],
        users: [],
        roles: [],
        replied_user: false,
      },
      poll: {
        question: { text: "Choose a game" },
        answers: [
          { poll_media: { text: "Co-op" } },
          { poll_media: { text: "Strategy" } },
        ],
        duration: 24,
        allow_multiselect: false,
        layout_type: 1,
      },
    });
    expect(payload.nonce).toBe(communityPayload({ ...post, version: 2 }).nonce);
    expect(payload.components).toBeUndefined();
    expect(
      communityPayload({
        ...post,
        kind: "announcement",
        poll: null,
        body: "Hello",
      })
    ).toMatchObject({
      embeds: [{ title: "Friday plan", description: "Hello" }],
    });
  });
  it("distinguishes omitted results, approximate zero and precise finalized aggregates", () => {
    expect(communityPollResult(native()).answers.map((a) => a.votes)).toEqual([
      null,
      null,
    ]);
    const poll = {
      ...native(),
      results: {
        is_finalized: false,
        answer_counts: [{ id: 1, count: 7, me_voted: false }],
      },
    };
    expect(communityPollResult(poll)).toMatchObject({
      finalized: false,
      answers: [{ votes: 7 }, { votes: 0 }],
    });
    expect(
      communityPollResult({
        ...poll,
        results: { ...poll.results, is_finalized: true },
      }).finalized
    ).toBe(true);
    expect(JSON.stringify(communityPollResult(poll))).not.toContain("me_voted");
  });
  it("forces current ownership metadata instead of trusting a cached former owner's permissions", async () => {
    vi.mocked(client.guilds.fetch).mockImplementationOnce(
      async (options: any) => {
        if (options.force === true)
          actor.permissions = new PermissionsBitField(0n);
        return guild;
      }
    );
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /Manage Server/
    );
    expect(client.guilds.fetch).toHaveBeenCalledWith({
      guild: gid,
      force: true,
      withCounts: false,
    });
    expect(db.claimCommunityPost).not.toHaveBeenCalled();
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("commits the claim before external I/O, then stores the accepted message ID", async () => {
    expect(await executeCommunity(client, rest, input())).toMatchObject({
      state: "published",
      messageId: mid,
    });
    expect(db.claimCommunityPost.mock.invocationCallOrder[0]).toBeLessThan(
      rest.post.mock.invocationCallOrder[0]
    );
    expect(db.finishCommunityPost).toHaveBeenCalledWith(
      gid,
      post.id,
      2,
      uid,
      expect.objectContaining({ state: "published", messageId: mid })
    );
    expect(guild.members.fetch).toHaveBeenCalledWith({
      user: uid,
      force: true,
    });
    expect(guild.roles.fetch).toHaveBeenCalled();
    expect(rest.post.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it.each([403, 404, 400, 429])(
    "records a definite HTTP %i rejection as unsent/failed without retry",
    async (status) => {
      rest.post.mockRejectedValue({ status, message: "PRIVATE_TOKEN" });
      await expect(executeCommunity(client, rest, input())).rejects.not.toThrow(
        "PRIVATE_TOKEN"
      );
      expect(db.finishCommunityPost).toHaveBeenCalledWith(
        gid,
        post.id,
        2,
        uid,
        expect.objectContaining({ state: "failed" })
      );
      expect(rest.post).toHaveBeenCalledTimes(1);
    }
  );
  it.each([500, 502, 408, undefined])(
    "records HTTP %s / network ambiguity as unconfirmed, never a second POST",
    async (status) => {
      rest.post.mockRejectedValue({
        status,
        message: "SECRET https://private-host/?token=never-log",
      });
      await expect(executeCommunity(client, rest, input())).rejects.toThrow(
        /did not confirm/
      );
      expect(db.finishCommunityPost).toHaveBeenCalledWith(
        gid,
        post.id,
        2,
        uid,
        expect.objectContaining({ state: "unconfirmed" })
      );
      expect(rest.post).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(db.finishCommunityPost.mock.calls)).not.toContain(
        "SECRET"
      );
    }
  );
  it("does not resend when persistence fails after Discord acceptance", async () => {
    db.finishCommunityPost.mockRejectedValue(new Error("DB unavailable"));
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      "DB unavailable"
    );
    expect(rest.post).toHaveBeenCalledTimes(1);
  });
  it("rejects expired manual jobs and stale revisions before network calls", async () => {
    await expect(
      executeCommunity(client, rest, {
        ...input(),
        requestedAt: Date.now() - 31000,
      })
    ).rejects.toThrow(/expired/);
    post.version = 2;
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /changed/
    );
    expect(rest.post).not.toHaveBeenCalled();
    expect(db.claimCommunityPost).not.toHaveBeenCalled();
  });
  it("checks current manager membership and a paused module, never just saved config", async () => {
    actor.permissions = new PermissionsBitField(0n);
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /Manage Server/
    );
    actor.permissions = new PermissionsBitField(P.ManageGuild);
    db.getGuild.mockResolvedValue({ installed: true, config: defaultConfig });
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /paused/
    );
    expect(rest.post).not.toHaveBeenCalled();
  });
  it.each([
    "deleted",
    "other-guild",
    "announcement-channel",
    "missing-poll-permission",
    "hidden-from-manager",
  ])("rejects %s destinations before claiming/sending", async (mode) => {
    if (mode === "deleted") guild.channels.fetch.mockResolvedValue(null);
    if (mode === "other-guild") channel.guild.id = "990000000000000001";
    if (mode === "announcement-channel")
      channel.type = ChannelType.GuildAnnouncement;
    if (mode === "missing-poll-permission")
      channel.permissionsFor.mockReturnValue(
        new PermissionsBitField([P.ViewChannel, P.SendMessages])
      );
    if (mode === "hidden-from-manager")
      channel.permissionsFor.mockImplementation(
        (who: any) =>
          new PermissionsBitField(
            who.id === uid ? 0n : [P.ViewChannel, P.SendMessages, P.SendPolls]
          )
      );
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /ordinary server text/
    );
    expect(rest.post).not.toHaveBeenCalled();
    expect(db.claimCommunityPost).not.toHaveBeenCalled();
    expect(db.rejectCommunityPost).toHaveBeenCalled();
  });
  it("honors a cancellation/revision change during preflight", async () => {
    db.claimCommunityPost.mockRejectedValue(new Error("This record changed"));
    await expect(executeCommunity(client, rest, input())).rejects.toThrow(
      /changed/
    );
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("allows fresh manager cleanup of owned polls while paused, without fetching voters", async () => {
    post.state = "published";
    post.messageId = mid;
    db.getGuild.mockResolvedValue({ installed: true, config: defaultConfig });
    await expect(
      executeCommunity(client, rest, { ...input(), action: "refresh" })
    ).resolves.toMatchObject({ state: "published" });
    expect(rest.get).toHaveBeenCalledWith(
      `/channels/${cid}/messages/${mid}`,
      expect.anything()
    );
    expect(
      db.recordCommunityResult.mock.calls[0][4].answers[0].votes
    ).toBeNull();
    expect(rest.post).not.toHaveBeenCalled();
    await executeCommunity(client, rest, { ...input(), action: "close" });
    expect(rest.post).toHaveBeenCalledWith(
      `/channels/${cid}/polls/${mid}/expire`,
      expect.anything()
    );
    expect(db.recordCommunityResult.mock.calls[1][5]).toBe(true);
  });
  it("never closes another author's poll", async () => {
    post.state = "published";
    post.messageId = mid;
    rest.get.mockResolvedValue({ author: { id: uid }, poll: native() });
    await expect(
      executeCommunity(client, rest, { ...input(), action: "close" })
    ).rejects.toThrow();
    expect(rest.post).not.toHaveBeenCalled();
  });
});
