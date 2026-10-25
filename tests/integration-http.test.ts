import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidUpstreamResponse,
  providerJson,
  readBoundedText,
  UpstreamError,
  upstreamError,
} from "../packages/core/src/integration-http";

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);

afterEach(() => vi.unstubAllGlobals());

describe("provider transport guarantees", () => {
  it("classifies provider failures without leaking bodies or URLs", async () => {
    for (const [status, kind, retryable] of [
      [401, "auth", false],
      [403, "auth", false],
      [404, "not-found", false],
      [429, "rate-limited", true],
      [500, "unavailable", true],
      [400, "rejected", false],
    ] as const) {
      const error = upstreamError(status) as UpstreamError;
      expect(error.kind).toBe(kind);
      expect(error.retryable).toBe(retryable);
      expect(error.message).not.toMatch(/api[_-]?key|token|password/i);
    }
    expect(upstreamError(429, "60").retryAfterMs).toBe(60000);
    expect(upstreamError(429, "not-a-date").retryAfterMs).toBeUndefined();
    expect(invalidUpstreamResponse().kind).toBe("invalid-response");
    expect(new UpstreamError(504, undefined, "timeout").retryable).toBe(true);
  });

  it("never follows redirects, never caches, and always times out", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    await providerJson("https://provider.example/api", {
      timeoutMs: 3000,
      headers: { authorization: "Bearer secret" },
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json", authorization: "Bearer secret" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timeout as a provider timeout, not a bad request", async () => {
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeout;
      })
    );
    await expect(
      providerJson("https://provider.example/api")
    ).rejects.toMatchObject({ kind: "timeout", status: 504, retryable: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(
      providerJson("https://provider.example/api")
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("rejects non-JSON and oversized bodies instead of parsing them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>nope</html>"))
    );
    await expect(
      providerJson("https://provider.example/api")
    ).rejects.toMatchObject({ kind: "invalid-response" });
    const huge = new Response("x".repeat(2048));
    await expect(readBoundedText(huge, 1024)).rejects.toMatchObject({
      kind: "invalid-response",
    });
    // A declared length above the ceiling short-circuits before reading.
    const declared = new Response("ok", {
      headers: { "content-length": "999999999" },
    });
    await expect(readBoundedText(declared, 1024)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("keeps provider Retry-After and maps HTTP failures to 502 at the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          { message: "slow down" },
          { status: 429, headers: { "retry-after": "7" } }
        )
      )
    );
    await expect(
      providerJson("https://provider.example/api")
    ).rejects.toMatchObject({
      kind: "rate-limited",
      status: 429,
      retryAfterMs: 7000,
    });
  });

  it("does not retry a provider request on its own", async () => {
    const fetcher = vi.fn(async () => json({ error: "boom" }, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      providerJson("https://provider.example/api")
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
