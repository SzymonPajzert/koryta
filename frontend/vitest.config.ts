import { defineVitestConfig } from "@nuxt/test-utils/config";
import { fileURLToPath } from "node:url";

export default defineVitestConfig({
  test: {
    environment: "nuxt",
    // Booting the Nuxt environment costs well over vitest's 10s default; the
    // suites that only skip tests still pay for it in beforeAll.
    hookTimeout: 60_000,
    // The test bodies here are milliseconds of work each — auth.test.ts runs in
    // 7ms — sitting behind seconds of Nuxt environment per file. What trips
    // vitest's 5s default is not slow test code but the machine stalling, so a
    // failure says nothing about the test. Raised to match hookTimeout, on the
    // same reasoning: a genuine hang is still caught, just reported later.
    testTimeout: 60_000,
    setupFiles: ["./tests/polyfill.ts", "./tests/setup.ts"],
    exclude: [
      "node_modules",
      "functions/node_modules",
      "tests/integration/**",
      "tests/e2e/**",
      // Playwright specs, and they need a deployed backend to point at.
      "tests/smoke/**",
      // Needs a firestore emulator; see vitest.rules.config.ts.
      "tests/rules/**",
      "tests/visual/**",
    ],
    coverage: {
      enabled: true,
    },
    server: {
      deps: {
        inline: ["vuefire", "nuxt-vuefire", "firebase"],
      },
    },
    alias: {
      "@plausible-analytics/tracker": fileURLToPath(
        new URL("./tests/plausible-mock.js", import.meta.url),
      ),
    },
  },
});
