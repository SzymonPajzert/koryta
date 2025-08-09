import { initializeApp, getApps } from "firebase-admin/app";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();

  // Make sure we're not re-initializing the app on every hot-reload
  if (getApps().length === 0) {
    // When deployed to production, firebase-admin will use Application Default Credentials.
    // For local development, you can set the GOOGLE_APPLICATION_CREDENTIALS
    // environment variable to point to your service account key file.
    // See: https://firebase.google.com/docs/admin/setup#initialize-sdk
    initializeApp({
      databaseURL: config.public.vuefire.config.databaseURL,
    });
  }
});
