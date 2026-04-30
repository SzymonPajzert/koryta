import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

export function placeholder() {
  isEdge({});
  const db = getFirestore(getApp(), "koryta-pl");
  resolveEdgeNames(db, {});
}

function isEdge(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "source" in data &&
    "target" in data &&
    "type" in data
  );
}

async function resolveEdgeNames(
  db: FirebaseFirestore.Firestore,
  data: Record<string, unknown>,
) {
  const source = data.source as string;
  const target = data.target as string;
  const sourceDoc = await db.collection("nodes").doc(source).get();
  const targetDoc = await db.collection("nodes").doc(target).get();

  return {
    ...data,
    source_name: sourceDoc.exists ? sourceDoc.data()?.name : source,
    target_name: targetDoc.exists ? targetDoc.data()?.name : target,
  };
}
