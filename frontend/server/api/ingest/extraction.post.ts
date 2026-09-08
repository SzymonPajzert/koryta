import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import type { ExtractionFact } from "~~/shared/model";
import { normalizePersonName } from "~~/shared/names";
import { normalizeUrl } from "~~/shared/url";
import { z } from "zod";

const factSchema = z.object({
  url: z.string(),
  justification: z.string(),
  justification_in_text: z.string().nullable().optional(),
  fact_type: z.enum([
    "employment",
    "party_membership",
    "personal_relation",
    "affair_involvement",
  ]),
  person: z.string().optional(),
  organization: z.string().optional(),
  role: z.string().optional(),
  party: z.string().optional(),
  subject: z.string().optional(),
  object: z.string().optional(),
  relation: z.string().optional(),
  affair: z.string().optional(),
}) satisfies z.ZodType<Omit<ExtractionFact, "articleUrl" | "tag">>;

const articleSchema = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  publication_date: z.string().nullable(),
  extracted_facts: z.array(factSchema),
  tag: z.string(),
  /** Node ids of the people the pipeline confirmed are named in this article.
   *
   * Article-level, because that is what the mention matcher judges: one article
   * usually carries facts about several people, and only some of them are in
   * the graph. Which fact belongs to which of these people is settled here, by
   * name - see `matchPeopleByName`. Optional: the one-shot capture path
   * (`oneshot.py`) analyses a page before any mention matching has run.
   */
  koryta_ids: z.array(z.string()).optional(),
});

const extractionRequestSchema = z.object({
  articles: z.array(articleSchema),
  /** Who these facts should be credited to, when that is not the caller.
   *
   * The capture extractor runs as a service account and submits on behalf of
   * whoever captured the page — without this every fact found that way would be
   * attributed to the service rather than to the person who found the article.
   * Only a datascience caller reaches this endpoint at all, so there is no
   * wider identity to spoof.
   */
  uploaderUid: z.string().min(1).optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    extractionRequestSchema.parse(body),
  );

  const user = requireDatascience(await getUser(event));
  const uploaderUid = body.uploaderUid ?? user.uid;

  const db = getFirestore(getApp(), "koryta-pl");

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

  // The people the pipeline confirmed in these articles, by node id. Read once
  // for the whole batch: the same politician shows up in article after article,
  // so a per-article lookup would fetch them over and over.
  const peopleById = await readPeople(
    db,
    body.articles.flatMap((article) => article.koryta_ids ?? []),
  );

  // Flatten all facts and prepare documents
  const allDocs: FirebaseFirestore.DocumentData[] = [];
  for (const article of body.articles) {
    const articleNodeId = urlToNodeId.get(normalizeUrl(article.url));
    const peopleByName = matchPeopleByName(article.koryta_ids, peopleById);
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
        uploaderUid,
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
      // Which of the article's confirmed people this particular fact is about.
      // `person` for most types, `subject` for a personal_relation - the same
      // pair `factSubject` reads on the card, so the name shown is the name
      // matched.
      const subject = fact.person || fact.subject;
      const matched = subject
        ? peopleByName.get(normalizePersonName(subject))
        : undefined;
      if (matched) {
        doc.personNodeId = matched.id;
        doc.personNodeName = matched.name;
      }
      // Add optional fact-type-specific fields
      if (fact.person !== undefined) doc.person = fact.person;
      if (fact.organization !== undefined) doc.organization = fact.organization;
      if (fact.role !== undefined) doc.role = fact.role;
      if (fact.party !== undefined) doc.party = fact.party;
      if (fact.subject !== undefined) doc.subject = fact.subject;
      if (fact.object !== undefined) doc.object = fact.object;
      if (fact.relation !== undefined) doc.relation = fact.relation;
      if (fact.affair !== undefined) doc.affair = fact.affair;

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

  const touchedPeople = new Set(
    allDocs
      .map((doc) => doc.personNodeId as string | undefined)
      .filter((id): id is string => typeof id === "string"),
  );
  const peopleUpdated = await updateFactCounts(db, touchedPeople);

  return {
    status: "ok",
    count: allDocs.length,
    peopleUpdated,
  };
});

/** Bring `stats.factsCount` back in line on every person this batch named.
 *
 * The counter exists because /eksploruj/tabela offers „Liczba faktów” as a
 * sort, and Firestore can only order by a field on the document it is ordering.
 *
 * Recounted rather than incremented by what was just written: an ingest that
 * resends a batch is normal - the pipeline is re-runnable - and an increment
 * would then double-count facts the table would go on showing until somebody
 * ran /api/stats/computeNodes. A `count()` aggregation is billed as one read
 * per thousand index entries, so recounting is also the cheaper of the two for
 * everybody with fewer than a thousand facts, which is everybody.
 *
 * A person whose update fails is logged and skipped rather than failing the
 * request: the facts themselves are already committed, and the count is
 * recomputed wholesale by /api/stats/computeNodes.
 */
async function updateFactCounts(
  db: FirebaseFirestore.Firestore,
  personNodeIds: ReadonlySet<string>,
): Promise<number> {
  const ids = [...personNodeIds];
  // Two round trips per person, so they go out in parallel - but not all at
  // once: a nightly batch can name hundreds of people, and Firestore answers a
  // flood of aggregations with RESOURCE_EXHAUSTED rather than with a queue.
  const CONCURRENCY = 20;
  let updated = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (id) => {
        try {
          const count = await db
            .collection("extractions")
            .where("personNodeId", "==", id)
            .count()
            .get();
          await db
            .collection("nodes")
            .doc(id)
            .update({ "stats.factsCount": count.data().count });
          updated++;
        } catch (error) {
          logger.error(`Could not update stats.factsCount for node ${id}`, {
            error,
          });
        }
      }),
    );
  }
  return updated;
}

/** The person nodes behind a batch's `koryta_ids`, by id.
 *
 * Only `name` and `type` are read - the rest of a person node is large and
 * nothing here looks at it. Ids that name no document, or name something that
 * is not a person, are simply absent from the map: the pipeline should only
 * send people, and a fact linked to an institution's node would be worse than
 * one linked to nobody.
 */
async function readPeople(
  db: FirebaseFirestore.Firestore,
  ids: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const people = new Map<string, { id: string; name: string }>();
  const unique = [...new Set(ids)];
  // getAll is one round trip per call; chunked so a nightly batch of thousands
  // of articles does not build a single unbounded request.
  const CHUNK = 300;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const refs = unique
      .slice(i, i + CHUNK)
      .map((id) => db.collection("nodes").doc(id));
    const docs = await db.getAll(...refs, { fieldMask: ["name", "type"] });
    for (const doc of docs) {
      const data = doc.data();
      if (!data || data.type !== "person" || typeof data.name !== "string") {
        continue;
      }
      people.set(doc.id, { id: doc.id, name: data.name });
    }
  }
  return people;
}

/** One article's confirmed people, keyed by their normalized name.
 *
 * A name that two of them share is dropped rather than guessed at: the whole
 * point of the flag on the card is that a namesake is easy to match wrongly, so
 * a case we already know is ambiguous should not be asserted at all.
 */
function matchPeopleByName(
  korytaIds: string[] | undefined,
  peopleById: Map<string, { id: string; name: string }>,
): Map<string, { id: string; name: string }> {
  const byName = new Map<string, { id: string; name: string }>();
  const ambiguous = new Set<string>();
  for (const id of korytaIds ?? []) {
    const person = peopleById.get(id);
    if (!person) continue;
    const key = normalizePersonName(person.name);
    if (!key) continue;
    if (byName.has(key) && byName.get(key)!.id !== id) ambiguous.add(key);
    byName.set(key, person);
  }
  for (const key of ambiguous) byName.delete(key);
  return byName;
}
