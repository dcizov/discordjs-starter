import { describe, expect, it } from "vitest";
import {
  MusicConnectionReporter,
  musicConnectionDiagnostic,
} from "../apps/bot/src/features/music/connection";

const refusal = () =>
  Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:2333"), {
    code: "ECONNREFUSED",
    errno: -111,
    syscall: "connect",
    address: "127.0.0.1",
    port: 2333,
  });

describe("Lavalink connection diagnostics", () => {
  it("names a refused connect even when the library reports an empty message", () => {
    // Node's websocket client surfaces a dual-stack refusal as an AggregateError
    // whose own message is empty; the children hold the evidence.
    const error = new AggregateError(
      [
        Object.assign(new Error("connect ECONNREFUSED ::1:2333"), {
          code: "ECONNREFUSED",
        }),
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:2333"), {
          code: "ECONNREFUSED",
        }),
      ],
      ""
    );
    const diagnostic = musicConnectionDiagnostic(error, {
      node: "main",
      host: "127.0.0.1:2333",
    });
    expect(diagnostic.category).toBe("refused");
    expect(diagnostic.summary).not.toBe("");
    expect(diagnostic.summary).toContain("refused");
    expect(diagnostic.summary).toContain("ECONNREFUSED");
    expect(diagnostic.summary).toContain("127.0.0.1:2333");
    expect(diagnostic.detail).toContain("code: ECONNREFUSED");
    expect(diagnostic.detail).toContain("aggregate attempts: 2");
    expect(diagnostic.detail).toContain("node: main");
    expect(diagnostic.hint).toContain("Lavalink is running");
    expect(diagnostic.hint).toContain("lavalink:2333");
  });

  it("separates name resolution, timeouts and TLS from a refusal", () => {
    const dns = musicConnectionDiagnostic(
      Object.assign(new Error("getaddrinfo ENOTFOUND lavalink"), {
        code: "ENOTFOUND",
      }),
      { host: "lavalink:2333" }
    );
    expect(dns.category).toBe("dns");
    expect(dns.hint).toContain("did not resolve");
    expect(dns.hint).not.toContain("Lavalink is running");

    const timeout = musicConnectionDiagnostic(
      Object.assign(new Error("connect ETIMEDOUT 10.0.0.2:2333"), {
        code: "ETIMEDOUT",
      })
    );
    expect(timeout.category).toBe("timeout");
    expect(timeout.summary).toContain("did not answer");

    const tls = musicConnectionDiagnostic(
      Object.assign(new Error("self signed certificate"), {
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      }),
      { host: "lavalink:2333", secure: true }
    );
    expect(tls.category).toBe("tls");
    expect(tls.detail).toContain("target: lavalink:2333 (TLS)");
    expect(tls.hint).toContain("LAVALINK_SECURE=true");
  });

  it("reads a fetch failure through its cause chain", () => {
    const cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:2333"),
      {
        code: "ECONNREFUSED",
      }
    );
    const diagnostic = musicConnectionDiagnostic(
      new TypeError("fetch failed", { cause }),
      { host: "127.0.0.1:2333" }
    );
    expect(diagnostic.category).toBe("refused");
    expect(diagnostic.detail).toContain("name: TypeError");
    expect(diagnostic.detail).toContain("chain:");
    expect(diagnostic.hint).toContain("address and port");
  });

  it("treats an HTTP 401 as rejected credentials, not a broken network", () => {
    const diagnostic = musicConnectionDiagnostic(
      Object.assign(new Error("Lavalink /v4/info returned HTTP 401"), {
        status: 401,
      }),
      { host: "lavalink:2333" }
    );
    expect(diagnostic.category).toBe("auth");
    expect(diagnostic.summary).toContain("HTTP 401");
    expect(diagnostic.hint).toContain("LAVALINK_PASSWORD");
    expect(diagnostic.hint).not.toContain("Lavalink is running");
  });

  it("does not invent a cause when the error carries no evidence", () => {
    const diagnostic = musicConnectionDiagnostic(
      new Error("The operation was aborted"),
      { host: "lavalink:2333" }
    );
    expect(diagnostic.category).toBe("unknown");
    expect(diagnostic.hint).toBe("");
    expect(diagnostic.summary).toContain("The operation was aborted");
  });

  it("redacts credentials that appear in the library's message", () => {
    const error = new Error(
      "ws error: Authorization: Bearer private-token-value, target=https://lavalink:2333/?token=abc123"
    );
    const diagnostic = musicConnectionDiagnostic(error, {
      host: "lavalink:2333",
    });
    expect(
      `${diagnostic.summary}\n${diagnostic.detail}\n${diagnostic.hint}`
    ).not.toContain("private-token-value");
    expect(diagnostic.detail).not.toContain("abc123");
  });

  it("logs a flapping reconnect loop once and then counts it", () => {
    const reporter = new MusicConnectionReporter();
    const first = reporter.report(refusal(), { host: "127.0.0.1:2333" });
    expect(first.repeated).toBe(false);
    expect(first.repeats).toBe(1);

    const second = reporter.report(refusal(), { host: "127.0.0.1:2333" });
    expect(second.repeated).toBe(true);
    expect(second.repeats).toBe(2);
    // Health still gets a fresh, non-empty summary on every attempt.
    expect(second.summary).toBe(first.summary);

    const dns = reporter.report(
      Object.assign(new Error("getaddrinfo ENOTFOUND lavalink"), {
        code: "ENOTFOUND",
      })
    );
    expect(dns.repeated).toBe(false);
    expect(dns.repeats).toBe(1);

    reporter.reset();
    const afterDisconnect = reporter.report(refusal(), {
      host: "127.0.0.1:2333",
    });
    expect(afterDisconnect.repeated).toBe(false);
    expect(afterDisconnect.repeats).toBe(1);
  });
});
