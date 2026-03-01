import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import { anyEdge, anyNode } from "~~/shared/empty";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.node_id) {
    throw createError({
      statusCode: 400,
      message: "Missing required fields (node_id)",
    });
  }

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const revisionData: Record<string, unknown> = {
    ...anyNode(body),
    ...anyEdge(body),
  };

  if (body.source) {
    revisionData.source = body.source;
  }
  if (body.target) {
    revisionData.target = body.target;
  }

  const collection = body.collection || "nodes";
  const nodeRef = db.collection(collection).doc(body.node_id);

  const batch = db.batch();

  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    user,
    nodeRef,
    revisionData,
  );

  await batch.commit();

  return { id: revisionRef.id };
});
