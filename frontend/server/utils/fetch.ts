import type { NodeType, Edge, Person, Company, Article } from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  record: unknown;
}

interface QueryParams extends Record<string, unknown> {
  party?: string;
  place?: string;
  id?: string;
}

export async function fetchNodes<N extends NodeType>(
  path: N,
  query?: QueryParams,
): Promise<Record<string, nodeData[N]>> {
  const db = getFirestore("koryta-pl");
  let q = db.collection("nodes").where("type", "==", path);
  if (query?.id) {
    q = q.where("id", "==", query.id);
    delete query.id;
  }
  if (query?.party) {
    q = q.where("parties", "array-contains", query.party);
    delete query.party;
  }

  // TODO filter by place somehow

  for (const [key] of Object.entries(query ?? {})) {
    throw new Error("Unknown filter: " + key);
    // q = q.where(key, "==", value);
  }
  console.debug(q);
  const nodes = await q.get();
  return (
    Object.fromEntries(
      nodes.docs.map((doc) => [doc.id, doc.data() as nodeData[N]]),
    ) || {}
  );
}

export async function fetchEdges(): Promise<Edge[]> {
  const db = getFirestore("koryta-pl");
  const edges = (await db.collection("edges").get()).docs.map(
    (doc) => doc.data() as Edge,
  );
  return (edges as unknown as Edge[]) || [];
}

export async function fetchFirestore<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {}; // Ensure we always return an object
}
