import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests",
  // Compiles the dev server's routes before the first test, so no spec spends
  // its timeout waiting for vite. See tests/e2e/global-setup.ts.
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  // Baselines are Linux-only (generated on the same OS as CI); the {platform}
  // segment keeps runs on other OSes from overwriting them.
  snapshotPathTemplate:
    "{testDir}/visual/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: process.env.PLAYWRIGHT_SERVER_COMMAND || "npm run dev:local",
    url: baseURL,
    // Visual runs opt out of reuse: silently screenshotting whatever already
    // listens on the port (another worktree's dev server, say) produces
    // baselines that have nothing to do with the checkout under test.
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_NO_REUSE,
    // dev:build starts the emulators, runs a full production build, seeds and
    // then serves — comfortably past the 120s default, more so on cold CI.
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      testMatch: "e2e/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual-desktop",
      testMatch: "visual/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "visual-mobile",
      testMatch: "visual/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
      },
    },
  ],
});
