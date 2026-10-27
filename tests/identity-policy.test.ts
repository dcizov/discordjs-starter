import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  displayName,
  isGuildNickname,
  isSystemActor,
  secondaryName,
} from "@orbit/core/identity";
import { personFields } from "../apps/web/lib/person";
import {
  memberAvatarUrl,
  personAvatarUrl,
  userAvatarUrl,
} from "../apps/web/lib/discord-images";

const userId = "120000000000000001";
const guildId = "120000000000000002";
const avatarHash = "0123456789abcdef0123456789abcdef";
const guildHash = "fedcba9876543210fedcba9876543210";
const animated = "a_0123456789abcdef0123456789abcdef";

describe("one naming policy", () => {
  it("prefers the guild nickname inside a guild, then the global name, then the handle", () => {
    expect(
      displayName({
        nickname: "Guild name",
        globalName: "Global",
        username: "h",
      })
    ).toBe("Guild name");
    expect(displayName({ globalName: "Global", username: "h" })).toBe("Global");
    expect(displayName({ username: "h" })).toBe("h");
    expect(displayName({})).toBe("Unknown member");
  });

  it("never shows a guild nickname as a global identity", () => {
    expect(
      displayName({ nickname: "Guild name", username: "handle" }, "account")
    ).toBe("handle");
  });

  it("follows a nickname change and a nickname removal without stale values", () => {
    const before = { nickname: "Old", globalName: "Global", username: "h" };
    expect(displayName(before)).toBe("Old");
    // A rename is a different value, not the old one plus a new one.
    expect(displayName({ ...before, nickname: "New" })).toBe("New");
    // Removing the nickname falls back to the global name, not to "" or an id.
    expect(displayName({ ...before, nickname: null })).toBe("Global");
    expect(isGuildNickname({ ...before, nickname: null })).toBe(false);
    expect(isGuildNickname(before)).toBe(true);
  });

  it("follows a global-name change and keeps the handle available as the secondary line", () => {
    expect(displayName({ globalName: "Before", username: "handle" })).toBe(
      "Before"
    );
    expect(displayName({ globalName: "After", username: "handle" })).toBe(
      "After"
    );
    expect(secondaryName({ globalName: "After", username: "handle" })).toBe(
      "handle"
    );
  });

  it("does not repeat the name as its own secondary line", () => {
    expect(secondaryName({ username: "alex" })).toBeNull();
    expect(secondaryName({ globalName: "Alex", username: "alex" })).toBeNull();
    expect(secondaryName({ globalName: "Alex", username: "alex.dev" })).toBe(
      "alex.dev"
    );
  });

  it("identifies system actors so they never look like a departed member", () => {
    expect(isSystemActor("orbit-worker", "Orbit")).toBe(true);
    expect(isSystemActor("system:scheduler")).toBe(true);
    expect(isSystemActor(userId, "Jamie")).toBe(false);
  });

  it("resolves the same displayed name from an account, a roster row and a queue entry", () => {
    const rosterRow = {
      username: "handle",
      globalName: "Global",
      nickname: "Guild name",
    };
    // A leaderboard account carrying the roster identity, an audit-free music
    // request naming the same person, and the member directory all agree.
    expect(personFields(rosterRow, "stale recorded name").name).toBe(
      "Guild name"
    );
    expect(
      personFields({ username: "handle", globalName: "Global" }, "recorded")
        .name
    ).toBe("Global");
    expect(personFields({ username: "handle" }, "recorded").name).toBe(
      "handle"
    );
  });
});

describe("one avatar policy", () => {
  it("prefers the guild avatar, then the global avatar", () => {
    expect(
      personAvatarUrl({
        guildId,
        userId,
        guildAvatar: guildHash,
        avatar: avatarHash,
      })
    ).toBe(
      `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${guildHash}.webp?size=128`
    );
    expect(
      personAvatarUrl({
        guildId,
        userId,
        guildAvatar: null,
        avatar: avatarHash,
      })
    ).toBe(
      `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=128`
    );
    expect(personAvatarUrl({ guildId, userId })).toBeNull();
  });

  it("follows an avatar change instead of caching an old hash", () => {
    const first = personAvatarUrl({ guildId, userId, avatar: avatarHash });
    const second = personAvatarUrl({
      guildId,
      userId,
      avatar: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(first).not.toBe(second);
    expect(second).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("supports animated hashes through the same builder", () => {
    expect(userAvatarUrl(userId, animated)).toContain(`${animated}.webp`);
  });

  it("never mints a URL for a hash that is not an avatar, so nothing 404s", () => {
    expect(userAvatarUrl(userId, "not-a-hash")).toBeNull();
    expect(memberAvatarUrl(guildId, userId, "not-a-hash")).toBeNull();
    expect(userAvatarUrl("not-an-id", avatarHash)).toBeNull();
  });

  it("keeps guild avatars scoped to their own guild", () => {
    const mine = memberAvatarUrl(guildId, userId, guildHash);
    const other = memberAvatarUrl("120000000000000003", userId, guildHash);
    expect(mine).not.toBe(other);
    // A guild avatar hash is never passed to the global avatar builder, which
    // would produce a URL that does not exist.
    expect(personAvatarUrl({ userId, avatar: null })).toBeNull();
  });
});
