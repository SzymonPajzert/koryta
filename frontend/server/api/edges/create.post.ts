import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.type || !body.source || !body.target) {
    throw createError({
      statusCode: 400,
      message: "Missing required fields",
    });
  }

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");

  const edgeRef = db.collection("edges").doc();

  const revisionData = {
    source: body.source,
    target: body.target,
    type: body.type,
    name: body.name || "",
    content: body.content || body.text || "",
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    references: body.references || [],
  };

  const batch = db.batch();
  createRevisionTransaction(db, batch, user, edgeRef, revisionData);

  await batch.commit();

  return { id: edgeRef.id };
});
