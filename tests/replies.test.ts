import type { MusicState, Track } from "@orbit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  balanceCard,
  commandErrorReply,
  commandReply,
  dailyCard,
  leaderboardCard,
  musicActionCard,
  queueCard,
  replyCodeBlock,
} from "../apps/bot/src/interactions/replies";

const economy = { currency: "Stardust", symbol: "✦" };
const track: Track = {
  id: "track-1",
  title: "A public track",
  author: "An artist",
  duration: 225000,
  uri: "https://soundcloud.com/artist/track?token=private-url-query",
  encoded: "never-include-encoded-tracks-in-replies",
  requestedBy: "Member",
};
const state: MusicState = {
  tracks: [],
  current: null,
  paused: false,
  volume: 50,
  repeat: "off",
  position: 0,
  updatedAt: "2026-10-24T00:00:00Z",
};
const embed = (reply: ReturnType<typeof commandReply>) =>
  reply.embeds[0].toJSON();

afterEach(() => vi.unstubAllEnvs());
describe("Discord command embeds", () => {
  it("renders daily reward and wallet as structured fields rather than a text blob", () => {
    const reply = commandReply(
      "daily",
      dailyCard({ amount: 250, balance: 1250 }, economy)
    );
    expect(reply.content).toBe("");
    expect(reply.allowedMentions).toEqual({ parse: [] });
    expect(embed(reply)).toMatchObject({
      title: "✦ Daily reward claimed",
      color: 0x43c59e,
      fields: [
        { name: "Reward", value: "**+250** ✦ Stardust", inline: true },
        { name: "New balance", value: "**1,250** ✦ Stardust", inline: true },
      ],
    });
    expect(embed(reply).footer?.text).toContain("24 hours");
    expect(
      embed(commandReply("balance", balanceCard("Member", 1250, economy)))
        .fields?.[0].value
    ).toBe("**1,250** ✦ Stardust");
  });
  it("escapes display names/currency and never permits automatic mentions", () => {
    const reply = commandReply(
      "balance",
      balanceCard("**Admin** @everyone <@123456789012345678>", 7, {
        symbol: "`✦`",
        currency: "[click](https://example.com)",
      })
    );
    const data = embed(reply);
    expect(data.description).toContain("\\*\\*Admin\\*\\*");
    expect(data.description).not.toContain("@everyone");
    expect(data.description).not.toContain("<@123456789012345678>");
    expect(data.fields?.[0].value).toContain("\\`✦\\`");
    expect(data.fields?.[0].value).toContain("\\[click](");
    expect(reply.allowedMentions).toEqual({ parse: [] });
  });
  it("renders only the first ten wallets and provides an empty-state command hint", () => {
    const accounts = Array.from({ length: 11 }, (_, n) => ({
      name: `Member-${n + 1}`,
      balance: 1100 - n * 100,
    }));
    const data = embed(
      commandReply("leaderboard", leaderboardCard(accounts, economy))
    );
    expect(data.title).toBe("Community leaderboard");
    expect(data.description).toContain("🥇");
    expect(data.description).toContain("Member-10");
    expect(data.description).not.toContain("Member-11");
    expect(data.description).toContain("**1,100** ✦ Stardust");
    expect(
      embed(commandReply("leaderboard", leaderboardCard([], economy)))
        .description
    ).toContain("`/daily`");
  });
  it("uses titled embeds for other commands as well", () => {
    for (const command of [
      "ping",
      "roles",
      "role-panel",
      "warn",
      "purge",
      "cases",
      "transfer",
      "shop",
      "inventory",
      "deals",
      "news",
    ]) {
      const reply = commandReply(command, "Command result @here");
      expect(embed(reply).title).not.toBe("Command complete");
      expect(embed(reply).description).toContain("＠here");
      expect(reply.allowedMentions.parse).toEqual([]);
    }
  });
  it("preserves sanitized multiline diagnostics in a closed text code block", () => {
    vi.stubEnv("LAVALINK_PASSWORD", "test-secret-lavalink-password");
    const reply = commandErrorReply(
      "play",
      [
        "SoundCloud track lookup failed.",
        "Cause: Did not detect any supported formats",
        "Backend: Lavalink 4.2.2; Lavaplayer 2.2.6",
        "https://provider.example/stream?token=private-query-value",
        "Authorization: Bearer test-secret-lavalink-password",
        "``` @everyone fake embed <@123456789012345678>",
      ].join("\n")
    );
    const data = embed(reply);
    expect(data.title).toBe("Could not complete /play");
    expect(data.color).toBe(0xf87171);
    expect(data.description).toContain("```text\nSoundCloud");
    expect(data.description).toContain(
      "\nCause: Did not detect any supported formats\nBackend:"
    );
    expect(data.description).toMatch(/\n```$/);
    expect(data.description?.match(/```/g)).toHaveLength(2);
    for (const secret of [
      "test-secret-lavalink-password",
      "private-query-value",
      "@everyone",
      "<@123456789012345678>",
    ])
      expect(data.description).not.toContain(secret);
  });
  it("shortens oversized diagnostic blocks before adding fences without changing the caller's stored detail", () => {
    const original = `Java error\n${"long cause\n".repeat(1000)}`;
    const data = embed(commandErrorReply("play", original));
    expect(data.description!.length).toBeLessThanOrEqual(4096);
    expect(data.description).toContain("shortened for Discord");
    expect(data.description).toMatch(/\n```$/);
    expect(original).toHaveLength(11011);
    const code = replyCodeBlock("😀".repeat(3000));
    expect(code.length).toBeLessThanOrEqual(3600);
    expect(code).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it("enforces the embed's per-part, field-count, and 6000-character aggregate limits", () => {
    const reply = commandReply("test", {
      title: "t".repeat(500),
      footer: "f".repeat(1000),
      description: "d".repeat(5000),
      fields: Array.from({ length: 30 }, () => ({
        name: "n".repeat(500),
        value: "v".repeat(1500),
      })),
    });
    const data = embed(reply);
    expect(data.title!.length).toBeLessThanOrEqual(256);
    expect(data.description!.length).toBeLessThanOrEqual(4096);
    expect(data.fields!.length).toBeLessThanOrEqual(25);
    let total =
      data.title!.length + data.description!.length + data.footer!.text.length;
    for (const field of data.fields!) {
      expect(field.name.length).toBeLessThanOrEqual(256);
      expect(field.value.length).toBeLessThanOrEqual(1024);
      total += field.name.length + field.value.length;
    }
    expect(total).toBeLessThanOrEqual(6000);
  });
});
describe("listening-room cards", () => {
  it("shows track metadata, queue positions/duration and state without private source URLs or encoded tracks", () => {
    const data = embed(
      commandReply(
        "queue",
        queueCard({ ...state, current: track, tracks: [track], paused: true })
      )
    );
    expect(data.description).toContain("Current track · paused");
    expect(data.description).toContain(
      "**1.** A public track — An artist · 3:45"
    );
    // Every field is asserted: source link, requester, progress, voice, volume,
    // repeat — in that order, and nothing invented when a value is unknown.
    expect(data.fields?.map((f) => [f.name, f.value])).toEqual([
      [
        "Source",
        "[Open on soundcloud.com](https://soundcloud.com/artist/track)",
      ],
      ["Requested by", "Member"],
      ["Progress", "0:00 / 3:45 · 3:45 remaining"],
      ["Voice", "Not connected"],
      ["Volume", "50%"],
      ["Repeat", "off"],
    ]);
    expect(JSON.stringify(data)).not.toContain("private-url-query");
    // The public page is linked; the stream identifier is not.
    expect(JSON.stringify(data)).not.toContain("soundcloud.com/artist/track?");
    expect(JSON.stringify(data)).not.toContain("never-include-encoded");
    expect(
      embed(commandReply("queue", queueCard(state))).description
    ).toContain("`/play`");
  });
  it("bounds very long queues and does not claim accepted playback was heard", () => {
    const queued = {
      ...state,
      current: track,
      tracks: Array.from({ length: 100 }, () => ({
        ...track,
        title: "`".repeat(200),
        author: "*".repeat(100),
      })),
    };
    const queue = embed(commandReply("queue", queueCard(queued)));
    expect(queue.description!.length).toBeLessThanOrEqual(3800);
    expect(queue.description).toContain("showing the next 15 tracks");
    const play = embed(commandReply("play", musicActionCard("play", queued)));
    expect(play.title).toBe("Play request accepted");
    expect(play.footer?.text).toContain("does not verify audible playback");
    const stop = embed(commandReply("stop", musicActionCard("stop", state)));
    expect(stop.description).toContain("cleared the queue");
    expect(stop.fields).toBeUndefined();
    expect(
      embed(commandReply("skip", musicActionCard("skip", queued))).description
    ).toContain("skip request was sent");
  });
});
describe("music card links and artwork", () => {
  const youtube: Track = {
    ...track,
    source: "youtube",
    uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking-value",
    artwork: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  };
  it("links the provider page, embeds artwork and names the provider", () => {
    const data = embed(
      commandReply(
        "queue",
        queueCard(
          { ...state, current: youtube, tracks: [] },
          { voiceChannel: "Listening room", queueLimit: 100 }
        )
      )
    );
    // Tracking parameters are dropped; the watch id survives.
    expect(data.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(data.thumbnail?.url).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    );
    expect(data.fields?.[0]).toMatchObject({
      name: "Source",
      value: "[Open on YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
    });
    expect(data.fields).toContainEqual(
      expect.objectContaining({ name: "Voice", value: "Listening room" })
    );
    const play = embed(
      commandReply(
        "play",
        musicActionCard("play", { ...state, current: youtube, tracks: [] })
      )
    );
    expect(play.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  it("refuses unsafe pages and artwork instead of rendering them", () => {
    const hostile: Track = {
      ...youtube,
      uri: "javascript:alert(1)",
      artwork: "http://127.0.0.1/private.png",
    };
    const data = embed(
      commandReply(
        "queue",
        queueCard({ ...state, current: hostile, tracks: [] })
      )
    );
    expect(data.url).toBeUndefined();
    expect(data.thumbnail).toBeUndefined();
    expect(data.fields?.some((f) => f.name === "Source")).toBe(false);
    const credentialed = embed(
      commandReply(
        "queue",
        queueCard({
          ...state,
          current: { ...youtube, uri: "https://user:pw@youtube.com/watch?v=x" },
          tracks: [],
        })
      )
    );
    expect(credentialed.url).toBeUndefined();
  });
  it("reports progress only when the backend reported a duration", () => {
    const data = embed(
      commandReply(
        "queue",
        queueCard({
          ...state,
          current: { ...track, duration: 0 },
          tracks: [],
          position: 5000,
        })
      )
    );
    expect(data.fields?.some((f) => f.name === "Progress")).toBe(false);
  });
});
