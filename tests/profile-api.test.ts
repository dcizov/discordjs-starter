import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  identity: vi.fn(),
  refresh: vi.fn(),
  origin: vi.fn(),
  limit: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  identity: deps.identity,
  refreshProfile: deps.refresh,
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/security", () => ({
  assertOrigin: deps.origin,
  rateLimit: deps.limit,
  body: (req: Request) => req.json(),
}));
vi.mock("@orbit/core/logger", () => ({ logger: { warn: deps.warn } }));
import { POST } from "../apps/web/app/api/auth/profile/route";
import { HttpError } from "../apps/web/lib/auth";
const user = {
  id: "120000000000000099",
  name: "Global profile",
  avatar: "0123456789abcdef0123456789abcdef",
  sessionId: "private-session",
  accessToken: "private-access",
};
const request = (body: unknown = {}) =>
  POST(
    new Request("http://localhost:3000/api/auth/profile", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.identity.mockResolvedValue(user);
  deps.refresh.mockImplementation(async (current) => current);
  deps.origin.mockReturnValue(undefined);
  deps.limit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("own-profile refresh API", () => {
  it("returns only the authenticated public profile with private no-store and a bounded rate key", async () => {
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.refresh).toHaveBeenCalledWith(user);
    expect(deps.limit).toHaveBeenCalledWith(`profile:${user.id}`, 5);
    const body = await result.json();
    expect(body.user).toMatchObject({
      id: user.id,
      name: user.name,
      avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`,
    });
    expect(JSON.stringify(body)).not.toContain("private-");
  });
  it("rejects unauthenticated requests before profile I/O", async () => {
    deps.identity.mockResolvedValue(null);
    expect((await request()).status).toBe(401);
    expect(deps.refresh).not.toHaveBeenCalled();
  });
  it("checks origin before even reading a session", async () => {
    deps.origin.mockImplementation(() => {
      throw new HttpError(403, "Origin rejected");
    });
    expect((await request()).status).toBe(403);
    expect(deps.identity).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
  });
  it("accepts no forged profile or account selectors", async () => {
    expect(
      (await request({ userId: "120000000000000098", avatar: "injected" }))
        .status
    ).toBe(422);
    expect(deps.refresh).not.toHaveBeenCalled();
  });
  it("fails closed on rate limits or unavailable infrastructure and does not log private details", async () => {
    deps.limit.mockRejectedValueOnce(new HttpError(429, "Please wait"));
    expect((await request()).status).toBe(429);
    expect(deps.refresh).not.toHaveBeenCalled();
    deps.refresh.mockRejectedValueOnce(new Error("private-response-secret"));
    const result = await request();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private-response-secret");
    expect(JSON.stringify(deps.warn.mock.calls)).not.toContain(
      "private-response-secret"
    );
  });
});
