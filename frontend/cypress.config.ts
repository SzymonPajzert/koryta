
import { defineConfig } from "cypress";

export default defineConfig((_config) => ({
  e2e: {
    baseUrl: "http://localhost:3000",
    pageLoadTimeout: 10000,
    defaultCommandTimeout: 10000,
    setupNodeEvents(on, _config) {
      on("task", {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
    },
  },
}));
