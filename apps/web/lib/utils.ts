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
    throw new Error(result.error ?? "Something went wrong. Please try again.");
  return result;
}
