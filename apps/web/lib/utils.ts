import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function relativeTime(value: string, referenceAt: string) {
  const d = Math.max(0, Date.parse(referenceAt) - Date.parse(value));
  if (!Number.isFinite(d)) return "Time unavailable";
  if (d < 60000) return "Just now";
  if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} hr ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}
export function number(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}
export function duration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/**
 * A failed HTTP response, carrying what the caller needs to react to it.
 *
 * A bare `Error` lost the status code, which meant nothing upstream could tell
 * "the server is rate-limiting me, stop asking" from "that request was
 * malformed" or "the worker is down" — so every failure was retried on the
 * same schedule. 429 in particular has to be recognisable: retrying it is what
 * keeps the client rate-limited.
 */
export class HttpError extends Error {
  readonly status: number;
  /** `Retry-After` in milliseconds, when the server sent a usable one. */
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    message: string,
    retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Narrowing helper: `isHttpError(e, 429)` reads better than a status fetch. */
export function isHttpError(
  error: unknown,
  status?: number
): error is HttpError {
  if (!(error instanceof HttpError)) return false;
  return status === undefined || error.status === status;
}

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * It is legal either as a number of seconds or as an HTTP date, and a value we
 * cannot read must be treated as absent rather than as zero — guessing zero is
 * how a retry loop becomes a hammering loop.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(seconds)) {
    if (seconds < 0) return null;
    return Math.round(seconds * 1000);
  }
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return null;
  const delta = at - Date.now();
  // Already elapsed, or nonsense: fall back to the caller's own backoff.
  return delta > 0 ? delta : null;
}

export async function request<T = any>(
  url: string,
  method = "GET",
  data?: unknown,
  headers?: Record<string, string>,
  signal?: AbortSignal
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(signal ? { signal } : {}),
  });
  const result = await r.json();
  if (!r.ok)
    throw new HttpError(
      r.status,
      result?.error ?? "Something went wrong. Please try again.",
      parseRetryAfter(r.headers.get("retry-after"))
    );
  return result;
}
