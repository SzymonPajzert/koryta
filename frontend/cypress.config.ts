import { defineConfig } from "cypress";

export default defineConfig({
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

  component: {
    devServer: {
      framework: "vue",
      bundler: "vite",
      viteConfig: async () => {
        const config = await import("./cypress/vite.config");
        return config.default;
      },
    },
  },
});
