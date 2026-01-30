import { getUser } from "~~/server/utils/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { pageIsPublic } from "~~/shared/model";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const user = await getUser(event).catch(() => null);

  if (!id) {
    throw createError({ statusCode: 400, message: "Missing type or id" });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  let node;
  if (user) {
    const revision = (
      await db
        .collection("revisions")
        .where("node_id", "==", id)
        .orderBy("update_time", "desc")
        .limit(1)
        .get()
    ).docs.map((doc) => doc.data())[0];
    if (revision) {
      console.log(
        "Found revision for node",
        id,
        revision.data?.wikipedia ? "HAS WIKI" : "NO WIKI",
      );
      node = { ...revision.data, node_id: revision.node_id };
    } else {
      // Fallback to original node if no revisions found
      node = await getEntity(db, id);
    }
  } else {
    node = await getEntity(db, id);
  }

  if (!node) {
    throw createError({ statusCode: 404, message: "Node not found" });
  }

  if (isEdge(node)) {
    node = await resolveEdgeNames(db, node);
  }

  // Visibility filtering
  if (!user && !pageIsPublic(node)) {
    throw createError({
      statusCode: 404,
      message: "Node not found (internal)",
    });
  }

  return { node };
});

async function getEntity(db: FirebaseFirestore.Firestore, id: string) {
  const nodeDoc = await db.collection("nodes").doc(id).get();
  if (nodeDoc.exists) {
    return { id: nodeDoc.id, ...nodeDoc.data() };
  }
  const edgeDoc = await db.collection("edges").doc(id).get();
  if (edgeDoc.exists) {
    return { id: edgeDoc.id, ...edgeDoc.data() };
  }
  return null;
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
