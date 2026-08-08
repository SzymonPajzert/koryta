import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { toArticleCapture } from "~~/server/utils/captures";
import { normalizeUrl } from "~~/shared/url";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const queryValidator = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
  status: z.enum(["stored", "extracting", "done", "error"]).optional(),
  /** Captures of one page, for the extension asking "have we read this?".
   *
   * Matched on `normalizedUrl`, not on the url as given: the address in the
   * browser's bar carries the tracking parameters and the scheme that the
   * canonical link the capture was filed under does not.
   */
  url: z.string().optional(),
});

/** Recent captures, newest first.
 *
 * `/zrodla` lists articles and wants to say which of them anyone has actually
 * got the text of, so it indexes this by `normalizedUrl`. Served as a flat
 * page rather than a per-article lookup because there are far fewer captures
 * than articles, and one query beats a hundred.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  requireDatascience(await getUser(event));

  const db = getFirestore(getApp(), "koryta-pl");
  let firestoreQuery: FirebaseFirestore.Query = db.collection("articlePages");
  if (query.status) {
    firestoreQuery = firestoreQuery.where("status", "==", query.status);
  }
  if (query.url) {
    firestoreQuery = firestoreQuery.where(
      "normalizedUrl",
      "==",
      normalizeUrl(query.url),
    );
  }

  const snapshot = await firestoreQuery
    .orderBy("capturedAt", "desc")
    .limit(query.limit)
    .get();

  return {
    captures: snapshot.docs.map((doc) => toArticleCapture(doc.id, doc.data())),
  };
});
