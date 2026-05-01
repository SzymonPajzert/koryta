import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    environment: "nuxt",
    setupFiles: ["./tests/polyfill.ts", "./tests/setup.ts"],
    exclude: ["node_modules", "tests/integration/**"],
    coverage: {
      enabled: true,
    },
    server: {
      deps: {
        inline: ["vuefire", "nuxt-vuefire", "firebase"],
      },
    },
    alias: {
      "@plausible-analytics/tracker":
        "/Users/szymonpajzert/Programming/koryta/frontend/tests/plausible-mock.js",
    },
  },
});
