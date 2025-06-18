import { app } from '@/stores/firebase';
import {ref as vueRef, type Ref} from 'vue';
import { getDatabase, ref, get, Database, DataSnapshot, onValue, connectDatabaseEmulator, push} from 'firebase/database';

/**
 * Reads data from the root of your non-default Firebase Realtime Database.
 * @returns A Promise that resolves with the data (categories and recommendations)
 *          or null if not found or an error occurs.
 */
export function useReadDB<T>(dbURL?: string) {
  const db: Database = getDatabase(app, dbURL);
  if ((location.hostname === "localhost" || location.hostname == "127.0.0.1") && location.port === "5002") {
    connectDatabaseEmulator(db, "127.0.0.1", 9003);
  }

  const stream = async function(): Promise<T | null> {
    const dbRootRef = ref(db, '/');
    const snapshot: DataSnapshot = await get(dbRootRef);

    if (snapshot.exists()) {
      const data = snapshot.val() as T;
      return data;
    } else {
      console.log("No data available at the root of the custom database.");
      return null;
    }
  }

  const watchPath = function<A>(path: string): Ref<A | undefined> {
    const output = vueRef<A>();
    onValue(ref(db, path), (snapshot) => {
      if (snapshot.val()) {
        output.value = snapshot.val() as A;
      }
    });
    return output;
  }

  return {db, stream, watchPath}
}
