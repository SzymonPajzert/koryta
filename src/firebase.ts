import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";
export function isTest() {
  return (
    useEmulators ||
    location.hostname === "localhost" ||
    location.hostname == "127.0.0.1"
  );
}

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, "europe-west1");

if (isTest()) {
  connectDatabaseEmulator(db, "127.0.0.1", 9003);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
