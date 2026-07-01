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
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });

    // Firestore
    const db = getFirestore(app, "koryta-pl");
    connectFirestoreEmulator(db, "127.0.0.1", 8080);

    // Functions
    const functions = getFunctions(app);
    const functionsEurope = getFunctions(app, "europe-west1");
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectFunctionsEmulator(functionsEurope, "127.0.0.1", 5001);

    // Storage
    const storage = getStorage(app);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
});
