/*
 * The ruleset reader, against a fake API.
 *
 * These run without credentials, which is the point of keeping the library
 * behind `ForeverApi`: a real client cannot be constructed in CI, so the
 * behaviour that matters — a partially failed poll, an unexpected status, a
 * missing status — would otherwise never be exercised at all.
 */
import { describe, expect, it } from "vitest";
import {
  foreverCredentials,
  pollForeverRulesets,
  readRulesets,
  type ForeverApi,
} from "../packages/core/src/wow-forever-client";

/** A fake API from a fixed table of rulesets. */
function fakeApi(
  table: Record<number, { name?: string; type?: string } | Error>
): ForeverApi {
  return {
    async rulesets() {
      return { rulesets: Object.keys(table).map((id) => ({ id: Number(id) })) };
    },
    async ruleset(id: number) {
      const entry = table[id];
      if (entry instanceof Error) throw entry;
      return { id, name: entry?.name, status: { type: entry?.type } };
    },
  };
}

describe("foreverCredentials", () => {
  it("reads a complete set", () => {
    expect(
      foreverCredentials({
        WOW_FOREVER_REGION: "eu",
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      })
    ).toEqual({ region: "eu", clientId: "id", clientSecret: "secret" });
  });

  it("is case- and whitespace-tolerant about the region", () => {
    expect(
      foreverCredentials({
        WOW_FOREVER_REGION: " EU ",
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      })?.region
    ).toBe("eu");
  });

  it("is null when credentials are absent, because unconfigured is a state", () => {
    // This feature is off until someone registers a client. That must not be
    // an error: it is the default.
    for (const env of [
      {},
      { BLIZZARD_CLIENT_ID: "id" },
      { BLIZZARD_CLIENT_SECRET: "secret" },
      { BLIZZARD_CLIENT_ID: "", BLIZZARD_CLIENT_SECRET: "" },
    ])
      expect(foreverCredentials(env)).toBeNull();
  });

  it("is null for a region that has no Forever gateway", () => {
    // Passing it through would build requests for a host that does not exist
    // and fail every poll in a way that looks like an outage.
    expect(
      foreverCredentials({
        WOW_FOREVER_REGION: "cn",
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      })
    ).toBeNull();
    expect(
      foreverCredentials({
        WOW_FOREVER_REGION: "mars",
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      })
    ).toBeNull();
  });
});

describe("readRulesets", () => {
  it("reads each ruleset in the index", async () => {
    expect(
      await readRulesets(
        fakeApi({
          1: { name: "Normal", type: "UP" },
          2: { name: "PvP", type: "UP" },
        })
      )
    ).toEqual([
      { id: 1, name: "Normal", raw: "UP", state: "up" },
      { id: 2, name: "PvP", raw: "UP", state: "up" },
    ]);
  });

  it("keeps the raw status of a ruleset that is not up", async () => {
    // MAINTENANCE is hypothetical. The point is that if Blizzard reports a
    // status we have never seen, it is carried through verbatim rather than
    // flattened into a word we chose.
    expect(
      await readRulesets(fakeApi({ 3: { name: "RP", type: "MAINTENANCE" } }))
    ).toEqual([{ id: 3, name: "RP", raw: "MAINTENANCE", state: "down" }]);
  });

  it("marks a ruleset with no status unknown rather than down", async () => {
    expect(await readRulesets(fakeApi({ 4: { name: "RP-PvP" } }))).toEqual([
      { id: 4, name: "RP-PvP", raw: "", state: "unknown" },
    ]);
  });

  /*
   * A ruleset the index listed but whose own request failed is a gap in what
   * we know. It must survive as `unknown` rather than vanish: the index said it
   * exists, and a short list is a different thing from a ruleset that is
   * absent — one says "we do not know", the other says "not there".
   */
  it("keeps a ruleset whose own request failed, as unknown", async () => {
    expect(
      await readRulesets(
        fakeApi({ 1: { name: "Normal", type: "UP" }, 2: new Error("503") })
      )
    ).toEqual([
      { id: 1, name: "Normal", raw: "UP", state: "up" },
      { id: 2, name: "Ruleset 2", raw: "", state: "unknown" },
    ]);
  });

  it("reads an empty index as an empty list, not as an outage", async () => {
    expect(await readRulesets(fakeApi({}))).toEqual([]);
  });
});

describe("pollForeverRulesets", () => {
  it("reports that it is unconfigured instead of throwing", async () => {
    const result = await pollForeverRulesets(null);
    expect(result.snapshots).toEqual([]);
    expect(result.error).toMatch(/No Blizzard API credentials/i);
  });

  it("turns a client that cannot be constructed into an error, not a throw", async () => {
    // A monitor that throws stops monitoring. Every failure has to come back
    // as a result the caller can log or show. The factory is injected so this
    // never reaches the network.
    const result = await pollForeverRulesets(
      { region: "eu", clientId: "bad", clientSecret: "bad" },
      async () => {
        throw new Error("Problem with Authentication");
      }
    );
    expect(result.snapshots).toEqual([]);
    expect(result.error).toBe("Problem with Authentication");
  });

  it("reports the rulesets it read, with no error, when the poll succeeds", async () => {
    const result = await pollForeverRulesets(
      { region: "eu", clientId: "id", clientSecret: "secret" },
      async () => fakeApi({ 1: { name: "Normal", type: "UP" } })
    );
    expect(result.error).toBeNull();
    expect(result.snapshots).toEqual([
      { id: 1, name: "Normal", raw: "UP", state: "up" },
    ]);
  });
});

/*
 * The library itself, as opposed to everything above, which is a fake.
 *
 * Every other test here injects a `ForeverApi`, so all of them pass even with
 * the package entirely absent. That is precisely how a broken lockfile reached
 * a deployed bot: `npm ci` silently installed nothing, every unit test stayed
 * green, and `/wowforever status` answered
 * "Cannot find package '@pinta365/blizzard_api'".
 *
 * It is a declared dependency, so it must always be installed -- the optional
 * part of this feature is whether credentials exist, not whether the package
 * does. If that ever changes and it becomes a true optionalDependency, this
 * test is the thing that should change with it.
 */
describe("the library behind the wrapper", () => {
  it("is installed, so an incomplete tree fails here rather than in production", async () => {
    await expect(import("@pinta365/blizzard_api")).resolves.toBeTruthy();
  });

  /*
   * The wrapper was written against the library's source, not against a
   * running client, so the shape it assumes was never actually checked. These
   * two names are the whole surface it uses.
   */
  it("exposes the client and the two ruleset calls the wrapper uses", async () => {
    const { createClient } = await import("@pinta365/blizzard_api");
    const client = createClient({
      region: "eu",
      clientId: "id",
      clientSecret: "secret",
    });
    expect(typeof client.wowForever?.rulesets).toBe("function");
    expect(typeof client.wowForever?.ruleset).toBe("function");
    // The wrapper calls each with no context argument: the client binds it.
    expect(client.wowForever.rulesets.length).toBe(0);
    expect(client.wowForever.ruleset.length).toBe(1);
  });
});
