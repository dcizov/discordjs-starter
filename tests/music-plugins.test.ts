import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "shoukaku";
import {
  MusicPluginRest,
  sponsorBlockCategories,
} from "../apps/bot/src/music-plugins";

afterEach(() => vi.unstubAllGlobals());
describe("SponsorBlock per-player configuration", () => {
  it("uses real supported categories, deduplicates them and supports explicitly disabling", () => {
    expect(sponsorBlockCategories("sponsor,selfpromo,sponsor")).toEqual([
      "sponsor",
      "selfpromo",
    ]);
    expect(sponsorBlockCategories("")).toEqual([]);
    expect(() => sponsorBlockCategories("sfw,nsfw")).toThrow("unsupported");
  });
  it("uses the session/guild-scoped upstream PUT array endpoint with server-only authentication", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const node = {
      sessionId: "test/session",
      manager: { options: { restTimeout: 1, userAgent: "test-agent" } },
    } as unknown as Node;
    const rest = new MusicPluginRest(node, {
      name: "test",
      url: "lavalink:2333",
      auth: "test-only-password",
    });
    await rest.setSponsorBlock("120000000000000001", ["sponsor", "selfpromo"]);
    expect(fetch).toHaveBeenCalledWith(
      "http://lavalink:2333/v4/sessions/test%2Fsession/players/120000000000000001/sponsorblock/categories",
      expect.objectContaining({
        method: "PUT",
        body: '["sponsor","selfpromo"]',
        headers: expect.objectContaining({
          Authorization: "test-only-password",
          "Content-Type": "application/json",
        }),
      })
    );
  });
  it("never makes an unscoped plugin request without a player session/guild", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const rest = new MusicPluginRest({ sessionId: null } as Node, {
      name: "test",
      url: "lavalink:2333",
      auth: "test-only-password",
    });
    await expect(
      rest.setSponsorBlock("120000000000000001", ["sponsor"])
    ).rejects.toThrow("connected music session");
    await expect(
      rest.setSponsorBlock("../another-player", ["sponsor"])
    ).rejects.toThrow("connected music session");
    expect(fetch).not.toHaveBeenCalled();
  });
});
