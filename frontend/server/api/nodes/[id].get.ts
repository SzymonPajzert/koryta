import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { pageIsPublic } from "~~/shared/model";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { z } from "zod";
import type { Node } from "~~/shared/model";

const queryValidator = z.object({
  latest: z.boolean().optional(),
});

const responseValidator = z.object({
  name: z.string(),
  type: z.enum(["person", "place", "article", "region"]),
});

export default authCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing type or id" });
  }
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const db = getFirestore(getApp(), "koryta-pl");
  const node = await (query.latest
    ? getLatestRevision(db, id)
    : getEntity(db, id));

  if (!node) {
    throw createError({ statusCode: 404, message: "Node not found" });
  }
  // TODO how to check the response has a correct shape
  const response: Node = responseValidator.parse(node);
  if (!pageIsPublic(response) && !query.latest) {
    throw createError({ statusCode: 404, message: "Page not approved" });
  }

  return { node };
});

async function getLatestRevision(db: FirebaseFirestore.Firestore, id: string) {
  return (
    await db
      .collection("revisions")
      .where("node_id", "==", id)
      .orderBy("update_time", "desc")
      .limit(1)
      .get()
  ).docs.map((doc) => doc.data())[0];
}

async function getEntity(db: FirebaseFirestore.Firestore, id: string) {
  const nodeDoc = await db.collection("nodes").doc(id).get();
  if (nodeDoc.exists) {
    return { id: nodeDoc.id, ...nodeDoc.data() };
  }
  return null;
}
