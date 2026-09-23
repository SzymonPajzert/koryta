import { z } from "zod";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { paginate } from "~~/server/utils/fetch";
import { requireAdmin } from "~~/server/utils/auth";
import { defineEventHandler, getValidatedQuery } from "h3";
import type { Note } from "~~/shared/model";

// TODO this should be imported
const queryValidator = z.object({
  limit: z.coerce.number().default(10),
  page: z.coerce.number().optional(),
});

/** Every note entry, with its author's uid and the name of the page it is on.
 *
 * Admin-only, for the reason /api/notes/admin is. Notes on a person are
 * unreviewed claims about a named individual - `EntityDetailView` withholds
 * them from logged out readers - and this joins them with pages that may not
 * be published. It used to answer anybody: in September 2026 all 861 entries,
 * 549 of them about people with no public page, were one unauthenticated
 * request away, and something paged through every one of them twice in a day.
 * Nothing in the app calls it; the admin queue reads /api/notes/admin.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  // TODO check it in zed
  if (query.limit > 50) throw createError({ statusCode: 400 });

  const db = getFirestore("koryta-pl");
  const notesQuery = db.collection("notes").orderBy("nodeId");
  const paginatedQuery = paginate(notesQuery, query);

  const [snapshot, countSnap] = await Promise.all([
    paginatedQuery.get(),
    notesQuery.count().get(),
  ]);

  const notesNoNames = snapshot.docs.flatMap((doc) => {
    const data = doc.data() as Note;
    return (data.sources || []).map((source) => ({
      nodeId: data.nodeId,
      userUid: data.userUid,
      content: source.note,
      url: source.url ?? null,
      kind: source.kind ?? "source",
    }));
  });

  const nodeIds = [...new Set(notesNoNames.map((n) => n.nodeId))];

  // Firestore "in" queries accept at most 30 values and throw on an empty
  // array, so fetch the node names in chunks.
  const names: Record<string, string> = {};
  const types: Record<string, string> = {};
  for (let i = 0; i < nodeIds.length; i += 30) {
    const chunk = nodeIds.slice(i, i + 30);
    const namesSnapshot = await db
      .collection("nodes")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    for (const doc of namesSnapshot.docs) {
      names[doc.id] = doc.data().name;
      types[doc.id] = doc.data().type;
    }
  }

  const notes = notesNoNames.map((note) => ({
    ...note,
    name: names[note.nodeId],
    nodeType: types[note.nodeId],
  }));

  return {
    notes,
    total: countSnap.data().count,
  };
});
