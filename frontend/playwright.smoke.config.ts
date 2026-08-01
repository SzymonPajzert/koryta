import { defineConfig, devices } from "@playwright/test";

/** Smoke checks against a deployed backend.
 *
 * Everything else in this repo tests a Nuxt server this machine just started,
 * against an emulator holding seeded data. That leaves the artifact we
 * actually ship untested: the App Hosting build, its environment, the Cloud
 * Run runtime, SSR against the real database, and the shape of real
 * documents. This config is the one that points at a URL somebody could visit.
 *
 * No webServer and no globalSetup - the target is already built and running,
 * so there is no vite compile to warm. Give it a real base URL:
 *
 *   SMOKE_BASE_URL=https://autopush--koryta-pl.europe-west4.hosted.app \
 *     npm run test:smoke
 */
const baseURL = process.env.SMOKE_BASE_URL;

if (!baseURL) {
  throw new Error(
    "SMOKE_BASE_URL is required - the smoke suite only runs against a deployed backend",
  );
}

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Real networks blip, and a backend at minInstances 0 can be cold. A flake
  // that fails a deploy gate teaches people to ignore the gate.
  retries: 2,
  workers: 4,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    // A cold Cloud Run instance spends its first seconds booting Nitro.
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
