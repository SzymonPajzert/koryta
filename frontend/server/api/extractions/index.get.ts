import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import type { ExtractionFact } from "~~/shared/model";

const queryValidator = z.object({
  limit: z.coerce.number().default(100),
  page: z.coerce.number().default(0),
  tag: z.string().optional(),
  groupBy: z.enum(["article"]).optional(),
});

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const db = getFirestore(getApp(), "koryta-pl");

  let firestoreQuery: FirebaseFirestore.Query = db.collection("extractions");

  if (query.tag) {
    firestoreQuery = firestoreQuery.where("tag", "==", query.tag);
  }

  // Pagination
  const offset = query.page * query.limit;
  firestoreQuery = firestoreQuery.offset(offset).limit(query.limit);

  const snapshot = await firestoreQuery.get();

  const facts: ExtractionFact[] = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as ExtractionFact[];

  if (query.groupBy === "article") {
    const articles: Record<
      string,
      { domain: string; facts: ExtractionFact[] }
    > = {};
    for (const fact of facts) {
      const url = fact.articleUrl;
      if (!articles[url]) {
        articles[url] = {
          domain: fact.articleDomain || "",
          facts: [],
        };
      }
      articles[url].facts.push(fact);
    }
    return { articles };
  }

  return { facts };
});
