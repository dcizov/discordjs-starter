import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const execute = promisify(execFile);
const script = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docker/lavalink/healthcheck.sh"
);

/** Same behavioral fixture runs against local curl and the actual built image. */
export async function checkLavalinkHealth(image?: string) {
  const password = 'test-only-probe "quotes" \\ value';
  let status = 200,
    requests = 0,
    redirects = 0;
  let header: string | undefined;
  const server = createServer((request, response) => {
    requests++;
    if (request.url === "/redirect-target") {
      redirects++;
      response.writeHead(200).end();
      return;
    }
    header = request.headers.authorization;
    const code = header === password ? status : 401;
    if (code === 302) response.setHeader("Location", "/redirect-target");
    response.writeHead(code).end();
  });
  const listen = () =>
    new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(2333, "127.0.0.1", () => {
        server.off("error", fail);
        done();
      });
    });
  const close = () =>
    new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done()))
    );
  async function probe(secret?: string) {
    const env = {
      ...process.env,
      LAVALINK_SERVER_PASSWORD: secret,
      http_proxy: "http://127.0.0.1:1",
      HTTP_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "",
      no_proxy: "",
    };
    const program = image ? "docker" : "sh";
    const args = image
      ? [
          "run",
          "--rm",
          "--network",
          "host",
          "--entrypoint",
          "/opt/Lavalink/healthcheck/run",
          "-e",
          "LAVALINK_SERVER_PASSWORD",
          "-e",
          "http_proxy",
          "-e",
          "HTTP_PROXY",
          "-e",
          "ALL_PROXY",
          "-e",
          "NO_PROXY",
          "-e",
          "no_proxy",
          image,
        ]
      : [script];
    let code = 0,
      stdout = "",
      stderr = "";
    try {
      const result = await execute(program, args, {
        env,
        timeout: 10000,
        encoding: "utf8",
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      // A missing executable/Docker failure/timeout is a failed harness, not an
      // expected negative readiness result. Never turn it into a passing check.
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        typeof error.code !== "number" ||
        !("stdout" in error) ||
        typeof error.stdout !== "string" ||
        !("stderr" in error) ||
        typeof error.stderr !== "string"
      )
        throw error;
      code = error.code;
      stdout = error.stdout;
      stderr = error.stderr;
    }
    assert.equal(stdout, "", "probe stdout must be empty");
    assert.equal(
      stderr,
      "",
      "probe stderr must be empty, including auth/network failures"
    );
    assert.ok(
      code === 0 || code === 1,
      "probe must return only readiness status"
    );
    return code;
  }
  let checks = 0;
  await listen();
  try {
    for (const secret of [undefined, "", "test\rheader", "test\nheader"]) {
      assert.equal(await probe(secret), 1);
      checks++;
    }
    assert.equal(
      requests,
      0,
      "missing/line-break secrets must not send HTTP requests"
    );
    assert.equal(
      await probe(password),
      0,
      "authenticated 200 and proxy bypass"
    );
    checks++;
    assert.equal(header, password, "header bytes preserve quotes/backslash");
    assert.equal(
      await probe("test-only-wrong-password"),
      1,
      "authentication failure"
    );
    checks++;
    status = 503;
    assert.equal(await probe(password), 1, "HTTP unavailable");
    checks++;
    status = 302;
    assert.equal(await probe(password), 1, "redirect is not ready");
    checks++;
    assert.equal(redirects, 0, "must not follow redirects");
    status = 204;
    assert.equal(await probe(password), 1, "requires exact HTTP 200");
    checks++;
    await close();
    assert.equal(await probe(password), 1, "unavailable listener");
    checks++;
    status = 200;
    await listen();
    assert.equal(await probe(password), 0, "recovery after unavailable");
    checks++;
  } finally {
    if (server.listening) await close();
  }
  return checks;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const image = process.argv[2];
  if (!image)
    throw new Error(
      "Pass the CI-built Lavalink image name; no production container is used."
    );
  void checkLavalinkHealth(image)
    .then((checks) => {
      console.log(
        `::notice title=Authenticated HTTP health probe::${checks} real image-curl checks passed: auth, exact status, no redirects/proxy, secret-safe failures, refusal and recovery`
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
