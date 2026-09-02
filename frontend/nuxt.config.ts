// https://nuxt.com/docs/api/configuration/nuxt-config
import { bundleSharpBinaries } from "./build/sharp-binaries";
import { themeColors } from "./shared/colors";

// Force IPv4 for emulators to avoid Node 17+ IPv6 issues
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const isLocal =
  !!process.env.VITEST ||
  process.env.USE_EMULATORS === "true" ||
  process.env.NODE_ENV === "development";
const useProdProject = process.env.USE_PROD_PROJECT === "true";
const ssr = process.env.SSR !== "false";
// Both the canonical url the SEO module advertises and the one the notification
// emails link to. They have to agree, or a message sent from the emulator walks
// the reader onto production.
const siteUrl = isLocal ? "http://localhost:3000" : "https://koryta.pl";
console.log(
  "Nuxt Config - isLocal:",
  isLocal,
  "USE_EMULATORS:",
  process.env.USE_EMULATORS,
  "SSR:",
  ssr,
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
    // The fast extractor for browser-captured pages (data/pipelines/src/service,
    // deployed to Cloud Run). Left "off" everywhere it is not configured — a
    // capture then stores its html and stops there, which is still enough for
    // the nightly pipeline to pick the page up out of the bucket.
    extractorDispatch: process.env.EXTRACTOR_DISPATCH || "off",
    extractorUrl: process.env.EXTRACTOR_URL || "",
    extractorQueue: process.env.EXTRACTOR_QUEUE || "article-extraction",
    extractorLocation: process.env.EXTRACTOR_LOCATION || "europe-central2",
    extractorServiceAccount: process.env.EXTRACTOR_SERVICE_ACCOUNT || "",
    gcpProject:
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "koryta-pl",
    public: {
      isLocal,
      /** The published extension's id, so `/rozszerzenie` knows who to hand a
       * token to. Empty until it is listed, which the page says out loud
       * rather than failing silently. */
      extensionId: process.env.NUXT_PUBLIC_EXTENSION_ID || "",
      siteUrl,
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
    url: siteUrl,
    name: "Koryta.pl",
    description: "Największy, niezależny agregator koryciarstwa",
    defaultLocale: "pl",
  },

  sitemap: {
    sources: ["/api/_sitemap-urls"],
  },

  seo: {
    // nuxt-seo-utils lowercases the canonical by default, which is fine for a
    // hand-written path and wrong for ours: an entity url ends in the Firestore
    // document id, and those are case sensitive. Every person page was
    // advertising a canonical and an og:url that render "Strona nieznaleziona",
    // so a shared link previewed as the not-found page and the real url was
    // never the one indexed.
    canonicalLowercase: false,
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
    ],
  },
  plausible: {
    // Prevent tracking on localhost
    ignoredHostnames: ["localhost"],

    // Send events to our own origin, which nitro forwards to plausible.io. The
    // tracker itself is already first-party - @nuxtjs/plausible bundles
    // @plausible-analytics/tracker rather than loading a remote script - so the
    // event endpoint was the only thing left for a blocklist to match, and the
    // audience is 69% mobile and Polish, where blocking is common. Every number
    // the dashboard has ever shown is a floor because of it.
    //
    // The cost is that each event becomes a request to the Cloud Run container
    // instead of to plausible.io. At 15k pageviews a quarter that is noise next
    // to what rendering a page costs, and the handler does no rendering.
    proxy: true,

    // Counts clicks that leave the site - the volunteer form, Patronite, the
    // Slack invite - as one "Outbound Link: Click" goal. The url is a property,
    // so on a Growth plan this cannot say *which* link, which is why the links
    // that matter also fire a named goal of their own (shared/analytics.ts).
    // Kept anyway: it is the only thing that sees the source links on an
    // article page, and those are not worth a goal each.
    autoOutboundTracking: true,
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
              // The ink and pale-surface tokens. primary and secondary are
              // pale fills - as text on a white card primary measures 1.85:1,
              // so `text-primary` was never readable - and shared/colors.ts
              // holds the dark companions that are, each measured against
              // every surface it can land on. Spread rather than listed so
              // the hexes have one home and the test that checks their
              // contrast is checking what Vuetify actually paints.
              ...themeColors,
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

  hooks: {
    // Wired as a hook rather than as a Nuxt module. A locally authored module -
    // scanned out of modules/ or named here, it makes no difference - lands in
    // the server transpile set along with everything else under the project
    // root, and firebase-admin is then transformed instead of externalised: its
    // named exports come back undefined and vuefire's ensureAdminApp throws
    // "getApps is not a function" on every server rendered page. See
    // build/sharp-binaries.ts for what this does and why.
    "nitro:init"(nitro) {
      bundleSharpBinaries(nitro);
    },
  },

  nitro: {
    preset: "firebase_app_hosting", // or 'firebase-functions'
    experimental: {
      asyncContext: true,
    },

    // Nothing between the browser and the container compresses: the Nitro
    // server does not, and the Envoy in front of it does not either, so
    // `_nuxt/*` went out raw - 741 KB for the entry chunk, 255 KB for the
    // stylesheet, ~2.2 MB per page view against an audience that is 69%
    // mobile. This emits `.gz`/`.br` siblings at build time, which the static
    // handler serves - with a `Vary: Accept-Encoding` of its own - to clients
    // that ask. Build-time rather than per-request because these are
    // immutable and hashed: pay the cost once, at the best ratio, not on
    // every cache miss. Rendered responses are the other half of this, in
    // server/plugins/compression.ts.
    compressPublicAssets: { gzip: true, brotli: true },
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
    // Fetched fresh by every platform a link is posted to, and by each of them
    // more than once.
    "/social-card.png": {
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
