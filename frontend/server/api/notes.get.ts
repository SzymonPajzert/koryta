import { z } from "zod";
import { FieldPath } from "firebase-admin/firestore";
import { paginate } from "~~/server/utils/fetch";
import { defineEventHandler, getValidatedQuery } from "h3";
import type { Note } from "~~/shared/model";
import { adminFirestore } from "~~/server/utils/firebase";

// TODO this should be imported
const queryValidator = z.object({
  limit: z.coerce.number().default(10),
  page: z.coerce.number().optional(),
});

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  // TODO check it in zed
  if (query.limit > 50) throw createError({ statusCode: 400 });

  const db = adminFirestore();
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
