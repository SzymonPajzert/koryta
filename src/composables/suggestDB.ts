// A set of utils to submit to DB a user specified suggestion
import { ref as dbRef, push } from "firebase/database";
import { db } from "@/firebase";

export interface Textable {
  text: string;
}

// TODO remove this I think
export function useSuggestDB() {
  function newKey() {
    const newKey = push(dbRef(db, "_temp_keys/employments")).key;
    if (!newKey) {
      throw "Failed to create a key";
    }
    return newKey;
  }

  function arrayToKeysMap(array: Textable[]): Record<string, Textable> {
    const map: Record<string, Textable> = {};
    array.forEach((elt) => {
      if (elt.text.trim() !== "") {
        map[newKey()] = elt;
      }
    });
    return map;
  }

  return { arrayToKeysMap, newKey };
}
