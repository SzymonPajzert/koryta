import { defineVitestConfig } from "@nuxt/test-utils/config";
import { fileURLToPath } from "node:url";

export default defineVitestConfig({
  test: {
    environment: "nuxt",
    setupFiles: ["./tests/polyfill.ts", "./tests/setup.ts"],
    exclude: [
      "node_modules",
      "functions/node_modules",
      "tests/integration/**",
      "tests/e2e/**",
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
