import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, "user_id");
  if (!userId) return { items: [] };

  const db = getFirestore(getApp(), "koryta-pl");
  const snapshot = await db
    .collection("revisions")
    .where("update_user", "==", userId)
    .orderBy("update_time", "desc")
    .limit(50)
    .get();

  const items = snapshot.docs.map((doc) => {
    const d = doc.data();
    const data = (d.data as Record<string, any>) || {};

    return {
      id: doc.id,
      node_id: d.node_id,
      update_time: d.update_time?.toDate
        ? d.update_time.toDate()
        : d.update_time,
      ...data, // Flatten inner data to top level
      // Explicitly map useful fields if missing in data or named differently
      name: data.name || "Bez nazwy",
      node_type: data.type || "person",
      // Use the proposed name as the node_name for display context if actual parent name unavailable
      node_name: data.name,
    };
  });

  return { items };
});
