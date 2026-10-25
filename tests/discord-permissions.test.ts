import { canManageGuild } from "@orbit/core";
import {
  createDiscordPermissionState,
  DiscordPermissionClient,
  DiscordPermissionError,
} from "@orbit/core/discord-permissions";
import { describe, expect, it, vi } from "vitest";

const guild = {
  id: "120000000000000001",
  name: "Test community",
  owner: false,
  permissions: "32",
  icon: null,
};
const ok = (data: unknown = [guild], headers?: HeadersInit) =>
  Response.json(data, { headers });
function fixture(maxEntries = 1000) {
  const clock = { now: 1000000 };
  const fetcher = vi.fn<typeof fetch>(async () => ok());
  const onFailure = vi.fn();
  const state = createDiscordPermissionState();
  const client = new DiscordPermissionClient({
    state,
    fetcher,
    onFailure,
    now: () => clock.now,
    maxEntries,
  });
  return { clock, fetcher, onFailure, state, client };
}

describe("Discord OAuth permission lookup reliability", () => {
  it("coalesces concurrent page/API lookups, including separate clients sharing process state", async () => {
    const f = fixture();
    let complete!: (r: Response) => void;
    f.fetcher.mockReturnValueOnce(new Promise((r) => (complete = r)));
    const other = new DiscordPermissionClient({
      state: f.state,
      fetcher: f.fetcher,
    });
    const requests = Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? other : f.client).guilds("session", "test-access-token")
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    complete(ok());
    const results = await Promise.all(requests);
    expect(results.every((r) => r[0].id === guild.id)).toBe(true);
    expect(f.state.pending.size).toBe(0);
    expect([...f.state.entries.keys()].join()).not.toContain(
      "test-access-token"
    );
  });

  it("reuses read permissions for no more than 30 seconds", async () => {
    const f = fixture();
    await f.client.guilds("session", "token");
    f.clock.now += 29999;
    await f.client.guilds("session", "token");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.clock.now++;
    await f.client.guilds("session", "token");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("bypasses positive read caching for mutations and coalesces concurrent fresh checks", async () => {
    const f = fixture();
    await f.client.guilds("session", "token");
    await Promise.all(
      Array.from({ length: 10 }, () =>
        f.client.guilds("session", "token", { maxAgeMs: 0 })
      )
    );
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls[1][1]).toMatchObject({
      cache: "no-store",
      headers: { Authorization: "Bearer token" },
    });
  });

  it("reuses a mutation snapshot inside the short window and refetches after it", async () => {
    const f = fixture();
    // Dashboard controls burst: pause, skip, volume, repeat within seconds.
    for (const maxAgeMs of [10000, 10000, 10000, 10000]) {
      await f.client.guilds("session", "token", { maxAgeMs });
      f.clock.now += 500;
    }
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.clock.now += 10000;
    await f.client.guilds("session", "token", { maxAgeMs: 10000 });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    // Any age forces a lookup when the caller must observe revocation now.
    await f.client.guilds("session", "token", { maxAgeMs: 0 });
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });

  it("still coalesces concurrent forced lookups instead of multiplying requests", async () => {
    const f = fixture();
    await f.client.guilds("session", "token");
    await Promise.all(
      Array.from({ length: 8 }, () =>
        f.client.guilds("session", "token", { maxAgeMs: 0 })
      )
    );
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("words the retry hint with correct singular and plural", () => {
    expect(new DiscordPermissionError(429, 1).message).toBe(
      "Discord is rate limiting permission checks. Please try again in 1 second."
    );
    expect(new DiscordPermissionError(429, 2).message).toBe(
      "Discord is rate limiting permission checks. Please try again in 2 seconds."
    );
    expect(new DiscordPermissionError(429).message).toBe(
      "Discord is rate limiting permission checks. Please try again in 30 seconds."
    );
  });

  it("observes revoked permissions on a fresh check instead of retaining earlier access", async () => {
    const f = fixture();
    expect(
      (await f.client.guilds("session", "token")).filter(canManageGuild)
    ).toHaveLength(1);
    f.fetcher.mockResolvedValueOnce(ok([{ ...guild, permissions: "0" }]));
    expect(
      (await f.client.guilds("session", "token", { maxAgeMs: 0 })).filter(
        canManageGuild
      )
    ).toEqual([]);
    expect(
      (await f.client.guilds("session", "token")).filter(canManageGuild)
    ).toEqual([]);
  });

  it("honors fractional Retry-After, reset-after, and JSON retry_after without hammering Discord", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      Response.json(
        { retry_after: 3.5 },
        {
          status: 429,
          headers: { "Retry-After": "1.25", "X-RateLimit-Reset-After": "2.25" },
        }
      )
    );
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 4,
      upstreamStatus: 429,
    });
    f.clock.now += 1500;
    await expect(
      f.client.guilds("session", "token", { maxAgeMs: 0 })
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 2 });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.clock.now += 2000;
    await expect(f.client.guilds("session", "token")).resolves.toHaveLength(1);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("supports HTTP-date Retry-After headers", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      Response.json(
        {},
        {
          status: 429,
          headers: {
            "Retry-After": new Date(f.clock.now + 5000).toUTCString(),
          },
        }
      )
    );
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 5,
    });
  });

  it("uses a conservative cooldown for a 429 without valid JSON or timing headers", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 })
    );
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    });
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 429,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed and discards an earlier snapshot after a fresh lookup fails", async () => {
    const f = fixture();
    await f.client.guilds("session", "token");
    f.fetcher.mockResolvedValueOnce(
      Response.json({ retry_after: 20 }, { status: 429 })
    );
    await expect(
      f.client.guilds("session", "token", { maxAgeMs: 0 })
    ).rejects.toMatchObject({ status: 429 });
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 429,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not use expired permissions when Discord reports an exhausted bucket", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      ok([guild], {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset-After": "60",
      })
    );
    await f.client.guilds("session", "token");
    await f.client.guilds("session", "token");
    await expect(
      f.client.guilds("session", "token", { maxAgeMs: 0 })
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
    f.clock.now += 30000;
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.clock.now += 30000;
    await f.client.guilds("session", "token", { maxAgeMs: 0 });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps sessions, rotated tokens, and ordinary rate-limit windows isolated", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      Response.json({ retry_after: 20 }, { status: 429 })
    );
    await expect(f.client.guilds("one", "old-token")).rejects.toMatchObject({
      status: 429,
    });
    await f.client.guilds("two", "another-token");
    await f.client.guilds("one", "new-token");
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });

  it("honors a global Discord 429 across sessions in the same process", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      Response.json({ global: true, retry_after: 5 }, { status: 429 })
    );
    await expect(f.client.guilds("one", "token1")).rejects.toMatchObject({
      status: 429,
    });
    await expect(f.client.guilds("two", "token2")).rejects.toMatchObject({
      status: 429,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.clock.now += 5000;
    await f.client.guilds("two", "token2");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])(
    "maps OAuth HTTP %i to reauthentication and never cached access",
    async (status) => {
      const f = fixture();
      await f.client.guilds("session", "token");
      f.fetcher.mockResolvedValueOnce(Response.json({}, { status }));
      await expect(
        f.client.guilds("session", "token", { maxAgeMs: 0 })
      ).rejects.toMatchObject({ status: 401, upstreamStatus: status });
      await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
        status: 401,
      });
      expect(f.onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ upstreamStatus: status })
      );
    }
  );

  it.each([500, 502, 503])(
    "treats upstream HTTP %i as temporary unavailability, not a bad login",
    async (status) => {
      const f = fixture();
      f.fetcher.mockResolvedValueOnce(Response.json({}, { status }));
      await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
        status: 503,
        retryAfterSeconds: 5,
      });
      await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
        status: 503,
      });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it("handles network failures without logging tokens or caching previous access", async () => {
    const f = fixture();
    await f.client.guilds("session", "sensitive-test-token");
    f.fetcher.mockRejectedValueOnce(
      new Error("transport error containing sensitive-test-token")
    );
    await expect(
      f.client.guilds("session", "sensitive-test-token", { maxAgeMs: 0 })
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      f.client.guilds("session", "sensitive-test-token")
    ).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify(f.onFailure.mock.calls)).not.toContain(
      "sensitive-test-token"
    );
    expect(f.state.pending.size).toBe(0);
  });

  it.each([
    { error: "not a guild array" },
    [{ ...guild, permissions: "invalid" }],
  ])("rejects malformed permission data", async (body) => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(ok(body));
    await expect(f.client.guilds("session", "token")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("accepts an empty verified membership list without granting access", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(ok([]));
    expect(await f.client.guilds("session", "token")).toEqual([]);
  });

  it("bounds the permission snapshot cache", async () => {
    const f = fixture(2);
    for (let i = 0; i < 5; i++) await f.client.guilds(`session-${i}`, "token");
    expect(f.state.entries.size).toBe(2);
    expect(f.state.pending.size).toBe(0);
  });

  it("requires a real session and access token before attempting a lookup", async () => {
    const f = fixture();
    await expect(f.client.guilds("", "token")).rejects.toMatchObject({
      status: 401,
    });
    await expect(f.client.guilds("session", "")).rejects.toMatchObject({
      status: 401,
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
