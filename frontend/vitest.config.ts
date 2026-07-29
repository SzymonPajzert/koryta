import { defineVitestConfig } from "@nuxt/test-utils/config";
import { fileURLToPath } from "node:url";

export default defineVitestConfig({
  test: {
    environment: "nuxt",
    // Booting the Nuxt environment costs well over vitest's 10s default; the
    // suites that only skip tests still pay for it in beforeAll.
    hookTimeout: 60_000,
    setupFiles: ["./tests/polyfill.ts", "./tests/setup.ts"],
    exclude: [
      "node_modules",
      "functions/node_modules",
      "tests/integration/**",
      "tests/e2e/**",
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
