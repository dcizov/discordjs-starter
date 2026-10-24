// CI-only, read-only checks inside the opened Dev Container. No Discord login.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { setTimeout } from "node:timers/promises";

assert.equal(process.env.DEMO_MODE, "true", "Smoke checks require demo mode");
assert.equal(
  process.getuid(),
  1000,
  "Workspace must keep the shared-volume UID"
);
for (const path of ["/app", "/app/apps/web", "/app/node_modules"])
  accessSync(path, constants.R_OK | constants.W_OK);
execFileSync("git", ["status", "--porcelain"], { cwd: "/app" });
assert.ok(process.env.DATABASE_URL?.includes("@postgres:5432/"));
assert.equal(process.env.REDIS_URL, "redis://redis:6379");
assert.equal(process.env.LAVALINK_URL, "lavalink:2333");

let lastError;
let ready = false;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://web:3000/api/healthz", {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", mode: "demo" });
    ready = true;
    break;
  } catch (error) {
    lastError = error;
    await setTimeout(1_000);
  }
}
assert.ok(ready, `Dashboard did not become ready: ${lastError?.message}`);
const page = await fetch("http://web:3000/", {
  signal: AbortSignal.timeout(60_000),
});
assert.equal(page.status, 200);
assert.match(await page.text(), /Orbit/);
console.log(
  "Workspace permissions, Git, internal addresses and dashboard HTTP: PASS"
);
