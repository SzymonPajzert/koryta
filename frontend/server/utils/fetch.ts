import {
  type NodeType,
  type Edge,
  type Person,
  type Company,
  type Article,
  pageIsPublic,
} from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  record: unknown;
}

export interface FetchNodesOptions {
  isAuth?: boolean;
  nodeId?: string;
}

export async function fetchNodes<N extends NodeType>(
  path: N,
  options: FetchNodesOptions = {},
): Promise<Record<string, nodeData[N]>> {
  const { isAuth = false, nodeId } = options;
  const db = getFirestore("koryta-pl");
  const query: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("type", "==", path);

  if (nodeId) {
    const docRef = db.collection("nodes").doc(nodeId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return {};
    if (docSnap.data()?.type !== path) return {};

    const nodeData = { id: docSnap.id, ...docSnap.data() } as nodeData[N] & {
      id: string;
      revision_id?: string;
    };

    return { [nodeId]: nodeData };
  }

  const nodes = await query.get();
  const nodesData = nodes.docs
    .map((doc) => {
      return { id: doc.id, ...doc.data() } as nodeData[N] & {
        id: string;
        revision_id?: string;
      };
    })
    .filter((node) => {
      // Visibility filtering:
      if (isAuth) return true;
      return pageIsPublic(node);
    });

  return Object.fromEntries(nodesData.map((node) => [node.id, node]));
}

export async function fetchEdges(
  options: { isAuth?: boolean } = {},
): Promise<Edge[]> {
  const { isAuth = false } = options;
  const db = getFirestore("koryta-pl");
  const edges = (await db.collection("edges").get()).docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        content: data.content || data.text || "",
      } as Edge;
    })
    .filter((edge) => {
      if (isAuth) return true;
      return pageIsPublic(edge);
    });
  return edges as unknown as Edge[];
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
