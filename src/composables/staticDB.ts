import { app } from '@/stores/firebase';
import {ref as vueRef, type Ref} from 'vue';
import { getDatabase, ref, get, Database, DataSnapshot, onValue } from 'firebase/database';

// TODO it seems to me that DB refs should be shared outside of the use functions
// This way we'll be able to reuse this state.

/**
 * Reads data from the root of your non-default Firebase Realtime Database.
 * @returns A Promise that resolves with the data (categories and recommendations)
 *          or null if not found or an error occurs.
 */
export function useReadDB<T>(dbURL?: string) {
  const db: Database = getDatabase(app, dbURL);
  const dbRootRef = ref(db, '/');

  const stream = async function(dbURL?: string): Promise<T | null> {
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

  return {stream, watchPath}
}
