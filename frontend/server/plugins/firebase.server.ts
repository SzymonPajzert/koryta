import { initializeApp, getApps } from "firebase-admin/app";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();

  console.log("Setting up")

  // Make sure we're not re-initializing the app on every hot-reload
  if (getApps().length === 0) {
    // When deployed to production, firebase-admin will use Application Default Credentials.
    // For local development, you can set the GOOGLE_APPLICATION_CREDENTIALS
    // environment variable to point to your service account key file.
    // See: https://firebase.google.com/docs/admin/setup#initialize-sdk
    if (process.env.USE_EMULATORS === "true") {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
    }

    console.log("Initializing Firebase:", {
      projectId: config.public.vuefire.config.projectId,
      databaseURL: config.public.vuefire.config.databaseURL,
    })

    initializeApp({
      projectId: config.public.vuefire.config.projectId,
      databaseURL: config.public.vuefire.config.databaseURL,
    });
  }

  console.log(getApps()[0].options)
});
