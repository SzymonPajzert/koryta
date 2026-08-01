import { defineConfig } from "vitest/config";

/** Firestore rules tests.
 *
 * Plain node, not the nuxt environment the other suites use: these talk to the
 * emulator over the wire and never load the app. They need a firestore
 * emulator around them, which `npm run test:rules` provides.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    // One emulator, one rules deployment, one shared datastore - parallel
    // files would clear each other's fixtures mid-test.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
