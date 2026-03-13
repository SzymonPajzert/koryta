import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    environment: "nuxt",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["node_modules", "tests/integration/**"],
    coverage: {
      enabled: true,
    },
    server: {
      deps: {
        inline: ["vuefire", "nuxt-vuefire", "firebase"],
      },
    },
  },
});
