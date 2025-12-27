import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.type || !body.name) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields (type, name)",
    });
  }

  const content = body.content || "";

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const nodeRef = db.collection("nodes").doc();

  const revisionData = {
    name: body.name,
    type: body.type,
    parties: body.parties || [],
    content: content,
    sourceURL: body.sourceURL || "",
    shortName: body.shortName || "",
  };

  const { batch } = createRevisionTransaction(
    db,
    user,
    nodeRef,
    revisionData,
    true,
  );

  await batch.commit();

  return { id: nodeRef.id };
});
