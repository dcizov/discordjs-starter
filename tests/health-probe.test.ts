import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { checkLavalinkHealth } from "./integration/lavalink-health";

// Supplemental local check. Docker-only dev images need not install curl just
// for this test; CI always runs the mandatory harness with the real audio image.
const hasCurl =
  process.platform !== "win32" &&
  spawnSync("sh", ["-c", "command -v curl"], { stdio: "ignore" }).status === 0;
it.skipIf(!hasCurl)(
  "the real HTTP probe rejects auth/status/header failures and recovers without credential output",
  async () => {
    expect(await checkLavalinkHealth()).toBe(11);
  }
);

it("runs the CI fixture/help with native Node TypeScript, without an app loader or Docker", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "tests/integration/lavalink-health.ts",
      "--help",
    ],
    { encoding: "utf8" }
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    "loopback fixtures only, no app dependencies"
  );
});
