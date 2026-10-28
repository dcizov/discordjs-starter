import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./tests/e2e",
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
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    // The dashboard introduction is shown once per person. Browser tests start
    // from an established workspace so they exercise its features; the
    // first-visit experience has its own spec with an empty storage state.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3000",
          localStorage: [
            {
              name: "orbit:tour:v1:120000000000000099",
              value: '{"version":1,"outcome":"finished"}',
            },
          ],
        },
      ],
    },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--no-zygote",
            // The restricted custom headless build can block natively for six
            // seconds on software-GPU dialog/screencast updates. The app uses
            // no WebGL; keep this fallback CPU-only, not a longer test timeout.
            "--disable-gpu",
          ],
        }
      : {},
  },
  webServer: {
    command: "npm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
    env: {
      DEMO_MODE: "true",
      DEMO_DATA_PATH: resolve(".data/e2e.json"),
      TZ: "UTC",
    },
  },
});
