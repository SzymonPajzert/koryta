import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import type { ExtractionFact } from "~~/shared/model";

const queryValidator = z.object({
  // No limit by default: the review flow needs the whole backlog, not a page of
  // it. Callers that only render a slice pass an explicit `limit`.
  limit: z.coerce.number().optional(),
  page: z.coerce.number().default(0),
  tag: z.string().optional(),
  groupBy: z.enum(["article"]).optional(),
});

export default authCachedEventHandler(
  async (event) => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );

    const db = getFirestore(getApp(), "koryta-pl");

    let firestoreQuery: FirebaseFirestore.Query = db.collection("extractions");

    if (query.tag) {
      firestoreQuery = firestoreQuery.where("tag", "==", query.tag);
    }

    // Newest first, so a freshly ingested batch is what reviewers see.
    firestoreQuery = firestoreQuery.orderBy("createdAt", "desc");

    // Pagination is opt-in: `page` only means anything alongside a `limit`.
    if (query.limit !== undefined) {
      firestoreQuery = firestoreQuery
        .offset(query.page * query.limit)
        .limit(query.limit);
    }

    const snapshot = await firestoreQuery.get();

    const facts: ExtractionFact[] = snapshot.docs.map((doc) => {
      const { createdAt, stats, ...data } = doc.data();
      return {
        id: doc.id,
        ...data,
        stats,
        // Stored as a Firestore Timestamp; the shared model says ISO string.
        createdAt: createdAt?.toDate?.().toISOString() ?? createdAt,
        // One reviewer per fact: the `onVoteWritten` trigger already keeps this
        // aggregate on the document, so the review state costs no extra read.
        reviewed: stats?.votes?.humanVoted === true,
      };
    }) as ExtractionFact[];

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
  },
  { maxAge: 60 },
);
