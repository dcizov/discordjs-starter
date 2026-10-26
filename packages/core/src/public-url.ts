/**
 * Browser-safe URL gate.
 *
 * This lives outside `safety.ts` because that module imports `node:crypto`, which
 * a client component cannot bundle. The rule is the same one the server uses:
 * absolute http(s) only, no embedded credentials, bounded length.
 */
export function safePublicLink(value: string) {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      return "";
    return u.toString().slice(0, 2000);
  } catch {
    return "";
  }
}
