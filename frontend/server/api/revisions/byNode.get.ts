import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";

/** Every revision of one page, as raw documents - for a signed in reader only,
 * for the reason `/api/revisions/[id]` gives. */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
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

  // Extract the approved revision ID and publication state from the node
  let approved: string | undefined = undefined;
  let published = false;
  if (nodeDoc.exists) {
    const nodeData = nodeDoc.data();
    published = pageIsPublic(nodeData || {});
    approved = approvedRevisionId(nodeData?.revision_id);
  }

  return {
    revisions: Array.from(map.values()),
    approvedRevisionId: approved,
    published,
    /** Whether the node exists at all - a suggestion for a node that was never
     * created has revisions but nothing to approve them onto. */
    exists: nodeDoc.exists,
  };
});
