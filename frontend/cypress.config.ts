import { defineConfig } from "cypress";
import viteConfig from "./cypress/vite.config";

export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:3000",
    pageLoadTimeout: 10000,
    defaultCommandTimeout: 10000,
    allowCypressEnv: false,
    testIsolation: false,
    setupNodeEvents(on, _config) {
      on("task", {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
    },
  },

  component: {
    devServer: {
      framework: "vue",
      bundler: "vite",
      viteConfig: () => {
        return viteConfig;
      },
    },
  },
});
