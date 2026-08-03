import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getDatabaseWithUrl, type Database } from "firebase-admin/database";

// The server half of app/utils/firebase.ts: the Firestore database id and the
// Realtime Database URL come from runtimeConfig, so a preview deployment reads
// and writes preview data. See shared/firebase-env.ts.
//
// Call these rather than reaching for getFirestore or getDatabase directly.
//
// Named apart from the client helpers rather than sharing appFirestore: both
// directories are auto-imported into the same scope under vitest's Nuxt
// environment, and a server handler that silently got the browser SDK fails
// somewhere far away from the cause.

export function adminFirestore(): Firestore {
  const { firestoreDatabase } = useRuntimeConfig().public;
  return getFirestore(firestoreDatabase);
}

export function adminDatabase(): Database {
  // The URL is on the app options too (set in plugins/firebase.server.ts), but
  // passing it explicitly keeps this honest if the app is initialised
  // elsewhere - the admin SDK's fallback is to throw, not to guess.
  const { databaseURL } = useRuntimeConfig().public;
  return getDatabaseWithUrl(databaseURL);
}
