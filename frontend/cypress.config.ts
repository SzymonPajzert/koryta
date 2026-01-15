import { defineConfig } from "cypress";
import { addMatchImageSnapshotPlugin } from "@simonsmith/cypress-image-snapshot/plugin";

export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:3000",
    pageLoadTimeout: 10000,
    defaultCommandTimeout: 10000,
    setupNodeEvents(on, config) {
      on("task", {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
      addMatchImageSnapshotPlugin(on, config);
    },
  },
});
