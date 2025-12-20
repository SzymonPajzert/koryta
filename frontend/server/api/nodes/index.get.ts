import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { Node } from "~~/shared/model";

export default defineEventHandler(async () => {
  const db = getFirestore(getApp(), "koryta-pl");

  const list = await db.collection("nodes").where("type", "!=", "record").get();
  
  const nodesData = list.docs.map((doc) => {
    return { id: doc.id, ...doc.data() } as Node & { id: string };
  });

  const revisionIds = nodesData
    .map((n) => n.approved_revision_id)
    .filter(Boolean) as string[];

  console.log("Found revisionIds:", revisionIds);

  const revisions: Record<string, any> = {};
  if (revisionIds.length > 0) {
    const refs = revisionIds.map((id) => db.collection("revisions").doc(id));
    if (refs.length > 0) {
        const snapshots = await db.getAll(...refs);
        snapshots.forEach((snap) => {
            console.log("Fetched revision:", snap.id, snap.exists, snap.data());
            if (snap.exists) revisions[snap.id] = snap.data();
        });
    }
  }

  const nodes = Object.fromEntries(
    nodesData.map((node) => {
        if (node.approved_revision_id && revisions[node.approved_revision_id]) {
            const rev = revisions[node.approved_revision_id];
            // Merge revision data into node, overriding node fields
            return [node.id, { ...node, ...rev.data }];
        }
        return [node.id, node];
    }),
  );

  return { nodes };
});
