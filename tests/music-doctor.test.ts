import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  createMusicDoctorClient,
  parseMusicDoctorArgs,
  runMusicDoctor,
} from "../apps/bot/src/music-doctor";

const metadata = {
  version: { semver: "4.2.2" },
  lavaplayer: "test-player",
  sourceManagers: ["soundcloud", "bandcamp"],
  plugins: [{ name: "test-plugin", version: "1.0" }],
};
const settings = {
  searchPrefix: "scsearch",
  allowedHosts: ["soundcloud.com", "bandcamp.com"],
};
const config = {
  host: "localhost:2333",
  password: "private-backend-password",
  secure: false,
};
const track = {
  encoded: "private-encoded-track-not-for-report",
  info: {
    title: "Public track",
    author: "Artist",
    identifier: "test",
    length: 10000,
    isSeekable: true,
    isStream: false,
    position: 0,
    uri: "https://soundcloud.com/artist/track",
    artworkUrl: null,
    isrc: null,
    sourceName: "soundcloud",
  },
  pluginInfo: {},
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
describe("read-only music doctor", () => {
  it("uses just /v4/info when no query is requested, without exposing the backend password", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({ ...metadata, extraSecret: "never-serialize-this" })
    );
    const report = await runMusicDoctor(
      createMusicDoctorClient(config, request),
      { settings }
    );
    expect(report.ok).toBe(true);
    expect(report.backend).toEqual({
      version: "4.2.2",
      lavaplayer: "test-player",
      sourceManagers: ["soundcloud", "bandcamp"],
      plugins: metadata.plugins,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(new URL(String(request.mock.calls[0][0])).pathname).toBe("/v4/info");
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { Authorization: config.password },
      redirect: "error",
    });
    expect(JSON.stringify(report)).not.toContain(config.password);
    expect(JSON.stringify(report)).not.toContain("never-serialize-this");
    expect(report.scope).toContain("does not prove playback");
  });
  it("optionally makes one source lookup and reports counts, not encoded tracks or input URLs", async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      new URL(String(url)).pathname === "/v4/info"
        ? response(metadata)
        : response({ loadType: "track", data: track })
    );
    const report = await runMusicDoctor(
      createMusicDoctorClient(config, request),
      { query: "Public track", settings }
    );
    expect(report.ok).toBe(true);
    expect(report.lookup).toEqual({
      status: "loaded",
      tracks: 1,
      source: "soundcloud",
      kind: "search",
    });
    expect(request).toHaveBeenCalledTimes(2);
    const lookup = new URL(String(request.mock.calls[1][0]));
    expect(lookup.pathname).toBe("/v4/loadtracks");
    expect(lookup.searchParams.get("identifier")).toBe("scsearch:Public track");
    expect(
      request.mock.calls.every(([, options]) => options?.method === "GET")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(
      "private-encoded-track-not-for-report"
    );
  });
  it("retains the actual Lavalink lookup cause in a failed report, without fallback attempts", async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      new URL(String(url)).pathname === "/v4/info"
        ? response(metadata)
        : response({
            loadType: "error",
            data: {
              message: "Something went wrong while looking up the track.",
              severity: "fault",
              cause: "java.io.IOException: HTTP 403",
            },
          })
    );
    const report = await runMusicDoctor(
      createMusicDoctorClient(config, request),
      { query: "Public track", settings }
    );
    expect(report.ok).toBe(false);
    expect(report.lookup?.status).toBe("failed");
    expect(report.error).toContain("Cause: java.io.IOException: HTTP 403");
    expect(report.error).toContain("Severity: fault");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("reports a disabled configured source without making a doomed load request", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({ ...metadata, sourceManagers: ["bandcamp"] })
    );
    const report = await runMusicDoctor(
      createMusicDoctorClient(config, request),
      { query: "Public track", settings }
    );
    expect(report.ok).toBe(false);
    expect(report.warnings.join(" ")).toContain("soundcloud");
    expect(report.error).toContain("plugins.soundy.enabled");
    expect(request).toHaveBeenCalledOnce();
  });
  it("distinguishes backend authentication failure without echoing arbitrary HTTP response bodies", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({ password: "never-copy-response-bodies" }, 401)
    );
    const report = await runMusicDoctor(
      createMusicDoctorClient(config, request),
      { settings }
    );
    expect(report.ok).toBe(false);
    expect(report.backend).toBeNull();
    expect(report.error).toContain("HTTP 401");
    expect(report.error).toContain("passwords match");
    expect(report.error).not.toContain("never-copy-response-bodies");
  });
  it("rejects unexpected backend metadata and unsupported source input", async () => {
    const invalid = await runMusicDoctor(
      createMusicDoctorClient(
        config,
        vi.fn(async () => response({ arbitrary: "private-body" }))
      ),
      { settings }
    );
    expect(invalid.error).toContain("unexpected v4 metadata");
    expect(invalid.error).not.toContain("private-body");
    const request = vi.fn<typeof fetch>(async () => response(metadata));
    const report = await runMusicDoctor(
      createMusicDoctorClient(config, request),
      { settings, query: "https://youtube.com/watch?v=example" }
    );
    expect(report.ok).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(report.error).toContain("not enabled");
  });
  it.each([
    "https://localhost:2333",
    "user:password@localhost:2333",
    "localhost:2333/path",
    "localhost:2333?token=private",
    "",
  ])("rejects ambiguous backend URL configuration (%s)", (host) => {
    const request = vi.fn();
    expect(() =>
      createMusicDoctorClient({ ...config, host }, request)
    ).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("parses strictly and rejects duplicate or invalid query arguments", () => {
    expect(parseMusicDoctorArgs(["--query", "Public track"])).toEqual({
      help: false,
      query: "Public track",
    });
    expect(parseMusicDoctorArgs(["--help"])).toEqual({ help: true });
    for (const args of [
      ["--query", "a"],
      ["--query", "x".repeat(201)],
      ["--query", "one", "--query", "two"],
      ["--token", "never"],
    ])
      expect(() => parseMusicDoctorArgs(args)).toThrow();
  });
  it("offers help without credentials and prevents network diagnostics in demo mode", () => {
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "apps/bot/src/diagnose-music.ts", ...args],
        {
          encoding: "utf8",
          cwd: process.cwd(),
          timeout: 10000,
          env: {
            ...process.env,
            DEMO_MODE: "true",
            LAVALINK_URL: "localhost:2333",
            LAVALINK_PASSWORD: "private-test-password",
            DISCORD_TOKEN: "",
          },
        }
      );
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("music:doctor");
    expect(help.stderr).toBe("");
    const denied = run([]);
    expect(denied.status).toBe(1);
    expect(denied.stdout).toBe("");
    expect(denied.stderr).not.toContain("private-test-password");
  });
});
