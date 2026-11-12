import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { e2eOrigin, e2ePort } from "./tests/e2e/support/e2e-server";

/*
 * The e2e server gets its own port.
 *
 * `reuseExistingServer` is on outside CI, which is worth keeping — it saves a
 * server start on every run — but on the shared port 3000 it meant a dev
 * server against real data was silently adopted as the system under test.
 * Everything then failed as a hydration timeout on demo fixtures, with nothing
 * in the output that pointed at the server. See `e2e-server.ts` for the
 * preflight that now refuses to run against the wrong build.
 */
const PORT = e2ePort();
const ORIGIN = e2eOrigin(PORT);

/**
 * The specs that run in more than one engine.
 *
 * Firefox is a second engine, not a second chance: a layout bug that only
 * shows up there is still a bug, so these run in both and a failure in either
 * fails the job. The list is the smoke set — the surfaces most likely to break
 * differently between engines (tables and their scrolling, popovers, hydration)
 * rather than the whole suite, which would double the run for little gain.
 */
const SMOKE_SPECS = [
  "tables",
  "tables-mobile",
  "members",
  "dashboard",
  "accessibility",
  "hydration",
  "leveling",
  "templates",
];

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/e2e-server.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  /*
   * A test that fails and then passes on retry is a broken test, not a pass.
   *
   * The retry exists so a CI run reports every failing spec in one go instead
   * of stopping at the first, which is worth keeping — but reporting the run as
   * green because the second attempt happened to succeed hid an intermittent
   * product defect for as long as the retry was enabled. A row menu that
   * unmounted itself mid-interaction depended on when a background refresh
   * landed, so it passed on CI and failed on a real machine.
   *
   * With this set, a retried pass still prints the diagnostic but fails the
   * job. The retry keeps its value as a diagnostic; it loses its ability to
   * rubber-stamp a flaky test.
   */
  failOnFlakyTests: true,
  // Keep failures readable through the Checks API when the log-download CDN
  // is unavailable to a restricted development environment.
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The dashboard introduction is shown once per person. Browser tests start
    // from an established workspace so they exercise its features; the
    // first-visit experience has its own spec with an empty storage state.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: ORIGIN,
          localStorage: [
            {
              name: "orbit:tour:v1:120000000000000099",
              value: '{"version":1,"outcome":"finished"}',
            },
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? {
              executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
              args: [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--no-zygote",
                // The restricted custom headless build can block natively for
                // six seconds on software-GPU dialog/screencast updates. The
                // app uses no WebGL; keep this fallback CPU-only, not a longer
                // test timeout.
                "--disable-gpu",
              ],
            }
          : {},
      },
    },
    {
      name: "firefox",
      testMatch: SMOKE_SPECS.map((name) => `**/${name}.spec.ts`),
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    // `start:e2e` is `next start` without a hardcoded `--port`, so it takes
    // the port from the environment as Next does by default. `npm start` pins
    // 3000, which is exactly the collision this avoids.
    command: "npm run start:e2e",
    url: `${ORIGIN}/api/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
    env: {
      PORT: String(PORT),
      DEMO_MODE: "true",
      DEMO_DATA_PATH: resolve(".data/e2e.json"),
      TZ: "UTC",
    },
  },
});
