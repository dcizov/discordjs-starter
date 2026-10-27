import {
  diagnosticText,
  errorDiagnostic,
  parseClientFailureGroups,
  truncateAtWord,
} from "@orbit/core/diagnostics";
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

describe("per-client Lavalink failure groups", () => {
  it("reads each client's own answer and drops the stack frames that follow it", () => {
    const groups = parseClientFailureGroups(
      [
        "Client [ANDROID_VR] failed: This video requires login.",
        "\tat dev.lavalink.youtube.clients.skeleton.Client.getPlayabilityStatus(Client.java:77)",
        "\tat dev.lavalink.youtube.track.YoutubeAudioTrack.processWithClient(YoutubeAudioTrack.java:131)",
        "Client [WEB] failed: No supported audio streams available.",
        "\tat dev.lavalink.youtube.clients.skeleton.Client.getPlayabilityStatus(Client.java:77)",
        "Client [WEBEMBEDDED] failed: This video is unavailable.",
        "dev.lavalink.youtube.AllClientsFailedException: (yts.version: 1.18.2) All clients failed to load the item.",
      ].join("\n")
    );
    expect(groups).toEqual([
      { clients: ["ANDROID_VR"], reason: "This video requires login." },
      { clients: ["WEB"], reason: "No supported audio streams available." },
      { clients: ["WEBEMBEDDED"], reason: "This video is unavailable." },
    ]);
  });
  it("groups clients that worded their answer the same way", () => {
    const groups = parseClientFailureGroups(
      [
        "Client [ANDROID_VR] failed: This video requires login.",
        "Client [TVHTML5] failed: this video requires login.",
        "Client [MWEB] failed:   This   video requires login.",
      ].join("\n")
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.clients).toEqual(["ANDROID_VR", "TVHTML5", "MWEB"]);
  });
  it("does not record the same client twice for one answer", () => {
    const groups = parseClientFailureGroups(
      "Client [WEB] failed: No streams.\nClient [WEB] failed: No streams."
    );
    expect(groups).toEqual([{ clients: ["WEB"], reason: "No streams." }]);
  });
  it("returns nothing when the backend reported no per-client lines", () => {
    expect(parseClientFailureGroups("HTTP 429 Too Many Requests")).toEqual([]);
    expect(parseClientFailureGroups("")).toEqual([]);
  });
  it("strips a reason that ran straight into its own stack frame", () => {
    expect(
      parseClientFailureGroups(
        "Client [WEB] failed: No streams at Client.getPlayabilityStatus(Client.java:77)"
      )
    ).toEqual([{ clients: ["WEB"], reason: "No streams" }]);
  });
  it("bounds the number of groups so one huge blob cannot flood the report", () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `Client [C${i}] failed: reason ${i}.`
    ).join("\n");
    expect(parseClientFailureGroups(text, 8)).toHaveLength(8);
  });
});

describe("word-safe truncation", () => {
  it("leaves text that already fits alone", () => {
    expect(truncateAtWord("short enough", 100)).toBe("short enough");
  });
  it("cuts at the last space instead of splitting a word", () => {
    const text = "one two three four five six seven";
    // slice(0, 20) ends inside the word "five"; the boundary cut does not.
    expect(text.slice(0, 20)).toBe("one two three four f");
    expect(truncateAtWord(text, 20)).toBe("one two three four…");
    // Tighten the budget and it still lands on a whole word.
    expect(truncateAtWord(text, 14)).toBe("one two…");
  });
  it("never exceeds the bound, even for one unbreakable word", () => {
    const result = truncateAtWord("x".repeat(500), 32);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith("…")).toBe(true);
  });
  it("keeps the cut point inside the requested budget", () => {
    for (const limit of [16, 40, 120, 300]) {
      const result = truncateAtWord("word ".repeat(200), limit);
      expect(result.length).toBeLessThanOrEqual(limit);
      // Whatever survives is a whole number of words plus the marker.
      expect(result.replace(/…$/, "").endsWith(" ")).toBe(false);
      expect(result.replace(/…$/, "")).toBe(
        "word "
          .repeat(200)
          .slice(0, result.length - 1)
          .trimEnd()
      );
    }
  });
});
