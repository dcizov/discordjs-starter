import { isDemo } from "@orbit/core/environment";
import { redisConnection } from "@orbit/core/queue";
import "server-only";
import { HttpError } from "./auth";
export function assertOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const liveOrigin =
    !isDemo() && process.env.APP_URL
      ? new URL(process.env.APP_URL).origin
      : null;
  if (liveOrigin) {
    if (origin !== liveOrigin)
      throw new HttpError(
        403,
        "This request did not originate from the dashboard"
      );
    return;
  }
  // A preview proxy terminates TLS outside Next. Trust forwarded host only in the isolated demo/development environment.
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.headers.get("host") ??
    new URL(req.url).host;
  try {
    const parsed = new URL(origin ?? "");
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== host)
      throw new Error();
  } catch {
    throw new HttpError(
      403,
      "This request did not originate from the dashboard"
    );
  }
}
const limits = new Map<string, { count: number; until: number }>();
export async function rateLimit(key: string, max = 120) {
  if (isDemo()) {
    const old = limits.get(key);
    if (!old || old.until < Date.now()) {
      limits.set(key, { count: 1, until: Date.now() + 60000 });
      return;
    }
    if (++old.count > max)
      throw new HttpError(429, "Too many requests. Please wait a moment.");
    if (limits.size > 3000)
      for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
    return;
  }
  const redis = redisConnection();
  const count = Number(
    await redis.eval(
      "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",
      1,
      `limit:${key}`
    )
  );
  if (count > max)
    throw new HttpError(429, "Too many requests. Please wait a moment.");
}
export async function readBounded(req: Request, max = 65536) {
  if (Number(req.headers.get("content-length") ?? 0) > max)
    throw new HttpError(413, "Request is too large");
  const reader = req.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function body(req: Request) {
  const raw = await readBounded(req);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
