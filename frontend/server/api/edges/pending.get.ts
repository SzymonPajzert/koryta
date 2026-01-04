import type { Edge } from "~~/shared/model";
import { getFirestore } from "firebase-admin/firestore";

export default defineEventHandler(async () => {
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

  return Object.fromEntries(edgesData.map((edge) => [edge.id, edge]));
});
