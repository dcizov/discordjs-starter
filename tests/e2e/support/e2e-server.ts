/**
 * The server the browser tests talk to, and the check that it is the right one.
 *
 * `reuseExistingServer: !CI` means a dev server already listening on the
 * Playwright port is used as-is. When that server is `npm run dev` against
 * real data, every spec then fails the same opaque way — a timeout waiting for
 * `[data-hydrated="true"]`, or an assertion about a member who is not in the
 * demo workspace — and nothing in the output mentions the server. The reader
 * is left to work out that the tests were never talking to the build they
 * think they were.
 *
 * Two changes, because either alone leaves a gap:
 *
 * - A dedicated port by default, so the e2e run does not compete with
 *   `npm run dev` for 3000 in the first place.
 * - A preflight that refuses to continue when something *else* is on that
 *   port, naming the port and the remedy instead of timing out.
 *
 * `GET /api/healthz` is the discriminator: it answers `{ status, mode }` where
 * `mode` is `"demo"` or `"live"`, derived from the same `DEMO_MODE` the web
 * server itself reads.
 */

/** Not 3000, so a dev server on 3000 is not mistaken for the e2e server. */
export const DEFAULT_E2E_PORT = 3100;

export function e2ePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.E2E_PORT?.trim();
  if (!raw) return DEFAULT_E2E_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(
      `E2E_PORT is set to ${JSON.stringify(raw)}, which is not a port number`
    );
  return port;
}

export function e2eOrigin(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * The origin the specs run against, resolved once at import.
 *
 * Specs that need an absolute URL — a second browser context with JavaScript
 * disabled, or an `origin` header for the CSRF check — take it from here
 * rather than writing `localhost:3000`, so the port is stated in one place and
 * a spec cannot quietly drift onto a different server from the rest of the run.
 */
export const E2E_ORIGIN = e2eOrigin(e2ePort());

/** What the preflight concluded about whatever is listening. */
export type Preflight =
  /** Nothing answered. Playwright will start its own server. */
  | { state: "absent" }
  /** Answered, and it is the demo build the specs expect. */
  | { state: "demo" }
  /** Answered, but it is not the demo build. */
  | { state: "not-demo"; detail: string };

type HealthResponse = { status?: unknown; mode?: unknown };

/**
 * Ask the port what is listening on it.
 *
 * The split that matters is not "did it answer 200" but "is there a server at
 * all". If the connection is refused there is nothing there and Playwright
 * will start its own — that is the normal case. If a server answers anything
 * at all, `reuseExistingServer` will adopt it, so it has to be the demo build
 * or the run has to stop.
 *
 * That second branch is wider than it first looks. A live build with missing
 * credentials answers `500` rather than a JSON body, and treating that as
 * "nothing here" sends Playwright off to start a server on a port that is
 * already taken. So anything that answers and cannot be confirmed as the demo
 * build is refused, with what it actually said.
 *
 * `fetchImpl` is injectable so this is testable without a server; in CI it is
 * the platform `fetch`.
 */
export async function probeServer(
  origin: string,
  fetchImpl: (
    url: string
  ) => Promise<{ status: number; json: () => Promise<unknown> }> = fetch
): Promise<Preflight> {
  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(`${origin}/api/healthz`);
  } catch {
    // Nothing is listening. Playwright will start the demo server itself.
    return { state: "absent" };
  }
  // A response means a server, so from here on the question is only whether
  // it is the right one. A body that will not parse is an answer, not a
  // silence: it is a server that is not this app.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const health = (body ?? {}) as HealthResponse;
  if (health.mode === "demo") return { state: "demo" };
  return { state: "not-demo", detail: describeAnswer(response.status, body) };
}

/** What a server that is not the demo build actually said, for the message. */
function describeAnswer(status: number, body: unknown): string {
  const mode = (body as HealthResponse | undefined)?.mode;
  if (mode !== undefined) return `it reports mode ${JSON.stringify(mode)}`;
  if (status !== 200) return `it answered /api/healthz with HTTP ${status}`;
  // `JSON.stringify(undefined)` is `undefined`, not a string, so a body that
  // would not parse has to be shown as text rather than through it.
  const shown =
    body === undefined ? String(body) : JSON.stringify(body).slice(0, 120);
  return `it did not answer the health check as this app does (got ${shown})`;
}

/**
 * The message for a port that is not serving the demo build.
 *
 * The wording is the point of this module: it says what is wrong, where, and
 * the two things that will fix it. "Expect timed out" says none of those.
 */
export function preflightMessage(port: number, result: Preflight): string {
  const detail =
    result.state === "not-demo"
      ? ` ${result.detail.charAt(0).toUpperCase()}${result.detail.slice(1)};`
      : "";
  return (
    `port ${port} is serving a non-demo build; stop it or set E2E_PORT.${detail}\n` +
    `  The browser tests need the demo server (DEMO_MODE=true) on this port, and\n` +
    `  Playwright is configured to reuse whatever is already listening. Set\n` +
    `  E2E_PORT to a free port to run alongside it.`
  );
}

/** Fail the run with `preflightMessage` when the port is not the demo build. */
export async function assertDemoServer(
  port: number,
  fetchImpl?: (url: string) => Promise<{ json: () => Promise<unknown> }>
): Promise<void> {
  const result = await probeServer(
    e2eOrigin(port),
    fetchImpl as Parameters<typeof probeServer>[1]
  );
  if (result.state === "not-demo")
    throw new Error(preflightMessage(port, result));
}

/**
 * Playwright's `globalSetup` entry point.
 *
 * Runs before the web server is started, so at this point "absent" is the
 * expected answer and "demo" means a previous run left one behind that is
 * safe to reuse.
 */
export default async function globalSetup(): Promise<void> {
  await assertDemoServer(e2ePort());
}
