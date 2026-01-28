import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const id = event.context.params?.id;

  if (!id) {
    throw createError({
      statusCode: 400,
      message: "Missing revision ID",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const revisionRef = db.collection("revisions").doc(id);
  const revisionSnap = await revisionRef.get();

  if (!revisionSnap.exists) {
    throw createError({
      statusCode: 404,
      message: "Revision not found",
    });
  }

  const revisionData = revisionSnap.data();

  if (revisionData?.update_user !== user.uid) {
    throw createError({
      statusCode: 403,
      message: "You can only delete your own revisions",
    });
  }

  await revisionRef.delete();

  return { status: "success", id };
});
