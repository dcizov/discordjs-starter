const MAX_BYTES = 1024 * 1024;

/**
 * A provider refused or failed, which is not the administrator's mistake. The
 * dashboard maps this to 502 (and honours Retry-After) instead of reporting
 * "Bad Request" for a Steam outage.
 */
export class UpstreamError extends Error {
  constructor(
    public status: number,
    public retryAfterMs?: number
  ) {
    super(
      `Integration returned HTTP ${status}${retryAfterMs ? `; retry after ${Math.ceil(retryAfterMs / 1000)}s` : ""}`
    );
    this.name = "UpstreamError";
  }
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
  return new UpstreamError(status, retryAfterMs);
}

export async function officialJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw upstreamError(
      res.status,
      res.headers.get("retry-after") ?? undefined
    );
  }
  const text = await res.text();
  if (text.length > 4 * MAX_BYTES)
    throw new Error("Integration response is too large");
  return JSON.parse(text);
}
