import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadType, type LavalinkResponse, type Track } from "shoukaku";
import {
  musicSourceFailure,
  prepareMusicQuery,
  resolveMusicQuery,
  type MusicNodeInfo,
  type MusicSourceSettings,
} from "../apps/bot/src/music-source";

const settings: MusicSourceSettings = {
  searchPrefix: "scsearch",
  allowedHosts: ["soundcloud.com", "bandcamp.com"],
};
const info: MusicNodeInfo = {
  version: { semver: "4.2.2" },
  lavaplayer: "test-version",
  sourceManagers: ["soundcloud", "bandcamp"],
};
const publicDns = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
function track(title = "Public track"): Track {
  return {
    encoded: `encoded-${title}`,
    info: {
      title,
      author: "Artist",
      identifier: "test",
      length: 10000,
      isSeekable: true,
      isStream: false,
      position: 0,
      sourceName: "soundcloud",
      uri: "https://soundcloud.com/artist/track",
    },
    pluginInfo: {},
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("music source resolution", () => {
  it("uses only the configured search source and does not duplicate pasted prefixes", async () => {
    expect(await prepareMusicQuery("  Daft Punk  ", settings)).toMatchObject({
      identifier: "scsearch:Daft Punk",
      source: "soundcloud",
      kind: "search",
    });
    expect(
      await prepareMusicQuery("scsearch:Daft Punk", settings)
    ).toMatchObject({ identifier: "scsearch:Daft Punk" });
    expect(
      await prepareMusicQuery("bcsearch:Public track", {
        ...settings,
        searchPrefix: "bcsearch",
      })
    ).toMatchObject({
      identifier: "bcsearch:Public track",
      source: "bandcamp",
    });
  });
  it("accepts approved public HTTPS URLs without using a search prefix", async () => {
    expect(
      await prepareMusicQuery(
        "https://artist.bandcamp.com/track/public",
        settings,
        publicDns
      )
    ).toMatchObject({ kind: "url", source: "bandcamp" });
    expect(publicDns).toHaveBeenCalledWith("artist.bandcamp.com", {
      all: true,
    });
    expect(
      await prepareMusicQuery(
        "https://soundcloud.com/artist/track",
        { ...settings, searchPrefix: "invalid" },
        publicDns
      )
    ).toMatchObject({ kind: "url" });
  });
  it.each([
    "http://soundcloud.com/artist/track",
    "https://user:secret@soundcloud.com/track",
    "https://soundcloud.com:8080/track",
    "https://soundcloud.com.attacker.example/track",
    "https://www.youtube.com/watch?v=example",
    "file:///etc/passwd",
    "data:text/plain,example",
    "ytsearch:unsupported",
    "bcsearch:another-provider",
  ])(
    "rejects unsupported or unsafe inputs before a backend lookup (%s)",
    async (query) => {
      const resolve = vi.fn();
      await expect(
        resolveMusicQuery({ resolve }, query, {
          info,
          settings,
          resolveHost: publicDns,
        })
      ).rejects.toThrow();
      expect(resolve).not.toHaveBeenCalled();
      expect(publicDns).not.toHaveBeenCalled();
    }
  );
  it("rejects private or mixed DNS results, including an allowed hostname", async () => {
    const resolve = vi.fn();
    const resolveHost = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      resolveMusicQuery({ resolve }, "https://soundcloud.com/artist/track", {
        info,
        settings,
        resolveHost,
      })
    ).rejects.toThrow("Private audio-source");
    expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects invalid lengths and unsupported search configuration", async () => {
    for (const query of ["a", " ", "x".repeat(201)])
      await expect(prepareMusicQuery(query, settings)).rejects.toThrow("2–200");
    await expect(
      prepareMusicQuery("Valid title", {
        ...settings,
        searchPrefix: "ytsearch",
      })
    ).rejects.toThrow("MUSIC_SEARCH_PREFIX");
  });
  it("distinguishes a connected backend from an enabled source manager", async () => {
    const resolve = vi.fn();
    await expect(
      resolveMusicQuery({ resolve }, "Public track", {
        info: { ...info, sourceManagers: ["bandcamp"] },
        settings,
      })
    ).rejects.toThrow("sources.soundcloud");
    expect(resolve).not.toHaveBeenCalled();
  });
  it("returns a single track, the first search hit, or a playlist without changing selection", async () => {
    const first = track(),
      second = track("Second");
    const results: LavalinkResponse[] = [
      { loadType: LoadType.TRACK, data: first },
      { loadType: LoadType.SEARCH, data: [first, second] },
      {
        loadType: LoadType.PLAYLIST,
        data: {
          encoded: "",
          info: { name: "Playlist", selectedTrack: 0 },
          pluginInfo: {},
          tracks: [first, second],
        },
      },
    ];
    for (const [n, result] of results.entries()) {
      const resolve = vi.fn(async () => result);
      const loaded = await resolveMusicQuery({ resolve }, "Public track", {
        info,
        settings,
      });
      expect(loaded.tracks).toEqual(n === 2 ? [first, second] : [first]);
      expect(resolve).toHaveBeenCalledOnce();
      expect(resolve).toHaveBeenCalledWith("scsearch:Public track");
    }
  });
  it("retains cause, severity, backend version, and long errors instead of reporting generic lookup failure", async () => {
    const cause = `java.io.IOException: HTTP 403 ${"nested detail ".repeat(150)}`;
    const resolve = vi.fn(async (): Promise<LavalinkResponse> => ({
      loadType: LoadType.ERROR,
      data: {
        message: "Something went wrong while looking up the track.",
        severity: "fault",
        cause,
      },
    }));
    const error = await resolveMusicQuery({ resolve }, "Public track", {
      info,
      settings,
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(cause);
    expect(message).toContain("Severity: fault");
    expect(message).toContain("Lavalink 4.2.2");
    expect(message).toContain("provider refused");
    expect(message).toContain("not a Discord voice-connection failure");
    expect(message.length).toBeGreaterThan(1000);
    expect(resolve).toHaveBeenCalledOnce();
  });
  it.each([
    { loadType: LoadType.EMPTY, data: {} },
    { loadType: LoadType.SEARCH, data: [] },
    {
      loadType: LoadType.PLAYLIST,
      data: {
        encoded: "",
        info: { name: "Empty", selectedTrack: -1 },
        tracks: [],
        pluginInfo: {},
      },
    },
  ] as LavalinkResponse[])(
    "rejects empty results rather than joining voice with an empty queue ($loadType)",
    async (result) => {
      await expect(
        resolveMusicQuery({ resolve: async () => result }, "Public track", {
          info,
          settings,
        })
      ).rejects.toThrow("no playable tracks");
    }
  );
  it("distinguishes no response and transport failure from an empty search", async () => {
    await expect(
      resolveMusicQuery({ resolve: async () => undefined }, "Public track", {
        info,
        settings,
      })
    ).rejects.toThrow("no lookup response");
    await expect(
      resolveMusicQuery(
        {
          resolve: async () => {
            throw new Error("fetch failed", {
              cause: new Error("ECONNREFUSED"),
            });
          },
        },
        "Public track",
        { info, settings }
      )
    ).rejects.toThrow("Caused by: ECONNREFUSED");
  });
  it("sanitizes credentials and signed source URLs in returned source diagnostics", () => {
    vi.stubEnv("LAVALINK_PASSWORD", "private-lavalink-password");
    const message = musicSourceFailure(
      {
        message: "private-lavalink-password",
        severity: "fault",
        cause:
          "HTTP 403 https://api.example/track?client_id=private-id&Signature=private-signature",
      },
      { stage: "lookup", source: "soundcloud", info }
    );
    for (const secret of [
      "private-lavalink-password",
      "private-id",
      "private-signature",
    ])
      expect(message).not.toContain(secret);
    expect(message).toContain("HTTP 403");
  });
  it.each([
    ["HTTP 429", "rate limiting"],
    ["java.net.SocketTimeoutException", "outbound HTTPS"],
    ["HTTP 401", "provider refused"],
  ])("offers a cause-specific next step for %s", (cause, hint) => {
    expect(
      musicSourceFailure({ cause }, { stage: "lookup", source: "soundcloud" })
    ).toContain(hint);
  });
  it("labels asynchronous playback failures separately from track lookup", () => {
    const message = musicSourceFailure(
      {
        message: "Stream ended",
        severity: "suspicious",
        cause: "Provider stream failed",
      },
      { stage: "playback", source: null, info }
    );
    expect(message).toContain("track playback failed");
    expect(message).toContain("after track lookup");
    expect(message).not.toContain("not a Discord voice-connection");
  });
});
