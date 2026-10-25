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
