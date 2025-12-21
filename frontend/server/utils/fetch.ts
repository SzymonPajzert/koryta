import type { NodeType, Edge, Person, Company, Article } from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  record: unknown;
}


export interface NodeFilters {
  interesting?: boolean;
  posted?: boolean;
  article?: boolean;
}

export interface FetchNodesOptions {
  isAuth?: boolean;
  nodeId?: string;
  filters?: NodeFilters;
}

export async function fetchNodes<N extends NodeType>(
  path: N,
  options: FetchNodesOptions = {},
): Promise<Record<string, nodeData[N]>> {
  const { isAuth = false, nodeId, filters } = options;
  const db = getFirestore("koryta-pl");
  let query: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("type", "==", path);

  if (filters?.interesting) {
    query = query.where("interesting", "==", true);
  }
  if (filters?.posted) {
    query = query.where("posted", "==", true);
  }
  if (filters?.article) {
    query = query.where("article", "==", true);
  }

  if (nodeId) {
    const docRef = db.collection("nodes").doc(nodeId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return {};
    if (docSnap.data()?.type !== path) return {};

    const nodesData = [
      { id: docSnap.id, ...docSnap.data() } as nodeData[N] & {
        id: string;
        revision_id?: string;
      },
    ];

    return { [nodeId]: nodesData[0] };
  }

  const nodes = await query.get();
  const nodesData = nodes.docs.map((doc) => {
    return { id: doc.id, ...doc.data() } as nodeData[N] & {
      id: string;
      revision_id?: string;
    };
  });

  return Object.fromEntries(nodesData.map((node) => [node.id, node]));
}

export async function fetchEdges(): Promise<Edge[]> {
  const db = getFirestore("koryta-pl");
  const edges = (await db.collection("edges").get()).docs.map(
    (doc) => doc.data() as Edge,
  );
  return (edges as unknown as Edge[]) || [];
}

export async function fetchRTDB<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {};
}

export async function fetchFirestore<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {};
}

export async function setRTDB<T>(path: string, value: T): Promise<void> {
  const db = getDatabase();
  await db.ref(path).set(value);
}
