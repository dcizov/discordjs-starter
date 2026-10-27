/**
 * Steam **app artwork** for news cards.
 *
 * What the official news API does and does not give us:
 *
 * - `ISteamNews/GetNewsForApp/v2` returns article fields only (`gid`, `title`,
 *   `contents`, `url`, `date`, …). There is no documented image field, and no
 *   documented "event cover" field. An image is available only when the article
 *   body itself embeds one (already handled by `imageFromMarkup`).
 * - The event/announcement pages on Steam show the *game's* capsule artwork.
 *   That artwork is app metadata, not a picture supplied by the article.
 *
 * So this module adds an explicitly labelled **fallback**: the app's store
 * header image (or capsule image) from the public `appdetails` endpoint, cached
 * per app id and looked up at most once per poll. It never invents a URL, never
 * trusts a host outside Steam's image CDNs, and reports failures as "no
 * artwork" rather than substituting something unrelated.
 *
 * Provenance is carried on the item (`imageKind`, `imageAttribution`) so the
 * dashboard and the Discord embed can say where the image came from.
 */
import { safeImageUrl } from "./feed-content";
import { providerJson } from "./integration-http";

export type SteamArtworkKind = "app-header" | "app-capsule";

export type SteamArtwork = {
  appId: number;
  appName: string;
  url: string;
  kind: SteamArtworkKind;
};

/** Store metadata changes slowly; one lookup per app id per 6 hours is plenty. */
export const STEAM_ARTWORK_TTL_MS = 6 * 60 * 60 * 1000;
/** A failed lookup is retried after 10 minutes, not on every poll. */
export const STEAM_ARTWORK_FAILURE_TTL_MS = 10 * 60 * 1000;

const MAX_ENTRIES = 500;
const MAX_BYTES = 256 * 1024;

/**
 * Only Steam's own image CDNs are accepted for a fallback image. A lookalike
 * host such as `evil-steamstatic.com` must not pass, so the check is on label
 * boundaries rather than `includes()`.
 */
export const STEAM_IMAGE_HOSTS = [
  "steamstatic.com",
  "akamai.steamstatic.com",
  "cloudflare.steamstatic.com",
] as const;

export function isSteamImageUrl(value: string) {
  const safe = safeImageUrl(value);
  if (!safe) return false;
  try {
    const host = new URL(safe).hostname.toLowerCase();
    return STEAM_IMAGE_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

export function steamAppdetailsUrl(appId: number) {
  return `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic&l=english`;
}

type AppdetailsResponse = Record<
  string,
  {
    success?: boolean;
    data?: {
      name?: unknown;
      header_image?: unknown;
      capsule_image?: unknown;
    };
  }
>;

/**
 * Pure mapping from an `appdetails` payload to one validated artwork record.
 * `header_image` is preferred (it is the wide capsule Steam uses above an
 * event); `capsule_image` is the narrower fallback. Anything else is ignored.
 */
export function appArtworkFromStore(
  payload: unknown,
  appId: number
): SteamArtwork | null {
  if (!payload || typeof payload !== "object") return null;
  const entry = (payload as AppdetailsResponse)[String(appId)];
  if (!entry || entry.success !== true || !entry.data) return null;
  const appName =
    typeof entry.data.name === "string" ? entry.data.name.slice(0, 120) : "";
  const candidates: [unknown, SteamArtworkKind][] = [
    [entry.data.header_image, "app-header"],
    [entry.data.capsule_image, "app-capsule"],
  ];
  for (const [raw, kind] of candidates) {
    if (typeof raw !== "string") continue;
    if (!isSteamImageUrl(raw)) continue;
    return { appId, appName, url: safeImageUrl(raw), kind };
  }
  return null;
}

/** Whether the fallback lookup is enabled (`STEAM_APP_ARTWORK=false` disables it). */
export function steamArtworkEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (env.STEAM_APP_ARTWORK ?? "").trim().toLowerCase() !== "false";
}

type CacheEntry = {
  value: SteamArtwork | null;
  expiresAt: number;
};

/**
 * Small bounded cache: one entry per app id, shared by every source and every
 * article in a poll, so ten announcements from the same game cost one request.
 * Null results are cached too (short TTL) to avoid retrying a broken app id on
 * every poll.
 */
export class SteamArtworkCache {
  private entries = new Map<number, CacheEntry>();
  private pending = new Map<number, Promise<SteamArtwork | null>>();

  constructor(
    private readonly options: {
      transport?: (url: string) => Promise<unknown>;
      now?: () => number;
      ttlMs?: number;
      failureTtlMs?: number;
      maxEntries?: number;
    } = {}
  ) {}

  private get now() {
    return this.options.now?.() ?? Date.now();
  }

  async get(appId: number): Promise<SteamArtwork | null> {
    if (!Number.isSafeInteger(appId) || appId <= 0) return null;
    const cached = this.entries.get(appId);
    if (cached && cached.expiresAt > this.now) {
      // Refresh insertion order so the map behaves as an LRU.
      this.entries.delete(appId);
      this.entries.set(appId, cached);
      return cached.value;
    }
    const pending = this.pending.get(appId);
    if (pending) return pending;
    const task = this.fetchArtwork(appId).finally(() => {
      if (this.pending.get(appId) === task) this.pending.delete(appId);
    });
    this.pending.set(appId, task);
    return task;
  }

  private async fetchArtwork(appId: number): Promise<SteamArtwork | null> {
    const transport =
      this.options.transport ??
      ((url) => providerJson(url, { timeoutMs: 7000, maxBytes: MAX_BYTES }));
    let value: SteamArtwork | null = null;
    try {
      value = appArtworkFromStore(
        await transport(steamAppdetailsUrl(appId)),
        appId
      );
    } catch {
      // A store outage or a rate limit is not an error for the article: the
      // item simply has no fallback artwork this time.
      value = null;
    }
    const ttl =
      value === null
        ? (this.options.failureTtlMs ?? STEAM_ARTWORK_FAILURE_TTL_MS)
        : (this.options.ttlMs ?? STEAM_ARTWORK_TTL_MS);
    this.entries.delete(appId);
    this.entries.set(appId, { value, expiresAt: this.now + ttl });
    while (this.entries.size > (this.options.maxEntries ?? MAX_ENTRIES))
      this.entries.delete(this.entries.keys().next().value as number);
    return value;
  }

  /** Test/doctor helper: forget everything (for example after a config change). */
  clear() {
    this.entries.clear();
    this.pending.clear();
  }
}

/** Process-wide cache used by the delivery worker's Steam poll path. */
export const steamArtwork = new SteamArtworkCache();
