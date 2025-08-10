import type { Destination, DestinationTypeMap } from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";

export async function fetchEntity<D extends Destination>(
  path: D,
): Promise<Record<string, DestinationTypeMap[D]>> {
  return fetchRTDB(path);
}

export async function fetchRTDB<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {}; // Ensure we always return an object
}

export async function setRTDB<T>(path: string, value: T): Promise<void> {
  const db = getDatabase();
  await db.ref(path).set(value);
}
