import {ref as vueRef, type Ref} from 'vue';
import { ref, get, DataSnapshot, onValue } from 'firebase/database';
import { db } from '@/firebase';

/**
 * Reads data from the root of your non-default Firebase Realtime Database.
 * @returns A Promise that resolves with the data (categories and recommendations)
 *          or null if not found or an error occurs.
 */
export function useReadDB<T>() {
  // TODO rename stream, to allDataSnapshot
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
