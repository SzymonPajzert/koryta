import { initializeApp, getApps } from "firebase-admin/app";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();

  console.log("Setting up");

  // Make sure we're not re-initializing the app on every hot-reload
  if (getApps().length === 0) {
    // See: https://firebase.google.com/docs/admin/setup#initialize-sdk
    if (config.public.isLocal) {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
      process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    }

    console.log("Initializing Firebase:", {
      projectId: config.public.vuefire.config.projectId,
      databaseURL: config.public.vuefire.config.databaseURL,
      authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    });

    initializeApp({
      projectId: config.public.vuefire.config.projectId,
      databaseURL: config.public.vuefire.config.databaseURL,
    });
  }
});
