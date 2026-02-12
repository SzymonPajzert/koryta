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

  // 1. First pass: Collect all node IDs needed for "edges"
  const edgeSourceIds = new Set<string>();
  const edgeTargetIds = new Set<string>();

  const rawItems = snapshot.docs.map((doc) => {
    const d = doc.data();
    const data = (d.data as Record<string, any>) || {};
    return { id: doc.id, d, data };
  });

  for (const { data } of rawItems) {
    if (data.source && data.target) {
      edgeSourceIds.add(data.source);
      edgeTargetIds.add(data.target);
    }
  }

  // 2. Fetch all unique nodes in parallel
  const neededIds = new Set([...edgeSourceIds, ...edgeTargetIds]);
  const nodeNamesMap: Record<string, string> = {};

  if (neededIds.size > 0) {
    // Firestore 'in' limit is 10. If neededIds > 10, strictly we should chunk.
    // For simplicity here assuming < 10 or implementing simple chunking:
    const allIds = Array.from(neededIds);
    if (allIds.length > 0) {
      const refs = allIds.map((id) => db.collection("nodes").doc(id));
      const docs = await db.getAll(...refs);
      docs.forEach((d) => {
        if (d.exists) {
          const nd = d.data() as any;
          nodeNamesMap[d.id] = nd.name || "Bez nazwy";
        }
      });
    }
  }

  // 3. Map final items
  const items = rawItems.map(({ id, d, data }) => {
    let node_name = data.name;

    // If it's an edge (has source/target), try to construct the name
    if (
      (!node_name || node_name === "Bez nazwy") &&
      data.source &&
      data.target
    ) {
      const sName = nodeNamesMap[data.source] || data.source;
      const tName = nodeNamesMap[data.target] || data.target;
      node_name = `${sName} -> ${tName}`;
    }

    return {
      id: id,
      node_id: d.node_id,
      update_time: d.update_time?.toDate
        ? d.update_time.toDate()
        : d.update_time,
      ...data, // Flatten inner data to top level
      // Explicitly map useful fields if missing in data or named differently
      name: data.name || "Bez nazwy",
      node_type: data.type || "person",
      node_name: node_name,
    };
  });

  return { items };
});
