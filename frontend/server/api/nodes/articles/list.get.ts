import { getValidatedQuery } from "h3";
import { getFirestore } from "firebase-admin/firestore";
import { paginate } from "~~/server/utils/fetch";
import { z } from "zod";

const listQueryValidator = z.object({
  limit: z.coerce.number().default(50),
  page: z.coerce.number().optional(),
});

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) =>
    listQueryValidator.parse(q),
  );

  const db = getFirestore("koryta-pl");
  const articlesQuery = db.collection("nodes").where("type", "==", "article");
  const paginatedArticles = paginate(articlesQuery, query);
  const articlesSnap = await paginatedArticles.get();

  const articleUrls = articlesSnap.docs
    .map((doc) => doc.data().sourceURL as string | undefined)
    .filter((url): url is string => !!url);

  const notesQuery = db.collection("notes");
  const paginatedNotes = paginate(notesQuery, query);
  const notesSnap = await paginatedNotes.get();

  const noteUrls = notesSnap.docs
    .flatMap((doc) => {
      const data = doc.data();
      return (data.sources || []).map((s: { url?: string }) => s.url);
    })
    .filter((url): url is string => !!url);

  return {
    articles: Array.from(new Set(articleUrls)),
    notes: Array.from(new Set(noteUrls)),
  };
});
