import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import type { ExtractionFact } from "~~/shared/model";
import { z } from "zod";

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

  const db = getFirestore(getApp(), "koryta-pl");

  // Collect unique article URLs for batch node lookup
  const uniqueUrls = [...new Set(body.articles.map((a) => a.url))];
  const urlToNodeId = new Map<string, string>();

  // Look up existing article nodes by URL (chunk by 10 for Firestore 'in' limit)
  for (let i = 0; i < uniqueUrls.length; i += 10) {
    const chunk = uniqueUrls.slice(i, i + 10);
    const snapshot = await db
      .collection("nodes")
      .where("type", "==", "article")
      .where("sourceURL", "in", chunk)
      .get();

    for (const doc of snapshot.docs) {
      const sourceURL = doc.data().sourceURL as string;
      urlToNodeId.set(sourceURL, doc.id);
    }
  }

  // Flatten all facts and prepare documents
  const allDocs: FirebaseFirestore.DocumentData[] = [];
  for (const article of body.articles) {
    const articleNodeId = urlToNodeId.get(article.url);
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
