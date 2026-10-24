import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const read = (name: string) =>
  readFileSync(new URL(`../docker/lavalink/${name}`, import.meta.url), "utf8");
const config = parseDocument(read("application.yml")).toJS();
const lock = JSON.parse(read("plugins.lock.json"));

describe("reviewed non-adult Lavalink plugin profile", () => {
  it("pins all nine requested plugins by release, source revision and artifact checksum", () => {
    expect(lock.lavalink).toBe("4.2.2");
    expect(lock.plugins.map((plugin: any) => plugin.id).sort()).toEqual(
      [
        "youtube-plugin",
        "sponsorblock-plugin",
        "lavasrc-plugin",
        "lavasearch-plugin",
        "lavalyrics-plugin",
        "lava-xm-plugin",
        "lyrics",
        "lavadspx-plugin",
        "DuncteBot-plugin",
      ].sort()
    );
    for (const plugin of lock.plugins) {
      expect(plugin.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(plugin.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(plugin.url).toMatch(/^https:\/\//);
    }
  });
  it("downloads only at image build time and retains the official unprivileged JVM", () => {
    const docker = read("Dockerfile");
    expect(docker).toContain(
      "python install-plugins.py --manifest plugins.lock.json --output /plugins"
    );
    expect(docker).toContain(
      "COPY --from=plugins --chown=322:322 /plugins/ /opt/Lavalink/plugins/"
    );
    expect(docker).not.toContain("--review-unpinned");
    expect(config.lavalink.plugins).toBeUndefined();
    expect(
      docker.split("FROM ghcr.io/lavalink-devs/lavalink:4.2.2")[1]
    ).not.toMatch(/USER root|ENTRYPOINT|CMD /);
  });
  it("has exactly one audio-source owner and no mirroring, HTTP, local, or second TTS", () => {
    expect(config.lavalink.server.sources).toMatchObject({
      youtube: false,
      soundcloud: false,
      bandcamp: true,
      http: false,
      local: false,
    });
    expect(config.plugins.youtube.enabled).toBe(true);
    expect(config.plugins.soundy.enabled).toBe(true);
    expect(config.plugins.lavasrc.providers).toEqual([]);
    expect(
      Object.entries(config.plugins.lavasrc.sources)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
    ).toEqual(["youtube"]); // extended-search wrapper only
    expect(config.plugins.youtube.oauth.enabled).toBe(false);
    expect(config.plugins.youtube.clients).toEqual([
      "MUSIC",
      "ANDROID_VR",
      "WEB",
    ]);
    expect(config.plugins.youtube.allowDirectVideoIds).toBe(false);
    expect(config.plugins.youtube.allowDirectPlaylistIds).toBe(false);
  });
  it("overrides ALL Skybot source defaults, including its adult defaults and undocumented elgato switch", () => {
    expect(config.plugins.dunctebot.sources).toEqual({
      ocremix: true,
      getyarn: false,
      clypit: false,
      tts: false,
      pornhub: false,
      reddit: false,
      tiktok: false,
      mixcloud: false,
      soundgasm: false,
      elgato: false,
      pixeldrain: false,
      tumblr: false,
    });
  });
  it("does not register the same YouTube lyrics provider twice or pretend the ordering list disables providers", () => {
    expect(config.plugins.lavasrc["lyrics-sources"]).toEqual({
      spotify: false,
      deezer: false,
      youtube: false,
      yandexmusic: false,
      vkmusic: false,
      lrcLib: true,
    });
    expect(config.plugins.lavalyrics.sources).toEqual([]);
    expect(config.plugins.lyrics.countryCode).toBe("DE");
  });
  it("keeps one low-pass implementation and conservative native tracker settings", () => {
    expect(config.lavalink.server.filters.lowPass).toBe(false);
    expect(config.plugins.xm).toMatchObject({
      ampFactor: 1,
      interpolation: 1,
      defaultPan: 50,
    });
    expect(config.plugins).not.toHaveProperty("sponsorblock"); // categories are a real per-player REST call, not made-up YAML
  });
});
