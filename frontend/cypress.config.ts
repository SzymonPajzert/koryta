import { defineConfig } from "cypress";
import { addMatchImageSnapshotPlugin } from "@simonsmith/cypress-image-snapshot/plugin";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    setupNodeEvents(on, config) {
      addMatchImageSnapshotPlugin(on);
      on('task', {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
    },
  },
});
