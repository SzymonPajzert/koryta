import { isDev } from "@nuxt/test-utils";

// https://nuxt.com/docs/api/configuration/nuxt-config
const isTest = !!process.env.VITEST;
export default defineNuxtConfig({
  app: {
    head: {
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          charset: "utf-8",
        },
      ],
      htmlAttrs: {
        lang: "pl",
      },
      link: [],
      style: [],
      script: [],
      noscript: [],
    },
  },

  compatibilityDate: "2025-07-15",

  // TODO Enable strict
  typescript: {
    strict: false,
  },

  devtools: { enabled: true },

  // TODO enable SSR
  ssr: false,

  components: [
    {
      path: "~/components",
      pathPrefix: true,
    },
  ],

  routeRules: {
    "/": { prerender: true },
    // Cached for 6 hours
    "/api/*": { isr: 60 * 60 * 6 },
  },

  modules: [
    "@pinia/nuxt",
    "@nuxt/content", // TODO what do I need it for '@nuxt/icon',
    // TODO what do I need it for '@nuxt/image',
    // TODO what do I need it for '@nuxt/scripts',
    "@nuxt/test-utils",
    "@nuxt/fonts",
    "@nuxt/eslint",
    "nuxt-vuefire",
    "vuetify-nuxt-module",
    "@sentry/nuxt/module",
  ],

  fonts: {
    families: [{ name: "Roboto", provider: "fontsource" }],
    defaults: {
      weights: [100, 300, 400, 500, 700, 900],
      styles: ["normal", "italic"],
      subsets: ["latin"],
    },
  },

  vuetify: {
    vuetifyOptions: {
      theme: {
        defaultTheme: "dark",
        themes: {
          dark: {
            colors: {
              primary: "#a8c79f",
              secondary: "#fad3d0",
            },
          },
        },
      },
    },
  },

  vuefire: {
    auth: {
      enabled: true,
    },
    // TODO parametrize in the env, so I can pass autopush and local test config
    config: {
      apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
      authDomain: "koryta-pl.firebaseapp.com",
      databaseURL:
        "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "koryta-pl",
      storageBucket: "koryta-pl.firebasestorage.app",
      messagingSenderId: "735903577811",
      appId: "1:735903577811:web:53e6461c641b947a4e8626",
      measurementId: "G-KRYVKQ4T7T",
    },
    emulators: {
      enabled: isTest || isDev,
      auth: {
        host: "localhost",
        port: 9099,
      },
      database: {
        host: "localhost",
        port: 9000,
      },
      firestore: {
        host: "localhost",
        database: "koryta-pl",
        port: 8080,
      },
      storage: {
        host: "localhost",
        port: 9199,
      },
    },
  },

  css: ["v-network-graph/lib/style.css"],

  sentry: {
    sourceMapsUploadOptions: {
      org: "romb",
      project: "koryta-pl",
    },
  },

  sourcemap: {
    client: "hidden",
  },
});
