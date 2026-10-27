import { createHash } from "node:crypto";
import { z } from "zod";

const guildSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  name: z.string().min(1).max(100),
  icon: z.string().nullable().optional(),
  owner: z.boolean().optional(),
  permissions: z.string().regex(/^\d{1,30}$/),
});
export type DiscordPermissionGuild = z.infer<typeof guildSchema>;
type Failure = { status: 401 | 429 | 503; upstreamStatus?: number };
type Entry = {
  data?: DiscordPermissionGuild[];
  verifiedAt?: number;
  blockedUntil?: number;
  failure?: Failure;
};
/**
 * How long a verified guild-permission snapshot may be reused.
 *
 * Read views tolerate a longer window than mutations. The old behaviour
 * bypassed the cache for *every* mutation, so a burst of dashboard controls
 * (pause, skip, volume, repeat) issued one Discord request each and hit the
 * OAuth guild-list rate limit; the fix is a short time window, not "no cache".
 *
 * A stale snapshot never authorizes execution by itself: bot actions fetch the
 * member again (`force: true`) and re-check module, role and channel
 * permissions at execution time.
 */
export const PERMISSION_READ_MAX_AGE_MS = 30_000;
export const PERMISSION_MUTATION_MAX_AGE_MS = 10_000;

export type DiscordPermissionState = {
  entries: Map<string, Entry>;
  pending: Map<string, Promise<DiscordPermissionGuild[]>>;
  globalBlockedUntil: number;
};
export function createDiscordPermissionState(): DiscordPermissionState {
  return { entries: new Map(), pending: new Map(), globalBlockedUntil: 0 };
}
export class DiscordPermissionError extends Error {
  readonly code = "DISCORD_PERMISSION_LOOKUP_FAILED";
  constructor(
    public status: 401 | 429 | 503,
    public retryAfterSeconds?: number,
    public upstreamStatus?: number
  ) {
    super(
      status === 401
        ? "Your Discord sign-in has expired or lacks guild access. Sign in again."
        : status === 429
          ? `Discord is rate limiting permission checks. Please try again in ${retryAfterSeconds ?? 30} ${(retryAfterSeconds ?? 30) === 1 ? "second" : "seconds"}.`
          : "Discord permission checks are temporarily unavailable. Please try again shortly."
    );
  }
}
export function isDiscordPermissionError(
  error: unknown
): error is DiscordPermissionError {
  // In-flight requests can survive a Next development module reload.
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "DISCORD_PERMISSION_LOOKUP_FAILED"
  );
}
function seconds(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  if (value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n * 1000 : 0;
}
function retryDelay(response: Response, body: any, now: number) {
  const header = response.headers.get("retry-after");
  const date =
    header && !Number.isFinite(Number(header)) ? Date.parse(header) : 0;
  return Math.max(
    seconds(header),
    Number.isFinite(date) ? date - now : 0,
    seconds(response.headers.get("x-ratelimit-reset-after")),
    seconds(body?.retry_after),
    1000
  );
}

/** Server-side OAuth guild permissions. No stale-on-error or automatic retries. */
export class DiscordPermissionClient {
  private state: DiscordPermissionState;
  private fetcher: typeof fetch;
  private now: () => number;
  private maxEntries: number;
  private onFailure?: (info: {
    status: number;
    upstreamStatus?: number;
    retryAfterSeconds?: number;
  }) => void;
  constructor(
    options: {
      state?: DiscordPermissionState;
      fetcher?: typeof fetch;
      now?: () => number;
      maxEntries?: number;
      onFailure?: DiscordPermissionClient["onFailure"];
    } = {}
  ) {
    this.state = options.state ?? createDiscordPermissionState();
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 1000;
    this.onFailure = options.onFailure;
  }
  private remember(key: string, entry: Entry) {
    this.state.entries.delete(key);
    this.state.entries.set(key, entry);
    while (this.state.entries.size > this.maxEntries)
      this.state.entries.delete(this.state.entries.keys().next().value!);
  }
  /**
   * `maxAgeMs` is how old a verified snapshot may be before Discord is asked
   * again. `0` forces a lookup (used where a caller must observe revocation
   * immediately); concurrent callers always share one in-flight request.
   */
  async guilds(
    sessionId: string,
    accessToken: string,
    options: number | { maxAgeMs?: number } = {}
  ) {
    if (!sessionId || !accessToken) throw new DiscordPermissionError(401);
    // Never store access tokens as cache keys, and never mix rotated tokens.
    const key = `${sessionId}:${createHash("sha256").update(accessToken).digest("hex")}`;
    const entry = this.state.entries.get(key);
    const now = this.now();
    if (this.state.globalBlockedUntil > now)
      throw new DiscordPermissionError(
        429,
        Math.ceil((this.state.globalBlockedUntil - now) / 1000),
        429
      );
    const requested =
      typeof options === "number" ? options : (options?.maxAgeMs ?? 30000);
    const maxAge = Number.isFinite(requested) ? Math.max(0, requested) : 30000;
    // A forced lookup (maxAgeMs 0) still yields to a request already in flight.
    const pending = this.state.pending.get(key);
    if (pending) return pending;
    if (entry?.data && now - entry.verifiedAt! < maxAge) return entry.data;
    if (entry?.blockedUntil && entry.blockedUntil > now)
      throw new DiscordPermissionError(
        entry.failure?.status ?? 429,
        Math.ceil((entry.blockedUntil - now) / 1000),
        entry.failure?.upstreamStatus
      );
    if (this.state.pending.size >= this.maxEntries)
      throw new DiscordPermissionError(503, 5);
    const task = this.lookup(key, accessToken);
    this.state.pending.set(key, task);
    try {
      return await task;
    } finally {
      if (this.state.pending.get(key) === task) this.state.pending.delete(key);
    }
  }
  private async lookup(
    key: string,
    token: string
  ): Promise<DiscordPermissionGuild[]> {
    let upstreamStatus: number | undefined;
    try {
      const response = await this.fetcher(
        "https://discord.com/api/v10/users/@me/guilds?limit=200",
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        }
      );
      upstreamStatus = response.status;
      if (!response.ok) {
        const status =
          response.status === 401 || response.status === 403
            ? 401
            : response.status === 429
              ? 429
              : 503;
        const body = await response.json().catch(() => null);
        const now = this.now();
        const hasRetry =
          response.headers.has("retry-after") || body?.retry_after != null;
        const delay =
          status === 429
            ? hasRetry || response.headers.has("x-ratelimit-reset-after")
              ? retryDelay(response, body, now)
              : 30000
            : status === 401
              ? 1000
              : 5000;
        if (
          status === 429 &&
          (body?.global === true ||
            response.headers.get("x-ratelimit-global") === "true")
        )
          this.state.globalBlockedUntil = Math.max(
            this.state.globalBlockedUntil,
            now + delay
          );
        // A failed fresh verification invalidates the previous read snapshot.
        this.remember(key, {
          blockedUntil: now + delay,
          failure: { status, upstreamStatus },
        });
        throw new DiscordPermissionError(
          status,
          Math.ceil(delay / 1000),
          upstreamStatus
        );
      }
      const data = z
        .array(guildSchema)
        .max(200)
        .parse(await response.json());
      const now = this.now();
      this.remember(key, {
        data,
        verifiedAt: now,
        // Avoid knowingly exhausting the bucket again on the next mutation.
        ...(response.headers.get("x-ratelimit-remaining") === "0"
          ? {
              blockedUntil: now + retryDelay(response, null, now),
              failure: { status: 429, upstreamStatus: 429 },
            }
          : {}),
      });
      return data;
    } catch (error) {
      const failure = isDiscordPermissionError(error)
        ? error
        : new DiscordPermissionError(503, 5, upstreamStatus);
      if (!isDiscordPermissionError(error))
        this.remember(key, {
          blockedUntil: this.now() + 5000,
          failure: { status: 503, upstreamStatus },
        });
      // Only status/timing: never log OAuth tokens, response bodies, or session IDs.
      this.onFailure?.({
        status: failure.status,
        upstreamStatus: failure.upstreamStatus,
        retryAfterSeconds: failure.retryAfterSeconds,
      });
      throw failure;
    }
  }
}
