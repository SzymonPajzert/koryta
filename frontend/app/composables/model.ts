import { ref as dbRef, push } from "firebase/database";
import type {
  Article,
  Company,
  Destination,
  DestinationTypeMap,
  Person,
} from "../../shared/model";
import { Link } from "../../shared/model";

export function useDBUtils() {
  const db = useDatabase();

  function newKey() {
    const newKey = push(dbRef(db, "_temp_keys/employments")).key;
    if (!newKey) {
      throw "Failed to create a key";
    }
    return newKey;
  }

  function recordOf<T>(value: T): Record<string, T> {
    const result: Record<string, T> = {};
    result[newKey()] = value;
    return result;
  }

  function fillBlanks<D extends Destination>(
    value: Partial<DestinationTypeMap[D]>,
    d: D,
  ): Required<DestinationTypeMap[D]>;
  function fillBlanks<D extends Destination>(
    valueUntyped: Partial<DestinationTypeMap[D]>,
    d: D,
  ) {
    if (d == "company") {
      const value = valueUntyped as Partial<Company>;
      const result: Required<DestinationTypeMap["company"]> = {
        name: value.name ?? "",
        krsNumber: value.krsNumber ?? "",
        nipNumber: value.nipNumber ?? "",
      };
      return result;
    }

    if (d == "employed") {
      const value = valueUntyped as Partial<Person>;
      const result: Required<DestinationTypeMap["employed"]> = {
        name: value.name ?? "",
        parties: value.parties ?? [],
      };
      return result;
    }

    if (d == "data") {
      const value = valueUntyped as Partial<Article>;
      const result: Required<DestinationTypeMap["data"]> = {
        name: value.name ?? "",
        sourceURL: value.sourceURL ?? "",
        shortName: value.shortName ?? "",
        estimates: value.estimates ?? { mentionedPeople: 0 },
      };
      return result;
    }

    throw new Error("Unknown destination type");
  }

  function removeBlanks<D extends Destination>(
    obj: DestinationTypeMap[D],
  ): DestinationTypeMap[D] {
    // Create a new object to avoid mutating the original
    const payload: unknown = {};

    for (const key in obj) {
      // Ensure the key belongs to the object and not its prototype chain
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key as keyof DestinationTypeMap[D]];

        if (value === null) continue;
        if (value === undefined) continue;
        if (value === "") continue;
        if (value instanceof Link) {
          if (value.id === "") continue;
        }
        if (value instanceof Object) {
          const entries = Object.entries(value);
          if (entries.length === 0) continue;
          if (entries.length === 1 && Array.isArray(entries[0])) {
            const [_, v] = entries[0];
            if (v instanceof Link) {
              if (v.id === "") continue;
            }
          }
        }

        if (value !== null && value !== undefined && value !== "") {
          payload[key] = value;
        }
      }
    }

    return payload as DestinationTypeMap[D];
  }

  return { newKey, recordOf, fillBlanks, removeBlanks };
}
