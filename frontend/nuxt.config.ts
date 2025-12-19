// https://nuxt.com/docs/api/configuration/nuxt-config

// Force IPv4 for emulators to avoid Node 17+ IPv6 issues
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
const isLocal = !!process.env.VITEST || process.env.USE_EMULATORS === "true";

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

  typescript: {
    strict: true,
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
    "/api/**": isLocal ? undefined : { swr: 60 * 60 * 6 },
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
    analytics: {
      enabled: !isLocal,
    },
    appCheck: {
      enabled: !isLocal,
    },
    // TODO parametrize in the env, so I can pass autopush and local test config
    config: {
      apiKey: isLocal
        ? "fake-api-key"
        : "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
      authDomain: isLocal ? undefined : "koryta-pl.firebaseapp.com",
      databaseURL: isLocal
        ? "http://localhost:9000?ns=demo-koryta-pl"
        : "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: isLocal ? "demo-koryta-pl" : "koryta-pl",
      storageBucket: isLocal ? undefined : "koryta-pl.firebasestorage.app",
      messagingSenderId: isLocal ? undefined : "735903577811",
      appId: "1:735903577811:web:53e6461c641b947a4e8626",
      measurementId: isLocal ? undefined : "G-KRYVKQ4T7T",
    },
    emulators: {
      enabled: isLocal,
      auth: {
        host: "127.0.0.1",
        port: 9099,
      },
      functions: {
        host: "127.0.0.1",
        port: 5001,
      },
      firestore: {
        host: "127.0.0.1",
        port: 8080,
      },
      database: {
        host: "127.0.0.1",
        port: 9000,
      },
      storage: {
        host: "127.0.0.1",
        port: 9199,
      },
    },
    options: {
      firestore: {
        experimentalForceLongPolling: true,
      },
    },
  },

  css: ["v-network-graph/lib/style.css"],

  sentry: {
    sourceMapsUploadOptions: {
      org: "romb",
      project: "koryta-pl",
    },
    telemetry: !isLocal,
  },

  sourcemap: {
    client: "hidden",
  },
});
