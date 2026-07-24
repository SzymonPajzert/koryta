import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import type { ExtractionFact, VoteDocument } from "~~/shared/model";

const queryValidator = z.object({
  limit: z.coerce.number().default(100),
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

    // Pagination
    const offset = query.page * query.limit;
    firestoreQuery = firestoreQuery.offset(offset).limit(query.limit);

    const snapshot = await firestoreQuery.get();

    const facts: ExtractionFact[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ExtractionFact[];

    await attachReviewCounts(db, facts);

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

/** Set `reviewCount` on each fact: how many humans cast a correct/insufficient
 * vote on it. Lets the review flow hand every fact to a single reviewer.
 * Votes by the automated "pipeline" user don't claim a fact (same convention
 * as computeVoteStats). */
async function attachReviewCounts(
  db: FirebaseFirestore.Firestore,
  facts: ExtractionFact[],
) {
  const ids = facts.map((f) => f.id).filter((id): id is string => !!id);

  // Firestore caps `in` filters at 30 values per query.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) {
    chunks.push(ids.slice(i, i + 30));
  }

  const reviewers = new Map<string, number>();
  const snapshots = await Promise.all(
    chunks.map((chunk) =>
      db.collection("votes").where("nodeId", "in", chunk).get(),
    ),
  );
  for (const votesSnapshot of snapshots) {
    for (const doc of votesSnapshot.docs) {
      const vote = doc.data() as VoteDocument;
      if (vote.userUid === "pipeline") continue;
      if (vote.categoryVotes.correct || vote.categoryVotes.insufficient) {
        reviewers.set(vote.nodeId, (reviewers.get(vote.nodeId) ?? 0) + 1);
      }
    }
  }

  for (const fact of facts) {
    if (fact.id) fact.reviewCount = reviewers.get(fact.id) ?? 0;
  }
}
