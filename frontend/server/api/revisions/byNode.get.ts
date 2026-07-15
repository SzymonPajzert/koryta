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
  const [byUnderscore, byCamel] = await Promise.all([
    db.collection("revisions").where("node_id", "==", nodeId).get(),
    db.collection("revisions").where("nodeId", "==", nodeId).get(),
  ]);

  // Deduplicate by document ID
  const map = new Map<string, Record<string, unknown>>();
  for (const doc of [...byUnderscore.docs, ...byCamel.docs]) {
    if (!map.has(doc.id)) {
      map.set(doc.id, { id: doc.id, ...doc.data() });
    }
  }

  return Array.from(map.values());
});
