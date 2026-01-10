import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.node_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields (node_id)",
    });
  }

  const content = body.content || body.text || "";

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const revisionData: Record<string, unknown> = {
    name: body.name,
    type: body.type,
    content: content,
    parties: body.parties || [],
    sourceURL: body.sourceURL || "",
    shortName: body.shortName || "",
    // Edge fields
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    references: body.references || [],
    deleted: body.deleted || false,
    delete_reason: body.delete_reason || null,
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
    false,
  );

  await batch.commit();

  return { id: revisionRef.id };
});
