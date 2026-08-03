import { Timestamp } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";
import type { ExtractionFact } from "~~/shared/model";
import { normalizeUrl } from "~~/shared/url";
import { z } from "zod";
import { adminFirestore } from "~~/server/utils/firebase";

const factSchema = z.object({
  url: z.string(),
  justification: z.string(),
  justification_in_text: z.string().nullable().optional(),
  fact_type: z.enum(["employment", "party_membership", "personal_relation"]),
  person: z.string().optional(),
  organization: z.string().optional(),
  role: z.string().optional(),
  party: z.string().optional(),
  subject: z.string().optional(),
  object: z.string().optional(),
  relation: z.string().optional(),
}) satisfies z.ZodType<Omit<ExtractionFact, "articleUrl" | "tag">>;

const articleSchema = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  publication_date: z.string().nullable(),
  extracted_facts: z.array(factSchema),
  tag: z.string(),
});

const extractionRequestSchema = z.object({
  articles: z.array(articleSchema),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    extractionRequestSchema.parse(body),
  );

  // Checks that the user is logged in
  const user = await getUser(event);

  if (user.datascience !== true) {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden",
      message: "You need to be a member of the datascience group",
    });
  }

  const db = adminFirestore();

  // Article nodes by normalized url. This used to be an `in` query on the exact
  // `sourceURL`, which never matched anything: the crawler stores
  // `https://www.example.pl/a`, the extraction pipeline sends `example.pl/a`,
  // and Firestore compares strings. Reading the article nodes once and matching
  // on the normalized form is both correct and, at a few hundred articles,
  // cheaper than the chunked queries it replaces.
  const urlToNodeId = new Map<string, string>();
  const articles = await db
    .collection("nodes")
    .where("type", "==", "article")
    .select("sourceURL")
    .get();
  for (const doc of articles.docs) {
    const sourceURL = doc.data().sourceURL as string | undefined;
    if (sourceURL) urlToNodeId.set(normalizeUrl(sourceURL), doc.id);
  }

  // Flatten all facts and prepare documents
  const allDocs: FirebaseFirestore.DocumentData[] = [];
  for (const article of body.articles) {
    const articleNodeId = urlToNodeId.get(normalizeUrl(article.url));
    for (const fact of article.extracted_facts) {
      const doc: Record<string, unknown> = {
        url: fact.url,
        justification: fact.justification,
        justification_in_text: fact.justification_in_text ?? null,
        fact_type: fact.fact_type,
        articleUrl: article.url,
        articleDomain: article.domain,
        tag: article.tag,
        createdAt: Timestamp.now(),
        uploaderUid: user.uid,
        // Seed the aggregate the `onVoteWritten` trigger maintains from here
        // on. Firestore cannot query for a field that is absent, so without
        // this an unvoted fact could never be found by a
        // `stats.votes.humanVoted == false` query — which is exactly the
        // backlog the review flow needs. See
        // scripts/backfill-extraction-vote-stats.ts for existing documents.
        stats: { votes: { humanVoted: false } },
      };
      if (articleNodeId) {
        doc.articleNodeId = articleNodeId;
      }
      // Add optional fact-type-specific fields
      if (fact.person !== undefined) doc.person = fact.person;
      if (fact.organization !== undefined) doc.organization = fact.organization;
      if (fact.role !== undefined) doc.role = fact.role;
      if (fact.party !== undefined) doc.party = fact.party;
      if (fact.subject !== undefined) doc.subject = fact.subject;
      if (fact.object !== undefined) doc.object = fact.object;
      if (fact.relation !== undefined) doc.relation = fact.relation;

      allDocs.push(doc);
    }
  }

  // Write in batches of 500 (Firestore batch limit)
  const BATCH_SIZE = 500;
  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allDocs.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) {
      const ref = db.collection("extractions").doc();
      batch.set(ref, doc);
    }
    await batch.commit();
  }

  return {
    status: "ok",
    count: allDocs.length,
  };
});
