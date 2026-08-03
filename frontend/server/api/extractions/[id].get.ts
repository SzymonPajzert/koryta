import { authCachedEventHandler } from "~~/server/utils/handlers";
import { toExtractionFact } from "~~/server/utils/extractions";
import { adminFirestore } from "~~/server/utils/firebase";

/** One fact by id, whatever its review state.
 *
 * The list endpoint serves a filtered page — the review flow asks it for
 * unreviewed facts only — so a shared `?fact=<id>` link needs a way to reach
 * past that filter. Without it, linking a card would stop working the moment
 * anybody reviewed it, which is most of the cards worth sharing. */
export default authCachedEventHandler(
  async (event) => {
    const id = getRouterParam(event, "id");
    if (!id) {
      throw createError({ statusCode: 400, message: "Missing extraction id" });
    }

    const db = adminFirestore();
    const doc = await db.collection("extractions").doc(id).get();

    if (!doc.exists) {
      throw createError({
        statusCode: 404,
        message: `Extraction not found for id=${id}`,
      });
    }

    return { fact: toExtractionFact(doc) };
  },
  { maxAge: 60 },
);
