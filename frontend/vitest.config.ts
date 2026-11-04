import { defineVitestConfig } from "@nuxt/test-utils/config";
import { fileURLToPath } from "node:url";

export default defineVitestConfig({
  // `functions/` installs its own dependencies, so `firebase-functions` is on
  // disk twice - 7.3.2 here and 7.3.0 under functions/node_modules - and a
  // module imported by `functions/src/*.ts` resolved to the copy beside it.
  // `vi.mock("firebase-functions/v2/firestore")` in a test under tests/
  // resolves to the one here, so the two ids never met and the mock was
  // silently not applied: the real `onDocumentWritten` wrapped the handler
  // and refused the plain object the test hands it ("Cannot determine payload
  // type"). Deduping makes both sides one module, which is also what the
  // deployed function gets - there is only ever one copy in its bundle.
  resolve: { dedupe: ["firebase-functions"] },
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
