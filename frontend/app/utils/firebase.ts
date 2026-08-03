import { getFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, type Database } from "firebase/database";
import type { FirebaseApp } from "firebase/app";

// The client half of the "which data does this build talk to" question. Both
// read runtimeConfig rather than a constant, so the preview deployment can be
// pointed at the preview database with an environment variable and no rebuild.
// See shared/firebase-env.ts.
//
// Call these rather than reaching for getFirestore or useDatabase directly: a
// hardcoded database id in a preview deployment writes into production.

export function appFirestore(app?: FirebaseApp): Firestore {
  const { firestoreDatabase } = useRuntimeConfig().public;
  return getFirestore(app ?? useFirebaseApp(), firestoreDatabase);
}

/**
 * The `users` collection, which production keeps in the unnamed database.
 * Separate from appFirestore only because of that; see shared/firebase-env.ts.
 */
export function appUsersFirestore(app?: FirebaseApp): Firestore {
  const { usersDatabase } = useRuntimeConfig().public;
  return getFirestore(app ?? useFirebaseApp(), usersDatabase);
}

export function appDatabase(app?: FirebaseApp): Database {
  const { databaseURL } = useRuntimeConfig().public;
  return getDatabase(app ?? useFirebaseApp(), databaseURL);
}
