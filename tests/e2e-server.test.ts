import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDemoServer,
  DEFAULT_E2E_PORT,
  e2eOrigin,
  e2ePort,
  preflightMessage,
  probeServer,
} from "../tests/e2e/support/e2e-server";

/*
 * What the preflight is for: a dev server on the e2e port is adopted silently
 * as the system under test, and every spec then fails as a hydration timeout
 * that names nothing. These tests stand up real servers on real ports, because
 * "the connection was refused" and "the answer was not JSON" are two of the
 * three outcomes and neither is reachable with a mock that always resolves.
 */

let server: Server | null = null;

/**
 * Serve a fixed body at `/api/healthz` on an ephemeral port.
 *
 * `raw` sends the string exactly as given, which is how a server that is not
 * this app answers; anything else is JSON-encoded.
 */
async function serve(
  body: unknown,
  options: { status?: number; contentType?: string; raw?: boolean } = {}
): Promise<number> {
  const payload = options.raw ? String(body) : JSON.stringify(body);
  server = createServer((_req, res) => {
    res.writeHead(options.status ?? 200, {
      "content-type": options.contentType ?? "application/json",
    });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null)
    throw new Error("no port");
  return address.port;
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("e2ePort", () => {
  it("defaults to a port nothing else uses", () => {
    // The whole point: 3000 is where `npm run dev` lives, and reusing it is
    // how a non-demo server became the system under test.
    expect(e2ePort({})).toBe(DEFAULT_E2E_PORT);
    expect(DEFAULT_E2E_PORT).not.toBe(3000);
  });

  it("takes the port from E2E_PORT when one is set", () => {
    expect(e2ePort({ E2E_PORT: "4321" })).toBe(4321);
  });

  it("ignores an empty E2E_PORT rather than reading it as NaN", () => {
    // `E2E_PORT=` is what you get from an exported-but-unset variable.
    expect(e2ePort({ E2E_PORT: "  " })).toBe(DEFAULT_E2E_PORT);
  });

  it("rejects a value that is not a port instead of silently using NaN", () => {
    expect(() => e2ePort({ E2E_PORT: "http://localhost" })).toThrow(
      /not a port number/
    );
    expect(() => e2ePort({ E2E_PORT: "0" })).toThrow(/not a port number/);
    expect(() => e2ePort({ E2E_PORT: "70000" })).toThrow(/not a port number/);
  });

  it("builds the origin from the port", () => {
    expect(e2eOrigin(4321)).toBe("http://localhost:4321");
  });
});

describe("probeServer", () => {
  it("reports nothing listening when the connection is refused", async () => {
    // The normal case: Playwright will start its own server.
    await expect(probeServer("http://127.0.0.1:1")).resolves.toEqual({
      state: "absent",
    });
  });

  it("rejects a server that answers but is not this app", async () => {
    // A stray static server or a proxy. It answered, so `reuseExistingServer`
    // would adopt it; that has to be refused, not reported as silence.
    const port = await serve("<html>not an api</html>", {
      contentType: "text/html",
      raw: true,
    });
    const result = await probeServer(`http://127.0.0.1:${port}`);
    expect(result.state).toBe("not-demo");
  });

  it("rejects a server that answers with an error rather than JSON", async () => {
    // Observed for real: a live build started without credentials answers
    // `500 Internal Server Error` at /api/healthz. Calling that "nothing is
    // listening" sends Playwright off to start a server on a port that is
    // already taken, which is the confusing failure this replaces.
    const port = await serve("Internal Server Error", {
      status: 500,
      contentType: "text/plain",
      raw: true,
    });
    const result = await probeServer(`http://127.0.0.1:${port}`);
    expect(result.state).toBe("not-demo");
    if (result.state === "not-demo")
      expect(result.detail).toContain("HTTP 500");
  });

  it("accepts the demo build", async () => {
    // A previous run left one behind; reusing it is safe and saves a start.
    const port = await serve({ status: "ok", mode: "demo" });
    await expect(probeServer(`http://127.0.0.1:${port}`)).resolves.toEqual({
      state: "demo",
    });
  });

  it("rejects a live build, and says which mode it found", async () => {
    // The case this module exists for: `npm run dev` against real data.
    const port = await serve({ status: "ok", mode: "live" });
    const result = await probeServer(`http://127.0.0.1:${port}`);
    expect(result.state).toBe("not-demo");
    if (result.state === "not-demo")
      expect(result.detail).toContain('mode "live"');
  });

  it("rejects a JSON answer that is not this app's health check", async () => {
    const port = await serve({ ok: true });
    const result = await probeServer(`http://127.0.0.1:${port}`);
    expect(result.state).toBe("not-demo");
  });
});

describe("preflightMessage", () => {
  it("names the port, the problem, and both remedies", () => {
    const message = preflightMessage(3100, {
      state: "not-demo",
      detail: 'it reports mode "live"',
    });
    expect(message).toContain("port 3100 is serving a non-demo build");
    expect(message).toContain("stop it or set E2E_PORT");
    expect(message).toContain('mode "live"');
  });

  it("uses the port it is given, not a hardcoded one", () => {
    // 3000 is the port this is about, but the message has to be true of
    // whatever port the run actually chose.
    expect(
      preflightMessage(4321, {
        state: "not-demo",
        detail: "it is something else",
      })
    ).toContain("port 4321");
  });
});

describe("assertDemoServer", () => {
  it("throws the message when the port holds a live build", async () => {
    const port = await serve({ status: "ok", mode: "live" });
    await expect(assertDemoServer(port)).rejects.toThrow(
      /port \d+ is serving a non-demo build; stop it or set E2E_PORT/
    );
  });

  it("does not throw when the port is free", async () => {
    await expect(assertDemoServer(1)).resolves.toBeUndefined();
  });
});
