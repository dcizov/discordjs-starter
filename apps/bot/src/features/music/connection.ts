import { diagnosticText } from "@orbit/core/diagnostics";

/**
 * Why a Lavalink connection attempt failed, as far as the library's own error
 * evidence goes. `unknown` is a real answer: a message that names no cause is
 * not renamed into a guess.
 */
export type MusicConnectionCategory =
  "refused" | "dns" | "timeout" | "auth" | "tls" | "closed" | "unknown";

export type MusicConnectionContext = {
  /** Node name from the library event. */
  node?: string;
  /** Configured `host:port`; never a URL with credentials. */
  host?: string;
  secure?: boolean;
  /** Retry delay the library announced, when it announced one. */
  retryInSeconds?: number;
};

export type MusicConnectionDiagnostic = {
  category: MusicConnectionCategory;
  /** One sentence for the health row; never empty. */
  summary: string;
  /** Multi-line, sanitized evidence for logs. */
  detail: string;
  /** Next step; empty when the evidence does not support one. */
  hint: string;
};

const CATEGORY_LABEL: Record<MusicConnectionCategory, string> = {
  refused: "Lavalink refused the connection",
  dns: "Lavalink host name did not resolve",
  timeout: "Lavalink did not answer before the timeout",
  auth: "Lavalink rejected the credentials",
  tls: "TLS failed before Lavalink answered",
  closed: "Lavalink closed the connection",
  unknown: "Lavalink connection failed",
};

const REFUSED = new Set(["ECONNREFUSED", "ECONNRESET"]);
const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA"]);
const TIMEOUT = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const TLS = new Set([
  "EPROTO",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_PACKET_LENGTH_MISMATCH",
]);

type Evidence = {
  names: string[];
  /** Messages in walk order; the first non-empty one is the headline. */
  messages: string[];
  codes: string[];
  statuses: number[];
  aggregateSize: number;
};

const AGGREGATE_LIMIT = 4;

/**
 * Walk the error, its `cause` chain and any `AggregateError` members, keeping
 * only fields that describe the failure: name, message, code, status. Request
 * headers, auth values and arbitrary properties are deliberately not read.
 */
function collect(error: unknown, evidence: Evidence, depth = 0): Evidence {
  if (depth > 3 || error === null || error === undefined) return evidence;
  if (typeof error !== "object") {
    evidence.messages.push(String(error));
    return evidence;
  }
  const value = error as Record<string, unknown>;
  if (typeof value.name === "string" && value.name !== "Error")
    evidence.names.push(value.name);
  if (typeof value.message === "string" && value.message.trim())
    evidence.messages.push(value.message.trim());
  for (const key of ["code", "errno"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim())
      evidence.codes.push(candidate.trim());
    else if (typeof candidate === "number")
      evidence.codes.push(String(candidate));
  }
  for (const key of ["status", "statusCode"] as const) {
    const candidate = value[key];
    if (typeof candidate === "number") evidence.statuses.push(candidate);
  }
  // Node's websocket client reports a refused dual-stack connect as an
  // AggregateError with an empty message and one child per address; without its
  // children the diagnostic would say nothing at all.
  if (Array.isArray(value.errors)) {
    const children = value.errors as unknown[];
    evidence.aggregateSize = Math.max(evidence.aggregateSize, children.length);
    for (const child of children.slice(0, AGGREGATE_LIMIT))
      collect(child, evidence, depth + 1);
  }
  if ("cause" in value) collect(value.cause, evidence, depth + 1);
  return evidence;
}

function classify(evidence: Evidence): MusicConnectionCategory {
  const codes = evidence.codes.map((code) => code.toUpperCase());
  if (evidence.statuses.some((status) => status === 401 || status === 403))
    return "auth";
  if (codes.some((code) => REFUSED.has(code))) return "refused";
  if (codes.some((code) => DNS.has(code))) return "dns";
  if (codes.some((code) => TIMEOUT.has(code))) return "timeout";
  if (codes.some((code) => TLS.has(code) || code.startsWith("ERR_SSL_")))
    return "tls";
  // A websocket close without a code the transport understands: the socket
  // existed and then ended, which is different from never connecting.
  if (codes.some((code) => code === "ECONNABORTED" || code === "EPIPE"))
    return "closed";
  return "unknown";
}

function target(context: MusicConnectionContext) {
  if (!context.host) return "";
  const host = diagnosticText(context.host, 120).trim();
  if (!host) return "";
  return context.secure ? `${host} (TLS)` : host;
}

function hintFor(
  category: MusicConnectionCategory,
  context: MusicConnectionContext
) {
  switch (category) {
    case "refused": {
      const where = target(context);
      return where
        ? `Nothing is accepting connections at ${where}. Check that Lavalink is running and that the address and port are right: a host-run bot reaches localhost:2333, a Compose bot reaches the service name (lavalink:2333).`
        : "Nothing is accepting connections at the configured address. Check that Lavalink is running and that the address and port are right.";
    }
    case "dns":
      return "The host name did not resolve from the bot's network. Check LAVALINK_URL and that the bot can resolve that name where it runs.";
    case "timeout":
      return "The connection was attempted but nothing answered in time. Check that Lavalink is running and reachable on this network, and that it finished starting.";
    case "auth":
      return "Lavalink answered and rejected the request. Check that LAVALINK_PASSWORD matches the Lavalink server password.";
    case "tls":
      return "The TLS handshake failed before Lavalink answered. LAVALINK_SECURE=true expects an https/wss endpoint with a certificate this host trusts; a plain-HTTP Lavalink behind secure=true looks like this.";
    case "closed":
      return "The socket opened and then closed. Check the Lavalink log for the close reason; the bot keeps retrying with backoff.";
    default:
      // No evidence, no advice: guessing "is it running?" here would be as
      // likely to mislead as the empty message it replaces.
      return "";
  }
}

/**
 * Turn a library error event into a diagnostic a reader can act on.
 *
 * Name, message, `code` and HTTP status are read from the error, its causes and
 * aggregate members — the fields the library actually sets. Everything is
 * passed through `diagnosticText`, so a password or signed URL that ends up in
 * a message is redacted before it is logged or stored.
 */
export function musicConnectionDiagnostic(
  error: unknown,
  context: MusicConnectionContext = {}
): MusicConnectionDiagnostic {
  const evidence = collect(error, {
    names: [],
    messages: [],
    codes: [],
    statuses: [],
    aggregateSize: 0,
  });
  const category = classify(evidence);
  const label = CATEGORY_LABEL[category];
  const code = evidence.codes[0];
  const status = evidence.statuses[0];
  const headline =
    evidence.messages[0] ??
    (evidence.aggregateSize
      ? `${evidence.aggregateSize} connection attempts failed`
      : "The library reported an error without a message");
  const qualifier = code
    ? ` (${code}${status ? `, HTTP ${status}` : ""})`
    : status
      ? ` (HTTP ${status})`
      : "";
  const subject = `${label}${qualifier}`;
  const hint = diagnosticText(hintFor(category, context), 400);
  // Health rows are read in a card; keep the summary to one sentence and leave
  // the multi-line evidence for the log.
  const where = target(context);
  const summary = diagnosticText(
    [
      `${subject}: ${headline}`,
      where ? `target ${where}` : "",
      evidence.aggregateSize > 1 ? `${evidence.aggregateSize} attempts` : "",
    ]
      .filter(Boolean)
      .join(" — "),
    240
  );
  const detail = diagnosticText(
    [
      `name: ${[...new Set(evidence.names)].join(", ") || "Error"}`,
      `message: ${headline}`,
      code ? `code: ${code}` : "",
      status ? `http status: ${status}` : "",
      evidence.aggregateSize
        ? `aggregate attempts: ${evidence.aggregateSize}`
        : "",
      evidence.messages.length > 1
        ? `chain: ${evidence.messages.slice(1).join(" | ")}`
        : "",
      context.node ? `node: ${diagnosticText(context.node, 80)}` : "",
      context.host ? `target: ${target(context)}` : "",
      context.retryInSeconds !== undefined
        ? `retry in: ${context.retryInSeconds}s`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    4000
  );
  return { category, summary, detail, hint };
}

/**
 * Keeps a flapping reconnect loop from writing the same warning every few
 * seconds: the full line is logged when the evidence changes, and repeats are
 * counted instead of printed. Health is still updated on every attempt.
 */
export class MusicConnectionReporter {
  private signature = "";
  private repeats = 0;
  report(error: unknown, context: MusicConnectionContext = {}) {
    const diagnostic = musicConnectionDiagnostic(error, context);
    const signature = `${diagnostic.category}\n${diagnostic.detail}`;
    const repeated = signature === this.signature;
    this.repeats = repeated ? this.repeats + 1 : 1;
    this.signature = signature;
    return { ...diagnostic, repeated, repeats: this.repeats };
  }
  /** The next different error is logged again even if it repeats the last one. */
  reset() {
    this.signature = "";
    this.repeats = 0;
  }
}
