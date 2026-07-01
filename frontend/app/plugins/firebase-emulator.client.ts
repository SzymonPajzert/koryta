import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

export default defineNuxtPlugin((_nuxtApp) => {
  const config = useRuntimeConfig();

  if (config.public.isLocal) {
    const app = useFirebaseApp();

    // Auth
    const auth = getAuth(app);
    // connectAuthEmulator throws if already connected, but there is no public property to check.
    // However, usually this plugin runs once.
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
    } catch {
      // Warning: This can happen on HMR
    }

    // Firestore
    const db = getFirestore(app, "koryta-pl");
    try {
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    } catch {
      // ignore
    }

    // Functions
    const functions = getFunctions(app);
    const functionsEurope = getFunctions(app, "europe-west1");
    try {
      connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      connectFunctionsEmulator(functionsEurope, "127.0.0.1", 5001);
    } catch {
      // ignore
    }

    // Storage
    const storage = getStorage(app);
    try {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
    } catch {
      // ignore
    }
  }
});
