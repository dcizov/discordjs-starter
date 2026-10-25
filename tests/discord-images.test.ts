import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_GUILD_ICON, DEMO_USER_AVATAR } from "@orbit/core";
vi.mock("server-only", () => ({}));
import {
  guildIconUrl,
  publicUser,
  userAvatarUrl,
} from "../apps/web/lib/discord-images";
const id = "120000000000000099";
const hash = "0123456789abcdef0123456789abcdef";
afterEach(() => vi.unstubAllEnvs());
describe("version-matched Discord image URLs and public projection", () => {
  it("uses static resized WebP from the installed CDN helper for ordinary and animated hashes", () => {
    vi.stubEnv("DEMO_MODE", "false");
    for (const value of [hash, `a_${hash}`]) {
      expect(userAvatarUrl(id, value)).toBe(
        `https://cdn.discordapp.com/avatars/${id}/${value}.webp?size=128`
      );
      expect(guildIconUrl(id, value)).toBe(
        `https://cdn.discordapp.com/icons/${id}/${value}.webp?size=128`
      );
    }
  });
  it("keeps absent/invalid data as a fallback, never a guessed default or arbitrary image URL", () => {
    vi.stubEnv("DEMO_MODE", "false");
    for (const value of [
      null,
      "",
      "short",
      "../avatar",
      "https://attacker.example/image.png",
      "/demo/cozy-corner.svg",
      `${hash}?x=secret`,
    ]) {
      expect(userAvatarUrl(id, value)).toBeNull();
      expect(guildIconUrl(id, value)).toBeNull();
    }
    expect(userAvatarUrl("../other", hash)).toBeNull();
    expect(guildIconUrl("not-a-snowflake", hash)).toBeNull();
  });
  it("allows only the deliberately named local samples in demo and never substitutes them in live mode", () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect(userAvatarUrl(id, DEMO_USER_AVATAR)).toBe(DEMO_USER_AVATAR);
    expect(guildIconUrl(id, DEMO_GUILD_ICON)).toBe(DEMO_GUILD_ICON);
    expect(userAvatarUrl(id, "/other.svg")).toBeNull();
    expect(guildIconUrl(id, DEMO_USER_AVATAR)).toBeNull();
    vi.stubEnv("DEMO_MODE", "false");
    expect(userAvatarUrl(id, DEMO_USER_AVATAR)).toBeNull();
    expect(guildIconUrl(id, DEMO_GUILD_ICON)).toBeNull();
  });
  it("serializes only the selected global identity fields, never server-side credentials", () => {
    const user = {
      id,
      name: "Global profile",
      avatar: hash,
      accessToken: "private-access",
      sessionId: "private-session",
      refreshToken: "private-refresh",
    };
    expect(publicUser(user)).toEqual({
      id,
      name: "Global profile",
      avatar: hash,
      avatarUrl: userAvatarUrl(id, hash),
    });
    expect(JSON.stringify(publicUser(user))).not.toContain("private-");
  });
});
