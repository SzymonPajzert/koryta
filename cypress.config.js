import { defineConfig } from "cypress";
import { addMatchImageSnapshotPlugin } from "@simonsmith/cypress-image-snapshot/plugin";

export default defineConfig({
  projectId: "qdx58x",
  e2e: {
    setupNodeEvents(on) {
      addMatchImageSnapshotPlugin(on);
    },
    baseUrl: "http://localhost:5002",
  },
});
