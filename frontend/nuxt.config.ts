// https://nuxt.com/docs/api/configuration/nuxt-config

// Force IPv4 for emulators to avoid Node 17+ IPv6 issues
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
const isLocal =
  !!process.env.VITEST ||
  process.env.USE_EMULATORS === "true" ||
  process.env.NODE_ENV === "development";
console.log(
  "Nuxt Config - isLocal:",
  isLocal,
  "USE_EMULATORS:",
  process.env.USE_EMULATORS,
);

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
      link: [
        { rel: "preconnect", href: "https://cdn.jsdelivr.net" },
        { rel: "preconnect", href: "https://firestore.googleapis.com" },
      ],
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

  ssr: true,

  components: [
    {
      path: "~/components",
      pathPrefix: true,
    },
  ],

  runtimeConfig: {
    public: {
      isLocal,
    },
  },

  modules: [
    "@pinia/nuxt",
    "@nuxt/content",
    "@nuxt/fonts",
    "@nuxt/eslint",
    "nuxt-vuefire",
    "vuetify-nuxt-module",
    "@sentry/nuxt/module",
    "@nuxt/test-utils/module",
    "@nuxtjs/sitemap",
    "@nuxtjs/robots",
    "@nuxt/image",
  ],

  site: {
    url: isLocal ? "http://localhost:3000" : "https://koryta.pl",
  },

  sitemap: {
    sources: ["/api/_sitemap-urls"],
  },

  eslint: {
    checker: true,
  },

  fonts: {
    families: [{ name: "Roboto", provider: "fontsource" }],
    defaults: {
      weights: [100, 300, 400, 500, 700, 900],
      styles: ["normal", "italic"],
      subsets: ["latin", "latin-ext"],
    },
  },

  vuetify: {
    vuetifyOptions: {
      theme: {
        defaultTheme: "light",
        themes: {
          light: {
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
    appCheck: {
      enabled: !isLocal,
    },
    // TODO parametrize in the env, so I can pass autopush and local test config
    config: {
      apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
      authDomain: isLocal
        ? "demo-koryta-pl.firebaseapp.com"
        : "koryta-pl.firebaseapp.com",
      projectId: isLocal ? "demo-koryta-pl" : "koryta-pl",
      storageBucket: isLocal ? undefined : "koryta-pl.firebasestorage.app",
      messagingSenderId: isLocal ? undefined : "735903577811",
      appId: "1:735903577811:web:53e6461c641b947a4e8626",
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
      firestore: {},
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

  nitro: {
    preset: "firebase_app_hosting", // or 'firebase-functions'
    experimental: {
      asyncContext: true,
    },
  },
  devServer: {
    host: "127.0.0.1",
  },
});
