import { describe, expect, it, vi } from "vitest";
import type { NodeInfo } from "shoukaku";
import {
  MusicNodeMetadata,
  type MusicMetadataNode,
} from "../apps/bot/src/music-node";
import { musicNodeDescription } from "../apps/bot/src/music-source";

const info: NodeInfo = {
  version: { semver: "4.2.2", major: 4, minor: 2, patch: 2 },
  buildTime: 0,
  git: { branch: "test", commit: "test", commitTime: 0 },
  jvm: "test",
  lavaplayer: "2.2.6",
  sourceManagers: ["soundcloud", "bandcamp"],
  filters: [],
  plugins: [{ name: "soundy", version: "1.1.0" }],
};
function node(
  get = vi.fn(async (): Promise<NodeInfo | undefined> => info)
): MusicMetadataNode {
  return { info: null, rest: { getLavalinkInfo: get } };
}

describe("live Lavalink metadata cache", () => {
  it("explicitly GETs metadata once, deduplicates concurrent lookups and populates Shoukaku's info field", async () => {
    const cache = new MusicNodeMetadata();
    const backend = node();
    const first = cache.read(backend);
    expect(cache.read(backend)).toBe(first);
    await expect(first).resolves.toBe(info);
    expect(backend.info).toBe(info);
    await expect(cache.read(backend)).resolves.toBe(info);
    expect(backend.rest.getLavalinkInfo).toHaveBeenCalledOnce();
    expect(musicNodeDescription(backend.info)).toBe(
      "Lavalink 4.2.2; Lavaplayer 2.2.6; Soundy 1.1.0"
    );
  });
  it("does not cache metadata failures and can retry on the next source lookup", async () => {
    const get = vi
      .fn<() => Promise<NodeInfo | undefined>>()
      .mockRejectedValueOnce(new Error("Metadata request failed"))
      .mockResolvedValueOnce(info);
    const backend = node(get);
    const cache = new MusicNodeMetadata();
    await expect(cache.read(backend)).rejects.toThrow(
      "Metadata request failed"
    );
    expect(backend.info).toBeNull();
    await expect(cache.read(backend)).resolves.toBe(info);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("refreshes after reconnect instead of retaining an old plugin/source list", async () => {
    const backend = node();
    backend.info = { ...info, plugins: [], sourceManagers: ["bandcamp"] };
    const cache = new MusicNodeMetadata();
    expect((await cache.read(backend)).plugins).toEqual([]);
    expect(backend.rest.getLavalinkInfo).not.toHaveBeenCalled();
    await expect(cache.read(backend, true)).resolves.toBe(info);
    expect(backend.info?.plugins).toEqual(info.plugins);
  });
  it("does not let an old in-flight request overwrite refreshed reconnect metadata", async () => {
    let finishOld!: (value: NodeInfo) => void;
    const old = new Promise<NodeInfo>((resolve) => {
      finishOld = resolve;
    });
    const get = vi
      .fn<() => Promise<NodeInfo | undefined>>()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(info);
    const backend = node(get);
    const cache = new MusicNodeMetadata();
    const first = cache.read(backend);
    await Promise.resolve();
    await expect(cache.read(backend, true)).resolves.toBe(info);
    finishOld({ ...info, plugins: [], sourceManagers: ["bandcamp"] });
    await first;
    expect(backend.info).toBe(info);
  });
  it.each([undefined, {} as NodeInfo])(
    "rejects absent/malformed metadata without falsely reporting a version",
    async (value) => {
      const backend = node(vi.fn(async () => value));
      await expect(new MusicNodeMetadata().read(backend)).rejects.toThrow(
        "valid v4 backend metadata"
      );
      expect(backend.info).toBeNull();
      expect(musicNodeDescription(backend.info)).toBe(
        "Backend version unavailable"
      );
    }
  );
});
