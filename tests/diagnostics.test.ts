import { diagnosticText, errorDiagnostic } from "@orbit/core/diagnostics";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());
describe("safe, copyable diagnostics", () => {
  it("preserves multiline whitespace and meaningful Java text instead of normalizing it", () => {
    const raw =
      "  Source failed\n\tjava.example.Loader.<init>(Loader.java:42)\r\n  nested cause  ";
    expect(diagnosticText(raw, 8192, {})).toBe(raw);
  });
  it("redacts known raw and URL-encoded secrets before truncating", () => {
    const value = "my secret/long password";
    const text = diagnosticText(
      `${value} ${encodeURIComponent(value)} ${"x".repeat(9000)}`,
      100,
      { LAVALINK_PASSWORD: value }
    );
    expect(text).not.toContain(value);
    expect(text).not.toContain(encodeURIComponent(value));
    expect(text.length).toBe(100);
    expect(text.endsWith("[diagnostic truncated]")).toBe(true);
  });
  it("redacts URL userinfo and all query/fragment values, including unknown signed parameters", () => {
    const text = diagnosticText(
      "HTTP 403 https://alice:privatepass@api.example/track?client_id=abc123&Signature=private-signature&x=private-query#private-fragment",
      8192,
      {}
    );
    for (const secret of [
      "alice",
      "privatepass",
      "abc123",
      "private-signature",
      "private-query",
      "private-fragment",
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain("HTTP 403");
    expect(text).toContain("api.example/track");
  });
  it("still sanitizes signed queries after a known credential was replaced inside the URL", () => {
    const text = diagnosticText(
      "https://api.example/?token=known-secret&Signature=other-secret",
      8192,
      { DISCORD_TOKEN: "known-secret" }
    );
    expect(text).not.toContain("known-secret");
    expect(text).not.toContain("other-secret");
  });
  it("redacts bare authorization and credential fields without logging arbitrary error properties", () => {
    const text = diagnosticText(
      'Authorization: Bearer private-bearer\n"password": "private password"\nclient_id=private-client\napi_key=private-key\naccess_token=private-access',
      8192,
      {}
    );
    expect(text).not.toContain("private");
    const error = Object.assign(new Error("Safe failure"), {
      request: { headers: { authorization: "do-not-dump" } },
    });
    expect(errorDiagnostic(error)).toBe("Safe failure");
  });
  it("redacts gateway/voice session IDs and sensitive endpoint fields in provider error messages", () => {
    const text = diagnosticText(
      'session_id=private-session\n"sessionId": "another-private-session"\n"endpoint":"private-voice.example"\ntoken=private-token',
      8192,
      {}
    );
    expect(text).not.toContain("private-");
  });
  it("masks short standalone development credentials and non-HTTP URL userinfo", () => {
    expect(
      diagnosticText("Password rejected: abc", 8192, {
        LAVALINK_PASSWORD: "abc",
      })
    ).toBe("Password rejected: [REDACTED]");
    const text = diagnosticText(
      "postgres://private-user:private-db-password@db.example/test?key=private-query",
      8192,
      {}
    );
    expect(text).not.toContain("private-user");
    expect(text).not.toContain("private-db-password");
    expect(text).not.toContain("private-query");
  });
  it("uses bounded message/cause chains, not stack traces or raw error objects", () => {
    vi.stubEnv("DISCORD_TOKEN", "private-discord-token");
    const error = new Error("fetch failed", {
      cause: new Error("ECONNREFUSED private-discord-token"),
    });
    expect(errorDiagnostic(error)).toBe(
      "fetch failed\nCaused by: ECONNREFUSED [REDACTED]"
    );
    expect(errorDiagnostic({ message: "untrusted arbitrary object" })).toBe(
      "Unknown error"
    );
  });
  it("removes terminal escapes/control characters without flattening newlines", () => {
    expect(diagnosticText("\x1b[31mFailure\x1b[0m\0\n\tCause", 8192, {})).toBe(
      "Failure\n\tCause"
    );
  });
  it("does not shorten normal diagnostic errors to the previous 300/1000 character limits", () => {
    const text = `Failure\n${"cause ".repeat(500)}`;
    expect(errorDiagnostic(new Error(text))).toBe(text);
  });
});
