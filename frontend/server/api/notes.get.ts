import { z } from "zod";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { paginate } from "~~/server/utils/fetch";
import { defineEventHandler, getValidatedQuery } from "h3";
import type { Note } from "~~/shared/model";

// TODO this should be imported
const queryValidator = z.object({
  limit: z.coerce.number().default(10),
  page: z.coerce.number().optional(),
});

export default defineEventHandler(async (event) => {
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
      content: source.note,
      url: source.url,
    }));
  });

  const nodeIds = [...new Set(notesNoNames.map((n) => n.nodeId))];

  const namesSnapshot = await db
    .collection("nodes")
    .where(FieldPath.documentId(), "in", nodeIds)
    .get();
  const names = Object.fromEntries(
    namesSnapshot.docs.map((doc) => [doc.id, doc.data().name]),
  );

  const notes = notesNoNames.map((note) => ({
    ...note,
    name: names[note.nodeId],
  }));

  return {
    notes,
    total: countSnap.data().count,
  };
});
