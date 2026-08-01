// https://nuxt.com/docs/api/configuration/nuxt-config

import { resolveBuildInfo } from "./build-info";

// Force IPv4 for emulators to avoid Node 17+ IPv6 issues
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
const isLocal =
  !!process.env.VITEST ||
  process.env.USE_EMULATORS === "true" ||
  process.env.NODE_ENV === "development";
const useProdProject = process.env.USE_PROD_PROJECT === "true";
const ssr = process.env.SSR !== "false";
const buildInfo = resolveBuildInfo(isLocal);
console.log(
  "Nuxt Config - isLocal:",
  isLocal,
  "USE_EMULATORS:",
  process.env.USE_EMULATORS,
  "SSR:",
  ssr,
  "appEnv:",
  buildInfo.appEnv,
  "release:",
  buildInfo.release,
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
    tsConfig: {
      vueCompilerOptions: {
        plugins: [],
      },
    },
  },

  devtools: { enabled: true },

  ssr,

  components: [
    {
      path: "~/components",
      pathPrefix: true,
    },
  ],

  runtimeConfig: {
    public: {
      isLocal,
      // Reported by /api/health and attached to every Sentry event. Each field
      // is overridable at runtime as NUXT_PUBLIC_BUILD_INFO_*, so a backend can
      // correct its own label without a rebuild.
      buildInfo,
      sentry: {
        // Prod carries the traffic, so it samples; autopush carries almost
        // none, and there a full trace on every request is what makes a single
        // manual click worth looking at.
        tracesSampleRate: buildInfo.appEnv === "prod" ? 0.1 : 1.0,
        replaysSessionSampleRate: buildInfo.appEnv === "prod" ? 0.01 : 0.1,
      },
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
    "@nuxtjs/seo",
    "@nuxt/image",
    "@nuxtjs/plausible",
  ],

  site: {
    url: isLocal ? "http://localhost:3000" : "https://koryta.pl",
    name: "Koryta.pl",
    description: "Największy, niezależny agregator koryciarstwa",
    defaultLocale: "pl",
  },

  sitemap: {
    sources: ["/api/_sitemap-urls"],
  },

  // Without a `robots` key the module defaults to an empty `Disallow:`, i.e.
  // every route is crawlable - including the admin and auth surface, and the
  // query-string facets below, which render a fresh multi-megabyte response per
  // distinct combination.
  robots: {
    disallow: [
      "/admin",
      "/edit",
      "/login",
      "/cli-login",
      "/profil",
      "/leads",
      "/crawler",
      "/ekstrakcje",
      "/plik",
      // Renders nothing server-side (the whole template is <ClientOnly>), so it
      // has no indexable content to lose, and every entity URL 301s into it
      // with its own ?krs=/?teryt=. That is the bulk of the crawl budget.
      "/eksploruj/tabela",
      // The bare page stays indexable; only the facet permutations are barred.
      "/lista?",
    ],
  },
  plausible: {
    // Prevent tracking on localhost
    ignoredHostnames: ["localhost"],
  },

  eslint: {
    checker: true,
  },

  fonts: {
    families: [{ name: "Roboto", provider: "fontsource" }],
    defaults: {
      // The faces are self-hosted, so every declared weight x style x subset is
      // a file we serve. Nothing in the app reaches for thin/light/black -
      // the only weights used are body 400, font-weight-medium and
      // font-weight-bold, plus a couple of raw 550/600 that round to those.
      weights: [400, 500, 700],
      styles: ["normal", "italic"],
      subsets: ["latin", "latin-ext"],
    },
  },

  vuetify: {
    moduleOptions: {
      // Vuetify's auto-imported useLayout shadows the one Nuxt provides, and
      // nothing here needs those auto-imports: every call site imports the
      // composable it wants from "vuetify" by hand.
      importComposables: false,
    },
    vuetifyOptions: {
      icons: {
        defaultSet: "mdi-svg",
      },
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
    config: {
      apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
      authDomain:
        isLocal && !useProdProject
          ? "demo-koryta-pl.firebaseapp.com"
          : "koryta-pl.firebaseapp.com",
      projectId: isLocal && !useProdProject ? "demo-koryta-pl" : "koryta-pl",
      storageBucket:
        isLocal && !useProdProject
          ? undefined
          : "koryta-pl.firebasestorage.app",
      messagingSenderId:
        isLocal && !useProdProject ? undefined : "735903577811",
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

  ogImage: {
    defaults: {
      extension: "png",
    },
  },

  nitro: {
    preset: "firebase_app_hosting", // or 'firebase-functions'
    experimental: {
      asyncContext: true,
    },
  },
  routeRules: {
    "/": { swr: 3600 },
    "/admin/**": { ssr: false },

    // Nitro only injects a Cache-Control route rule for public assets mounted
    // under a sub-path (it zeroes maxAge for anything at the site root), so
    // these ship with no Cache-Control at all and Cloud CDN re-fetches them
    // from the container every single time - logo.png is 1.4 MB of that.
    // A week rather than `immutable`: the URLs are unhashed, so a replaced
    // file has to be able to propagate.
    "/logo.png": { headers: { "cache-control": "public, max-age=604800" } },
    "/logo_horizontal.png": {
      headers: { "cache-control": "public, max-age=604800" },
    },
    "/logo_small.png": {
      headers: { "cache-control": "public, max-age=604800" },
    },
    "/favicon.ico": { headers: { "cache-control": "public, max-age=604800" } },

    // ipx echoes the source file's maxAge, which is 60s, so every resized
    // image re-enters the container roughly once a minute per edge POP and
    // re-decodes a 5906x5906 source to do it.
    "/_ipx/**": { headers: { "cache-control": "public, max-age=604800" } },
  },
  devServer: {
    host: "127.0.0.1",
  },
  vite: {
    optimizeDeps: {
      include: [
        "@mdi/js",
        "@plausible-analytics/tracker",
        "@vue/devtools-core",
        "@vue/devtools-kit",
        "@vueuse/core",
        "v-network-graph",
        // The layout engine is a separate entry point, imported only once the
        // graph store loads. Discovering it mid-run restarts the optimizer,
        // which reloads every open page and drops the vite-node IPC with it.
        "v-network-graph/lib/force-layout",
        "vue3-apexcharts",
        "vuefire",
      ],
    },
  },
});
