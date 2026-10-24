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
