import { firestore } from "firebase-functions";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
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

      // TODO disable it, so we have nice nested names
      pathPrefix: false,
    },
  ],

  hooks: {
    "pages:extend"(pages) {
      // This is a hot fix so the pages for (zobacz) don't overwrite index.
      // We're removing the (zobacz) page but its children are kept.
      const zobaczIndex = pages.findIndex((page) => page.name === "");
      pages.splice(zobaczIndex, 1);
    },
  },

  modules: [
    "@pinia/nuxt",
    '@nuxt/content',
    // TODO what do I need it for '@nuxt/icon',
    // TODO what do I need it for '@nuxt/image',
    // TODO what do I need it for '@nuxt/scripts',
    // TODO what do I need it for '@nuxt/test-utils'
    "@nuxt/fonts",
    "@nuxt/eslint",
    "nuxt-vuefire",
    "vuetify-nuxt-module",
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
      databaseURL: "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "koryta-pl",
      storageBucket: "koryta-pl.firebasestorage.app",
      messagingSenderId: "735903577811",
      appId: "1:735903577811:web:53e6461c641b947a4e8626",
      measurementId: "G-KRYVKQ4T7T"
    },
    services: {
      firestore: {
        databaseId: "koryta-pl",
      },
    },
    firestore: {
      databaseId: "koryta-pl",
    },
  },

  css: ["v-network-graph/lib/style.css"],
});
