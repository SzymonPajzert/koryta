import type { NodeType, Edge, Person, Company, Article } from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  record: unknown;
}

export async function fetchNodes<N extends NodeType>(
  path: N,
  filters: NodeFilters = {},
  isAuth: boolean = false,
): Promise<Record<string, nodeData[N]>> {
  const db = getFirestore("koryta-pl");
  const nodes = await db.collection("nodes").where("type", "==", path).get();
  const nodesData = nodes.docs.map((doc) => {
    return { id: doc.id, ...doc.data() } as nodeData[N] & {
      id: string;
      revision_id?: string;
    };
  });

  const nodeIds = nodesData.map((n) => n.id);
  const revisions: Record<string, any> = {};

  console.log(`fetchNodes: isAuth=${isAuth}, nodeIds=${nodeIds.length}`);

  if (isAuth && nodeIds.length > 0) {
    // For logged in users, find the latest revision for each node
    // Firestore doesn't support "latest per group" easily in one query without custom indexing or client-side processing
    // fetching all revisions for these nodes might be heavy if many revisions, but for now assuming reasonable count.
    // Better approach: fetch all revisions matching nodeId 'in' ... (limit 30)
    // If > 30 nodes, we need batching.

    const chunks = [];
    for (let i = 0; i < nodeIds.length; i += 30) {
      chunks.push(nodeIds.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      if (chunk.length === 0) continue;

      const revsQuery = await db
        .collection("revisions")
        .where("nodeId", "in", chunk)
        // We want to sort by update_time desc to get latest easily,
        // but purely client side filtering is safer for simple index requirements.
        .get();

      revsQuery.docs.forEach((doc) => {
        const data = doc.data();
        const nodeId = data.nodeId;
        const currentBest = revisions[nodeId];

        if (
          !currentBest ||
          new Date(data.update_time) > new Date(currentBest.update_time)
        ) {
          revisions[nodeId] = { id: doc.id, ...data };
        }
      });
    }
  } else {
    // For anonymous, rely on the explicitly linked revision_id
    const revisionIds = nodesData
      .map((n) => n.revision_id)
      .filter(Boolean) as string[];

    if (revisionIds.length > 0) {
      // Unlikely to exceed 30 in typical view? We should batch here too properly.
      const chunks = [];
      for (let i = 0; i < revisionIds.length; i += 30) {
        chunks.push(revisionIds.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        if (chunk.length === 0) continue;
        const refs = chunk.map((id) => db.collection("revisions").doc(id));
        const snapshots = await db.getAll(...refs);
        snapshots.forEach((snap) => {
          if (snap.exists) revisions[snap.id] = snap.data();
        });
      }
    }
  }

  return (
    Object.fromEntries(
      nodesData.map((node) => {
        let revStr: any = null;

        if (isAuth) {
          // Revisions keyed by nodeId for auth users
          revStr = revisions[node.id];
        } else {
          // Revisions keyed by revisionId for anon users
          if (node.revision_id) revStr = revisions[node.revision_id];
        }

        if (revStr) {
          const revData = revStr.data || {};
          return [node.id, { ...node, ...revData } as nodeData[N]];
        }
        return [node.id, node as nodeData[N]];
      }),
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
