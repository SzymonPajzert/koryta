import type { NodeType } from "~~/shared/model";
import { getFirestore } from "firebase-admin/firestore";

export default defineEventHandler(async () => {
  const db = getFirestore("koryta-pl");
  const query: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("revision_id", "==", null)
    .limit(50);
  const nodes = await query.get();
  const nodesData = nodes.docs.map((doc) => {
    return { id: doc.id, ...doc.data() } as NodeType & {
      id: string;
    };
  });

  return Object.fromEntries(nodesData.map((node) => [node.id, node]));
});
