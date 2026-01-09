import type { Edge } from "~~/shared/model";
import { getFirestore } from "firebase-admin/firestore";
import { getRevisionsForNodes } from "~~/server/utils/revisions";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async () => {
  const db = getFirestore("koryta-pl");
  const query: FirebaseFirestore.Query = db
    .collection("edges")
    .where("revision_id", "==", null)
    .limit(50);
  const edges = await query.get();
  const edgesData = edges.docs.map((doc) => {
    return { id: doc.id, ...doc.data() } as Edge & {
      id: string;
    };
  });

  const nodeIdsToFetch = new Set<string>();
  edgesData.forEach((edge) => {
    if (edge.source && typeof edge.source === "string")
      nodeIdsToFetch.add(edge.source);
    if (edge.target && typeof edge.target === "string")
      nodeIdsToFetch.add(edge.target);
  });

  const nodeRefs = Array.from(nodeIdsToFetch);

  // Use Promise.all to avoid potential issues with getAll in some environments
  const nodeDocs = await Promise.all(
    nodeRefs.map((id) => db.collection("nodes").doc(id).get()),
  );

  const nodeNames = new Map<string, string>();
  nodeDocs.forEach((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (data && data.name) {
        nodeNames.set(doc.id, data.name);
      }
    }
  });

  const edgeIds = edgesData.map((e) => e.id);
  const revisions = await getRevisionsForNodes(db, edgeIds);

  const edgesWithDetails = edgesData.map((edge) => ({
    ...edge,
    source_name: nodeNames.get(edge.source) || edge.source,
    target_name: nodeNames.get(edge.target) || edge.target,
    revisions: revisions[edge.id] || [],
  }));

  return Object.fromEntries(edgesWithDetails.map((edge) => [edge.id, edge]));
});
