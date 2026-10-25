import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
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
