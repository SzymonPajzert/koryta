import type { Node } from "~~/shared/model";
import { getFirestore } from "firebase-admin/firestore";
import { getRevisionsForNodes } from "~~/server/utils/revisions";
import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";

/** The pages still waiting for their first review, with their revisions.
 *
 * Drafts by definition, so signed in readers only, and not from a cache:
 * this was a six hour shared entry anybody could fill and anybody could read.
 * Nothing in the app calls it today.
 */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const db = getFirestore("koryta-pl");
  const query: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("revision_id", "==", null)
    .limit(50);
  const nodes = await query.get();
  const nodesData = nodes.docs.map((doc) => {
    return { id: doc.id, ...doc.data() } as Node & {
      id: string;
    };
  });

  const nodeIds = nodesData.map((n) => n.id);
  const revisions = await getRevisionsForNodes(db, nodeIds);

  const nodesWithRevisions = nodesData.map((node) => ({
    ...node,
    revisions: revisions[node.id] || [],
  }));

  return Object.fromEntries(nodesWithRevisions.map((node) => [node.id, node]));
});
