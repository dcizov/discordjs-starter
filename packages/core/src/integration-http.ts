/**
 * Shared transport primitives for trusted provider endpoints.
 *
 * This module knows nothing about any provider: no auth scheme, pagination,
 * retry budget or response shape lives here. It only guarantees the things
 * every outbound provider call needs:
 *
 * - an explicit timeout and a bounded response body,
 * - no redirects (a provider cannot bounce Orbit to another host),
 * - a small, secret-safe error vocabulary (`UpstreamError.kind`), so callers
 *   can tell "our key is wrong" from "Steam is down" from "we rate-limited",
 * - no automatic retries. Retrying is a caller decision, because a shared
 *   primitive cannot know whether an operation is idempotent or whether the
 *   caller (route, worker job) already retries; multiplying retries across
 *   layers is how a provider outage becomes a self-inflicted flood.
 *
 * Administrator-supplied URLs (RSS/Atom feeds, webhooks) never go through this
 * module: those need SSRF checks, DNS pinning and a stricter redirect policy,
 * which live in `feeds.ts`.
 */
export const PROVIDER_TIMEOUT_MS = 15_000;
export const PROVIDER_MAX_BYTES = 1024 * 1024;

export type UpstreamKind =
  | "auth"
  | "rate-limited"
  | "timeout"
  | "unavailable"
  | "invalid-response"
  | "not-found"
  | "rejected";

/**
 * A provider failed or refused, which is not the administrator's mistake. The
 * dashboard maps this to 502 (and honours Retry-After) instead of reporting
 * "Bad Request" for a Steam outage.
 */
export class UpstreamError extends Error {
  constructor(
    /** Upstream HTTP status when one was received; 502/504 when synthesised. */
    public status: number,
    public retryAfterMs?: number,
    public kind: UpstreamKind = "unavailable"
  ) {
    super(messageFor(kind, status, retryAfterMs));
    this.name = "UpstreamError";
  }
  /** Whether repeating the same request later could plausibly succeed. */
  get retryable() {
    return ["rate-limited", "timeout", "unavailable"].includes(this.kind);
  }
}

function messageFor(kind: UpstreamKind, status: number, retryAfterMs?: number) {
  const retry = retryAfterMs
    ? ` Retry after ${Math.ceil(retryAfterMs / 1000)}s.`
    : "";
  switch (kind) {
    case "auth":
      return "The integration rejected Orbit's credentials. Check the API key or account used for it.";
    case "rate-limited":
      return `The integration is rate limiting Orbit.${retry || " Try again later."}`;
    case "timeout":
      return "The integration did not answer in time. Nothing was changed; try again later.";
    case "invalid-response":
      return "The integration returned a response Orbit could not use. Nothing was changed.";
    case "not-found":
      return "The integration reported that the requested item does not exist.";
    case "rejected":
      return `The integration rejected the request (HTTP ${status}).`;
    default:
      return `Integration returned HTTP ${status}${retry}`;
  }
}

function kindForStatus(status: number): UpstreamKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "rejected";
}

export function upstreamError(status: number, retryAfter?: string) {
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : new Date(retryAfter).getTime() - Date.now();
    if (!Number.isFinite(retryAfterMs)) retryAfterMs = undefined;
    else retryAfterMs = Math.max(1000, Math.min(retryAfterMs, 86400000));
  }
  return new UpstreamError(status, retryAfterMs, kindForStatus(status));
}

export function upstreamTimeout() {
  return new UpstreamError(504, undefined, "timeout");
}

export function invalidUpstreamResponse() {
  return new UpstreamError(502, undefined, "invalid-response");
}

/**
 * Read a response body with a hard byte ceiling.
 *
 * `content-length` is only a hint: a provider (or a proxy) can lie or stream
 * without one, so the reader is also cut off while accumulating.
 */
export async function readBoundedText(
  response: Response,
  maxBytes = PROVIDER_MAX_BYTES
) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw invalidUpstreamResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw invalidUpstreamResponse();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export type ProviderJsonOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  accept?: string;
  method?: string;
  body?: RequestInit["body"];
};

/**
 * One trusted-provider JSON request: explicit timeout, no redirects, bounded
 * body, validated JSON, provider-shaped errors. No retry.
 */
export async function providerJson(
  url: string,
  options: ProviderJsonOptions = {}
): Promise<unknown> {
  const {
    timeoutMs = PROVIDER_TIMEOUT_MS,
    maxBytes = PROVIDER_MAX_BYTES,
    headers = {},
    accept = "application/json",
    method = "GET",
    body,
  } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      body,
      headers: { accept, ...headers },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // AbortSignal.timeout rejects with a TimeoutError; a refused connection or
    // DNS failure is a plain TypeError. Both are provider-side, not the
    // administrator's invalid input.
    if (isTimeout(error)) throw upstreamTimeout();
    throw new UpstreamError(503, undefined, "unavailable");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw upstreamError(
      response.status,
      response.headers.get("retry-after") ?? undefined
    );
  }
  const text = await readBoundedText(response, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw invalidUpstreamResponse();
  }
}

function isTimeout(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/** Backwards-compatible alias used by the Steam news and ITAD adapters. */
export async function officialJson(url: string, init?: RequestInit) {
  return providerJson(url, {
    method: init?.method,
    body: init?.body,
    headers: init?.headers as Record<string, string> | undefined,
  });
}
