import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { toArticleCapture } from "~~/server/utils/captures";

/** One capture, which is what the extension popup and `/zrodla` poll while the
 * extractor is working. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  requireDatascience(await getUser(event));

  const db = getFirestore(getApp(), "koryta-pl");
  const snapshot = await db.collection("articlePages").doc(id).get();
  if (!snapshot.exists) {
    throw createError({ statusCode: 404, message: "Nie ma takiej strony." });
  }

  return { capture: toArticleCapture(snapshot.id, snapshot.data()!) };
});
