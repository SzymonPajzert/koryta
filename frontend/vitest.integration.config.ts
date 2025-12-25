import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    environment: "nuxt",
    setupFiles: ["./tests/setup.integration.ts"],
    // Ensure we don't pick up unit tests setup
    include: [
      "tests/integration/**/*.{test,spec}.ts",
      "tests/components/**/*.{test,spec}.integration.ts",
    ],
  },
});
