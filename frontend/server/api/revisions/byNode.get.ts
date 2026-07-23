import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const nodeId = query.nodeId as string | undefined;
  if (!nodeId) {
    throw createError({
      statusCode: 400,
      message: "Missing nodeId query parameter",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");

  // Query with both field name variants (node_id and nodeId)
  const [byUnderscore, byCamel, nodeDoc] = await Promise.all([
    db.collection("revisions").where("node_id", "==", nodeId).get(),
    db.collection("revisions").where("nodeId", "==", nodeId).get(),
    db.collection("nodes").doc(nodeId).get(),
  ]);

  // Deduplicate by document ID
  const map = new Map<string, Record<string, unknown>>();
  for (const doc of [...byUnderscore.docs, ...byCamel.docs]) {
    if (!map.has(doc.id)) {
      map.set(doc.id, { id: doc.id, ...doc.data() });
    }
  }

  // Extract the approved revision ID from the node document
  let approvedRevisionId: string | undefined = undefined;
  if (nodeDoc.exists) {
    const nodeData = nodeDoc.data();
    const revId = nodeData?.revision_id;
    if (revId) {
      if (typeof revId === "string") {
        const segments = revId.split("/");
        approvedRevisionId = segments[segments.length - 1];
      } else if (typeof revId === "object" && "path" in revId) {
        const segments = (revId as { path: string }).path.split("/");
        approvedRevisionId = segments[segments.length - 1];
      }
    }
  }

  return {
    revisions: Array.from(map.values()),
    approvedRevisionId,
  };
});
