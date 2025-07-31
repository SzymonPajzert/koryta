// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    // TODO what do I need it for '@nuxt/content',
    // TODO what do I need it for '@nuxt/icon',
    // TODO what do I need it for '@nuxt/image',
    // TODO what do I need it for '@nuxt/scripts',
    // TODO what do I need it for '@nuxt/test-utils'
    '@nuxt/eslint',
    'nuxt-vuefire'
  ],

  vuefire: {
    auth: {
      enabled: true
    },
    config: {
      apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
      authDomain: "koryta-pl.firebaseapp.com",
      databaseURL:
        "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "koryta-pl",
      storageBucket: "koryta-pl.firebasestorage.app",
      messagingSenderId: "735903577811",
      appId: "1:735903577811:web:6862ab6d2e0a46fa4e8626",
      measurementId: "G-PL6L1B0CZY",
    }
  }
})
