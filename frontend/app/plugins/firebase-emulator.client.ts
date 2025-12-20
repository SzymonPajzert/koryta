import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  if (config.public.isLocal) {
    console.log("🔌 Manual Emulator Connection Plugin Init");
    const app = useFirebaseApp();
    
    // Auth
    const auth = getAuth(app);
    // connectAuthEmulator throws if already connected, but there is no public property to check.
    // However, usually this plugin runs once.
    try {
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        console.log("✅ Auth Emulator connected to http://127.0.0.1:9099");
    } catch (e) {
        // Warning: This can happen on HMR
        console.log("Auth emulator already connected or failed:", e);
    }

    // Firestore
    const db = getFirestore(app);
    const namedDb = getFirestore(app, "koryta-pl");
    try {
        connectFirestoreEmulator(db, "127.0.0.1", 8080);
        connectFirestoreEmulator(namedDb, "127.0.0.1", 8080);
        console.log("✅ Firestore Emulator connected to 127.0.0.1:8080 (default & koryta-pl)");
    } catch(e) { console.log("Firestore emulator already connected/failed", e); }

    // Functions
    const functions = getFunctions(app);
    try {
        connectFunctionsEmulator(functions, "127.0.0.1", 5001);
        console.log("✅ Functions Emulator connected to 127.0.0.1:5001");
    } catch(e) { console.log("Functions emulator already connected/failed", e); }
    
    // Storage
    const storage = getStorage(app);
    try {
        connectStorageEmulator(storage, "127.0.0.1", 9199);
        console.log("✅ Storage Emulator connected to 127.0.0.1:9199");
    } catch(e) { console.log("Storage emulator already connected/failed", e); }
  }
});
