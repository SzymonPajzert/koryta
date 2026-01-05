import { getFirestore } from "firebase-admin/firestore";
import type { Revision } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Zgłoszenie nie posiada ID",
    });
  }

  const db = getFirestore("koryta-pl");
  const doc = await db.collection("revisions").doc(id).get();

  if (!doc.exists) {
    throw createError({
      statusCode: 404,
      statusMessage: "Rewizja nie znaleziona",
    });
  }

  return { id: doc.id, ...doc.data() } as Revision;
});
