import { ActivityType } from "discord.js";
import { describe, expect, it } from "vitest";
import { presenceFromEnv } from "../apps/bot/src/features/presence";

describe("bot presence", () => {
  it("defaults to a command that exists, once, after readiness", () => {
    const { presence, note } = presenceFromEnv({});
    expect(presence).toMatchObject({
      status: "online",
      activities: [{ name: "/help", type: ActivityType.Watching }],
    });
    expect(note).toContain("/help");
  });
  it("accepts a configured activity and status", () => {
    const { presence } = presenceFromEnv({
      BOT_ACTIVITY: "the listening room",
      BOT_ACTIVITY_TYPE: "listening",
      BOT_STATUS: "idle",
    });
    expect(presence).toMatchObject({
      status: "idle",
      activities: [
        { name: "the listening room", type: ActivityType.Listening },
      ],
    });
  });
  it("falls back instead of inventing an unknown type or status", () => {
    const { presence, note } = presenceFromEnv({
      BOT_ACTIVITY: "something",
      BOT_ACTIVITY_TYPE: "streaming",
      BOT_STATUS: "invisible-ish",
    });
    expect(presence).toMatchObject({
      status: "online",
      activities: [{ name: "something", type: ActivityType.Watching }],
    });
    expect(note).toContain("not recognized");
  });
  it("can be disabled entirely", () => {
    expect(presenceFromEnv({ BOT_ACTIVITY: "" }).presence).toBeNull();
  });
  it("bounds the activity text and strips control characters", () => {
    const { presence } = presenceFromEnv({
      BOT_ACTIVITY: ` ${"x".repeat(400)}\n `,
    });
    const name = presence!.activities![0].name;
    expect(name.length).toBeLessThanOrEqual(128);
    expect(name).not.toContain("\n");
  });
});
