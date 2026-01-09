import type { Node } from "~~/shared/model";
import { getFirestore } from "firebase-admin/firestore";
import { getRevisionsForNodes } from "~~/server/utils/revisions";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async () => {
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
