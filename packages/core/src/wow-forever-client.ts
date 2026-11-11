/**
 * Reading ruleset status out of the Battle.net API.
 *
 * The library is kept behind `ForeverApi`, a two-method interface, for two
 * reasons. It is the only way this can be tested without credentials — a
 * Battle.net API client cannot be constructed, let alone called, from CI — and
 * it stops a third-party client's types from spreading through the codebase.
 *
 * **Credentials are unavoidable.** Every Battle.net API call needs an OAuth
 * bearer token, the token needs the client credentials grant, and that needs a
 * client ID and secret registered at develop.battle.net. There is no anonymous
 * access and no query-string token accepted since 30 September 2024. The
 * library throws `MissingClientIdError` / `MissingClientSecretError` without
 * them. What *is* avoidable is the user-facing OAuth dance: `/data/wow/*` is a
 * Game Data endpoint, so the client credentials flow is enough and no player
 * ever authorises anything.
 *
 * So the absence of credentials is a supported state, not an error. Without
 * them this reports that it is unconfigured and everything downstream no-ops,
 * rather than failing a poll every few minutes forever.
 */
import {
  classifyRulesetStatus,
  WOW_FOREVER_REGIONS,
  type RulesetSnapshot,
  type WowForeverRegion,
} from "./wow-forever";

/**
 * The two calls this needs, in the shape the library offers them.
 *
 * Types are deliberately narrower than the library's and every field optional:
 * Forever's API is undocumented by Blizzard, so a response is treated as
 * untrusted input rather than as a contract.
 */
export type ForeverApi = {
  rulesets(): Promise<{ rulesets?: { id?: number }[] }>;
  ruleset(id: number): Promise<{
    id?: number;
    name?: string;
    status?: { type?: string };
  }>;
};

export type ForeverCredentials = {
  region: WowForeverRegion;
  clientId: string;
  clientSecret: string;
};

/**
 * Credentials from the environment, or `null` when they are not there.
 *
 * Missing credentials are normal — this feature is off until someone registers
 * a client — so this must never throw.
 */
export function foreverCredentials(
  env: Record<string, string | undefined>
): ForeverCredentials | null {
  const region = (env.WOW_FOREVER_REGION ?? "").trim().toLowerCase();
  const clientId = (env.BLIZZARD_CLIENT_ID ?? "").trim();
  const clientSecret = (env.BLIZZARD_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  // An unrecognised region is rejected rather than passed through: the library
  // would build a URL for a host that does not exist and every poll would fail
  // in a way that looks like an outage.
  if (!(WOW_FOREVER_REGIONS as readonly string[]).includes(region)) return null;
  return { region: region as WowForeverRegion, clientId, clientSecret };
}

/**
 * Build the real client.
 *
 * Imported dynamically so that `packages/core` — which is loaded by the
 * dashboard, the bot and every unit test — never pays for the module, and so a
 * missing optional dependency cannot break startup for a deployment that does
 * not use this feature.
 */
export async function createForeverApi(
  credentials: ForeverCredentials
): Promise<ForeverApi> {
  const { createClient } = await import("@pinta365/blizzard_api");
  const client = createClient({
    region: credentials.region,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });
  return client.wowForever as unknown as ForeverApi;
}

/**
 * Read every ruleset in the region.
 *
 * The index carries ids and nothing else, so this is one request for the index
 * plus one per ruleset. They are issued concurrently; there are roughly
 * twenty-one rulesets in EU and US, so this is a small, bounded burst rather
 * than anything that needs batching.
 *
 * A ruleset whose own request fails is reported as `unknown`, not dropped: the
 * index said it exists, and a hole in the list is a different thing from a
 * ruleset that is not there.
 */
export async function readRulesets(api: ForeverApi): Promise<RulesetSnapshot[]> {
  const index = await api.rulesets();
  const ids = (index?.rulesets ?? [])
    .map((entry) => entry?.id)
    .filter((id): id is number => typeof id === "number");

  const settled = await Promise.allSettled(ids.map((id) => api.ruleset(id)));
  return ids.map((id, position) => {
    const outcome = settled[position];
    if (outcome.status === "rejected") return { id, name: `Ruleset ${id}`, raw: "", state: "unknown" };
    const body = outcome.value;
    return {
      id,
      name: body?.name?.trim() || `Ruleset ${id}`,
      raw: body?.status?.type ?? "",
      state: classifyRulesetStatus(body?.status?.type),
    };
  });
}

/** What one poll produced. */
export type PollResult = {
  snapshots: RulesetSnapshot[];
  /**
   * Why the poll produced nothing usable. `null` means it succeeded, even if
   * every ruleset turned out to be down — an outage we can see is a success.
   */
  error: string | null;
};

/** The result of a poll that could not even be attempted. */
export function pollError(message: string): PollResult {
  return { snapshots: [], error: message };
}

/**
 * One poll, never throwing.
 *
 * A monitor that throws is a monitor that stops. Every failure becomes an
 * `error` the caller can log or show, and `snapshots` stays empty so no caller
 * can mistake a failed poll for a reading.
 */
export async function pollForeverRulesets(
  credentials: ForeverCredentials | null,
  /**
   * How the API is built. Injectable so the failure path can be tested without
   * reaching the network — a unit test that calls Blizzard is a unit test that
   * fails for reasons that have nothing to do with the code under test.
   */
  create: (credentials: ForeverCredentials) => Promise<ForeverApi> = createForeverApi
): Promise<PollResult> {
  if (!credentials)
    return pollError(
      "No Blizzard API credentials are configured, so rulesets cannot be checked."
    );
  try {
    const api = await create(credentials);
    return { snapshots: await readRulesets(api), error: null };
  } catch (e) {
    return pollError(e instanceof Error ? e.message : "The ruleset check failed.");
  }
}
