import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, decrypt } from "@orbit/core";
const deps = vi.hoisted(() => ({
  cookie: vi.fn(),
  rows: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  guilds: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: deps.cookie }),
}));
vi.mock("@orbit/db", async () => ({
  schema: await import("../packages/db/src/schema"),
  listInstalledGuilds: async () => [],
  database: () => ({
    db: {
      select: () => ({ from: () => ({ where: deps.rows }) }),
      insert: () => ({ values: deps.insert }),
      update: () => ({
        set: (value: unknown) => {
          deps.update(value);
          return {
            where: () => ({ returning: deps.saved }),
          };
        },
      }),
    },
  }),
}));
vi.mock("@orbit/core/discord-permissions", () => ({
  createDiscordPermissionState: () => ({}),
  DiscordPermissionClient: class {
    guilds = deps.guilds;
  },
  isDiscordPermissionError: () => false,
}));
import { GET as oauthCallback } from "../apps/web/app/api/auth/callback/route";
import {
  createSession,
  identity,
  manageableGuilds,
  fetchDiscordProfile,
  exchangeDiscordToken,
  refreshProfile,
} from "../apps/web/lib/auth";
const secret = "test-only-identity-secret-not-for-deployment";
const uid = "120000000000000099";
const avatar = "0123456789abcdef0123456789abcdef";
const oauth = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  expires_in: 3600,
};
const discordUser = {
  id: uid,
  username: "account_name",
  global_name: "Global name",
  avatar,
};
function session() {
  return {
    id: "session",
    userId: uid,
    name: "Global name",
    avatar,
    accessToken: encrypt(oauth.access_token, secret),
    refreshToken: encrypt(oauth.refresh_token, secret),
    tokenExpiresAt: new Date(Date.now() + 3600000),
    expiresAt: new Date(Date.now() + 86400000),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("APP_SECRET", secret);
  vi.stubEnv("APP_URL", "https://orbit.example.invalid");
  vi.stubEnv("DISCORD_CLIENT_ID", "120000000000000100");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "test-only-client-secret");
  deps.cookie.mockReturnValue({ value: "opaque-cookie" });
  deps.rows.mockResolvedValue([session()]);
  deps.insert.mockResolvedValue(undefined);
  deps.saved.mockResolvedValue([{ id: "session" }]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("OAuth identity characterization before simplification", () => {
  it("persists display-name/avatar metadata and encrypted tokens, not the raw cookie", async () => {
    const cookie = await createSession(oauth, discordUser);
    expect(cookie.length).toBeGreaterThan(32);
    const row = deps.insert.mock.calls[0][0];
    expect(row).toMatchObject({ userId: uid, name: "Global name", avatar });
    expect(row.id).not.toBe(cookie);
    expect(row.accessToken).not.toBe(oauth.access_token);
    expect(decrypt(row.accessToken, secret)).toBe(oauth.access_token);
    expect(decrypt(row.refreshToken, secret)).toBe(oauth.refresh_token);
  });
  it("preserves username and null-avatar fallbacks", async () => {
    await createSession(oauth, {
      ...discordUser,
      global_name: null,
      avatar: null,
    });
    expect(deps.insert.mock.calls[0][0]).toMatchObject({
      name: "account_name",
      avatar: null,
    });
  });
  it("returns the current session metadata and switches accounts without a global profile cache", async () => {
    expect(await identity()).toMatchObject({
      id: uid,
      name: "Global name",
      avatar,
    });
    deps.rows.mockResolvedValue([
      {
        ...session(),
        userId: "120000000000000098",
        name: "Second account",
        avatar: null,
      },
    ]);
    expect(await identity()).toMatchObject({
      id: "120000000000000098",
      name: "Second account",
      avatar: null,
    });
  });
  it("does not exchange a token or read a profile when no valid session exists", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    deps.cookie.mockReturnValue(undefined);
    expect(await identity()).toBeNull();
    expect(deps.rows).not.toHaveBeenCalled();
    deps.cookie.mockReturnValue({ value: "opaque-cookie" });
    deps.rows.mockResolvedValue([]);
    expect(await identity()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refreshes an expiring OAuth token server-side, keeping the identity snapshot", async () => {
    deps.rows.mockResolvedValue([
      { ...session(), tokenExpiresAt: new Date(0) },
    ]);
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        ...oauth,
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      })
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await identity()).toMatchObject({
      id: uid,
      avatar,
      accessToken: "rotated-access",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/oauth2/token");
    expect(options.body.get("grant_type")).toBe("refresh_token");
    expect(decrypt(deps.update.mock.calls[0][0].refreshToken, secret)).toBe(
      "rotated-refresh"
    );
  });
  it("fails closed on a refused refresh and on absent live OAuth context", async () => {
    deps.rows.mockResolvedValue([
      { ...session(), tokenExpiresAt: new Date(0) },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    );
    expect(await identity()).toBeNull();
    expect(deps.update).not.toHaveBeenCalled();
    await expect(
      manageableGuilds({ id: uid, name: "No token", avatar: null })
    ).rejects.toMatchObject({ status: 401 });
    expect(deps.guilds).not.toHaveBeenCalled();
  });
});

describe("typed OAuth boundaries", () => {
  it("rejects malformed token/profile responses before creating a session", async () => {
    await expect(
      createSession({ ...oauth, expires_in: -1 }, discordUser)
    ).rejects.toThrow();
    await expect(
      createSession(oauth, { ...discordUser, id: "forged" })
    ).rejects.toThrow();
    expect(deps.insert).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ access_token: "partial" }))
    );
    await expect(
      exchangeDiscordToken({
        grant_type: "refresh_token",
        refresh_token: "test",
      })
    ).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ...discordUser, avatar: {} }))
    );
    await expect(fetchDiscordProfile("test-access")).rejects.toMatchObject({
      status: 503,
    });
  });
  it("retains only validated profile fields and never accepts redirects or caches OAuth responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        ...discordUser,
        email: "private@example.invalid",
        unexpected: "discard me",
      })
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchDiscordProfile("test-access")).toEqual(discordUser);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      redirect: "error",
    });
  });
  it("distinguishes a temporarily unavailable upstream from a revoked sign-in without exposing bodies", async () => {
    for (const [upstream, expected] of [
      [401, 401],
      [429, 503],
      [500, 503],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("private-upstream-body", { status: upstream })
          )
      );
      await expect(fetchDiscordProfile("test-access")).rejects.toMatchObject({
        status: expected,
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private-transport-detail"))
    );
    await expect(fetchDiscordProfile("test-access")).rejects.toMatchObject({
      status: 503,
      message: "Discord is temporarily unavailable. Try again shortly.",
    });
  });
});

describe("explicit current-account metadata refresh", () => {
  it("updates the persisted global avatar/name, including removal, without changing tokens", async () => {
    const user = (await identity())!;
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...discordUser, global_name: null, avatar: null })
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await refreshProfile(user)).toMatchObject({
      id: uid,
      name: "account_name",
      avatar: null,
      accessToken: oauth.access_token,
    });
    expect(deps.update).toHaveBeenLastCalledWith({
      name: "account_name",
      avatar: null,
    });
  });
  it("rejects an upstream account mismatch before any profile write", async () => {
    const user = (await identity())!;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...discordUser, id: "120000000000000098" })
        )
    );
    await expect(refreshProfile(user)).rejects.toMatchObject({ status: 401 });
    expect(deps.update).not.toHaveBeenCalled();
  });
  it("does not recreate a revoked or expired session after the external request", async () => {
    const user = (await identity())!;
    deps.saved.mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(discordUser))
    );
    await expect(refreshProfile(user)).rejects.toMatchObject({ status: 401 });
    expect(deps.insert).not.toHaveBeenCalled();
  });
  it("never reads credentials or contacts Discord for a demo profile", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const user = (await identity())!;
    expect(await refreshProfile(user)).toEqual(user);
    expect(fetcher).not.toHaveBeenCalled();
    expect(deps.rows).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });
});

it("keeps OAuth state validation and HTTP-only session creation through the real callback", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(oauth))
    .mockResolvedValueOnce(
      Response.json({ ...discordUser, email: "private@example.invalid" })
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await oauthCallback(
    new Request(
      "https://orbit.example.invalid/api/auth/callback?code=example-code&state=opaque-cookie"
    )
  );
  expect(result.status).toBe(307);
  expect(result.headers.get("location")).toBe("https://orbit.example.invalid/");
  expect(result.headers.get("set-cookie")).toMatch(/orbit_session=.*HttpOnly/);
  expect(result.headers.get("set-cookie")).not.toContain(oauth.access_token);
  expect(deps.insert.mock.calls[0][0]).toMatchObject({
    userId: uid,
    avatar,
    name: "Global name",
  });
  expect(deps.insert.mock.calls[0][0]).not.toHaveProperty("email");
  expect(fetcher.mock.calls[0][1].body.get("grant_type")).toBe(
    "authorization_code"
  );
  expect(fetcher.mock.calls[0][1].body.get("redirect_uri")).toBe(
    "https://orbit.example.invalid/api/auth/callback"
  );
  fetcher.mockClear();
  expect(
    (
      await oauthCallback(
        new Request(
          "https://orbit.example.invalid/api/auth/callback?code=example-code&state=wrong"
        )
      )
    ).status
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
