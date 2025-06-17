// A set of utils to submit to DB a user specified suggestion
import { useReadDB } from '@/composables/staticDB'
import { ref as dbRef, push } from 'firebase/database';

export interface Textable {
  text: string;
}

export function useSuggestDB() {
  const { db } = useReadDB();

  function arrayToKeysMap(array: Textable[]) : Record<string, Textable> {
    const map: Record<string, Textable> = {};
    array.forEach((elt) => {
      if (elt.text.trim() !== '') {
        const newKey = push(dbRef(db, '_temp_keys/employments')).key;
        if (!newKey) {
          throw "Failed to create a key"
        }
        map[newKey] = elt;
      }
    });
    return map;
  }

  return { arrayToKeysMap }
}
