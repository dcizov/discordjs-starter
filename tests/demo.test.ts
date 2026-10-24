import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { rm, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEMO_GUILD_ID, DEMO_USER_ID } from "@orbit/core";
import { demoRead } from "../packages/db/src/demo";
import { audit, economyTransaction, getGuild, saveConfig } from "@orbit/db";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "orbit-demo-test-"));
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("DEMO_DATA_PATH", join(dir, "state.json"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("credential-free persistent demo", () => {
  it("initializes once and preserves stable resource identifiers across reads", async () => {
    const [a, b] = await Promise.all([demoRead(), demoRead()]);
    expect(a.resources[0].id).toBe(b.resources[0].id);
    expect(
      JSON.parse(await readFile(join(dir, "state.json"), "utf8")).resources[0]
        .id
    ).toBe(a.resources[0].id);
  });
  it("persists configuration and audit changes through fresh file reads", async () => {
    const guild = (await getGuild(DEMO_GUILD_ID))!;
    guild.config.economy.currency = "Moon dust";
    await saveConfig(DEMO_GUILD_ID, guild.config, {
      id: DEMO_USER_ID,
      name: "Demo tester",
    });
    expect((await getGuild(DEMO_GUILD_ID))!.config.economy.currency).toBe(
      "Moon dust"
    );
    expect((await demoRead()).audit[0].actorName).toBe("Demo tester");
  });
  it("preserves safe multiline errors in the persistent audit store instead of flattening or shortening them", async () => {
    const detail = `Source lookup failed
	java.example.Loader.<init>
${"nested details ".repeat(120)}`;
    await audit(
      DEMO_GUILD_ID,
      { id: DEMO_USER_ID, name: "Demo tester" },
      "failed",
      "music",
      detail
    );
    const stored = (await demoRead()).audit[0];
    expect(stored.detail).toBe(detail);
    expect(stored.detail.length).toBeGreaterThan(1000);
  });
  it("serializes competing rewards and never double grants", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, n) =>
        economyTransaction({
          guildId: DEMO_GUILD_ID,
          userId: DEMO_USER_ID,
          userName: "Jamie",
          type: "daily",
          key: `concurrent-${n}`,
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await demoRead()).accounts.find((a) => a.userId === DEMO_USER_ID)!
        .balance
    ).toBe(4500);
  });
  it("replays an idempotent transfer without transferring twice", async () => {
    const i = {
      guildId: DEMO_GUILD_ID,
      userId: DEMO_USER_ID,
      userName: "Jamie",
      type: "transfer" as const,
      key: "persistent-transfer",
      toUserId: "120000000000000401",
      amount: 50,
    };
    const [first, replay] = await Promise.all([
      economyTransaction(i),
      economyTransaction(i),
    ]);
    expect(replay.replayed).toBe(true);
    expect(first.balance).toBe(4450);
    expect(
      (await demoRead()).ledger.filter((l) => l.key === i.key)
    ).toHaveLength(2);
  });
});
