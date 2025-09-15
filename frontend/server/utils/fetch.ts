import { destinationToNodeType, type Destination, type DestinationTypeMap, type Edge } from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

export async function fetchNodes<D extends Destination>(
  destination: D,
): Promise<Record<string, DestinationTypeMap[D]>> {
  const db = getFirestore();
  const path = destinationToNodeType[destination];
  const nodes = await db.collection("nodes").where("type", "==", path).get();
  return (
    Object.fromEntries(
      nodes.docs.map((doc) => [doc.id, doc.data() as DestinationTypeMap[D]]),
    ) || {}
  );
}

export async function fetchEdges(): Promise<Edge[]> {
  const db = getFirestore();
  const edges = (await db.collection("edges").get()).docs.map((doc) =>
    doc.data() as Edge,
  );
  return edges as unknown as Edge[] || [];
}

export async function fetchRTDB<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {}; // Ensure we always return an object
}

export async function fetchFirestore<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {}; // Ensure we always return an object
}

export async function setRTDB<T>(path: string, value: T): Promise<void> {
  const db = getDatabase();
  await db.ref(path).set(value);
}
