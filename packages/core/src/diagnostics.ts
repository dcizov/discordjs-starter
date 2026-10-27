const TRUNCATED = "\n[diagnostic truncated]";

/** Plain-text diagnostics for logs/audit, not HTML. Keep line breaks, never dump error objects. */
export function diagnosticText(
  value: string,
  maxLength = 8192,
  environment: Record<string, string | undefined> = process.env
) {
  let text = value;
  // Replace known credentials before truncation, including values containing whitespace.
  const secrets = Object.entries(environment)
    .filter(
      ([key, secret]) =>
        /TOKEN|SECRET|PASSWORD|(?:^|_)KEY$|DATABASE_URL|REDIS_URL/i.test(key) &&
        secret &&
        secret.length > 0
    )
    .map(([, secret]) => secret!)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    for (const representation of new Set([
      secret,
      encodeURIComponent(secret),
    ])) {
      if (representation.length >= 4)
        text = text.replaceAll(representation, "[REDACTED]");
      else {
        // Short development credentials still need masking as standalone values,
        // without replacing a one-letter password inside every ordinary word.
        const escaped = representation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(
          new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "g"),
          "[REDACTED]"
        );
      }
    }
  }
  // Do not leak credentials or signed query/fragment values embedded in provider URLs.
  text = text.replace(
    /(?:https?|wss?|postgres(?:ql)?|rediss?):\/\/[^\s<>"']+/gi,
    (raw) => {
      try {
        const url = new URL(raw);
        if (url.username) url.username = "REDACTED";
        if (url.password) url.password = "REDACTED";
        const keys = [...new Set(url.searchParams.keys())];
        for (const key of keys) url.searchParams.set(key, "REDACTED");
        if (url.hash) url.hash = "REDACTED";
        return url.toString();
      } catch {
        return "[redacted URL]";
      }
    }
  );
  text = text.replace(
    /(["']?(?:authorization|session[_-]?id|endpoint|(?:access[_-]?|refresh[_-]?|secret[_-]?)?token|client[_-]?(?:id|secret)|password|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Bot|Basic)\s+[^\s,;&)]+|[^\s,;&)]+)/gi,
    "$1[REDACTED]"
  );
  // Strip terminal controls, preserving the actual multiline error for copying.
  text = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  text = [...text]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      );
    })
    .join("");
  const limit = Math.max(TRUNCATED.length, maxLength);
  return text.length <= limit
    ? text
    : `${text.slice(0, limit - TRUNCATED.length)}${TRUNCATED}`;
}

/**
 * Lavalink reports a multi-client failure as one message plus one `Client [NAME]
 * failed: <reason>` line per client, followed by that reason's Java stack frame.
 *
 * Collapsing the whole blob into a single category loses the distinction that
 * matters most: `ANDROID_VR: requires login`, `WEB: no supported audio streams`
 * and `WEB_EMBEDDED: unavailable` are three different answers from three
 * different clients, and only one of them would survive a first-match regex.
 */
export type ClientFailureGroup = {
  /** Client identifiers that reported this reason, in first-seen order. */
  clients: string[];
  /** The reason exactly as the backend worded it, whitespace-normalized. */
  reason: string;
};

/** `Client [ANDROID_VR] failed: This video requires login.` */
const CLIENT_FAILED_LINE = /^\s*Client\s*\[([^\]]+)\]\s*failed:\s*(.+?)\s*$/;
/** Java continuation lines that follow a client's reason: not reasons. */
const STACK_LINE =
  /^(?:\s*at\s|\.{3}\s*\d+\s+more|Caused by:|Suppressed:|\s*\||dev\.[\w.]+\.(?:AllClientsFailed)?Exception)/;
/** A reason that ran straight into its own stack frame. */
const TRAILING_FRAME = /\s+at\s+[\w.$]+\([\w.$]+\.java:\d+\)\s*$/;

const normalizeReason = (reason: string) =>
  reason.replace(TRAILING_FRAME, "").replace(/\s+/g, " ").trim();

/**
 * Group a Lavalink exception's per-client reasons, keeping each client that
 * reported the same wording together instead of repeating the sentence once per
 * client. Returns `[]` when the backend did not report per-client lines, which
 * is the normal case and is not an error.
 */
export function parseClientFailureGroups(
  text: string,
  maxGroups = 8
): ClientFailureGroup[] {
  const groups: ClientFailureGroup[] = [];
  const indexByReason = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || STACK_LINE.test(line)) continue;
    const match = CLIENT_FAILED_LINE.exec(line);
    if (!match) continue;
    const client = match[1]!.trim();
    const reason = normalizeReason(match[2]!);
    if (!client || !reason) continue;
    // Compare case-insensitively so "No supported audio streams available." and
    // "no supported audio streams available" do not become two groups.
    const key = reason.toLowerCase();
    const existing = indexByReason.get(key);
    if (existing === undefined) {
      if (groups.length >= maxGroups) continue;
      indexByReason.set(key, groups.length);
      groups.push({ clients: [client], reason });
    } else if (!groups[existing]!.clients.includes(client)) {
      groups[existing]!.clients.push(client);
    }
  }
  return groups;
}

/**
 * Truncate on a word boundary instead of mid-word.
 *
 * `text.slice(0, n)` is what silently produced "...and O" in an operator-facing
 * summary. Cutting at the last space keeps every word readable; a single word
 * longer than the budget is still hard-cut so the bound always holds.
 */
export function truncateAtWord(
  text: string,
  maxLength: number,
  marker = "…"
): string {
  if (text.length <= maxLength) return text;
  const budget = Math.max(marker.length, maxLength - marker.length);
  const window = text.slice(0, budget);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? lastSpace : budget;
  return `${text.slice(0, cut).trimEnd()}${marker}`;
}

/** Capture messages/causes only. Stacks, request headers, payloads, and arbitrary properties stay private. */
export function errorDiagnostic(error: unknown, maxLength = 8192) {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    parts.push(`${depth ? "Caused by: " : ""}${current.message}`);
    current = current.cause;
  }
  return diagnosticText(
    parts.length ? parts.join("\n") : "Unknown error",
    maxLength
  );
}
