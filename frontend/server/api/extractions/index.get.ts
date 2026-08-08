import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { toExtractionFact } from "~~/server/utils/extractions";
import type { ExtractionFact } from "~~/shared/model";

// The collection grows with every ingest, so a page is always served — no
// caller needs the whole backlog, and `total` tells them how much they missed.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const queryValidator = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
  page: z.coerce.number().default(0),
  tag: z.string().optional(),
  /** Everything extracted from one article.
   *
   * Matched against the url exactly as the uploader sent it, which is the same
   * string a capture stores: `/api/ingest/page` derives both from
   * `parseCrawlUrl`, and the extractor echoes back the url it was handed. No
   * normalisation here, so this stays a plain equality the index can serve.
   */
  articleUrl: z.string().optional(),
  // Mirrors `hideVoted` on /api/nodes: filters on the vote aggregate that the
  // onVoteWritten trigger keeps on the document, so it costs no extra read.
  reviewed: z.enum(["all", "yes", "no"]).default("all"),
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

    if (query.articleUrl) {
      firestoreQuery = firestoreQuery.where(
        "articleUrl",
        "==",
        query.articleUrl,
      );
    }

    if (query.reviewed !== "all") {
      firestoreQuery = firestoreQuery.where(
        "stats.votes.humanVoted",
        "==",
        query.reviewed === "yes",
      );
    }

    // Newest first, so a freshly ingested batch is what reviewers see.
    firestoreQuery = firestoreQuery.orderBy("createdAt", "desc");

    // The count is of the filtered query, not the page — it is what tells a
    // reviewer how much backlog is left behind the slice they were served.
    const [snapshot, countSnapshot] = await Promise.all([
      firestoreQuery
        .offset(query.page * query.limit)
        .limit(query.limit)
        .get(),
      firestoreQuery.count().get(),
    ]);
    const total = countSnapshot.data().count;

    const facts: ExtractionFact[] = snapshot.docs.map(toExtractionFact);

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
      return { articles, total };
    }

    return { facts, total };
  },
  { maxAge: 60 },
);
