import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  proposeRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import {
  edgeDocumentId,
  edgeIdentity,
  enrichedEdge,
  findEdgeMatches,
} from "~~/server/utils/edges";
import { electionPositions } from "~~/shared/misc";
import type { Edge, Article, Person, ElectionPosition } from "~~/shared/model";
import { pageIsPublic } from "~~/shared/model";
import {
  personRequestSchema,
  type EntityResult,
  type ElectionRequest,
  type EmploymentRequest,
  type PersonRequest,
} from "#shared/api";

export default defineEventHandler(async (event) => {
  const body: PersonRequest = await readValidatedBody(event, (body) =>
    personRequestSchema.parse(body),
  );
  const user = requireDatascience(await getUser(event));
  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();
  const ctx = new Context(db, user, batch, body.autoapprove ?? false);

  const { companyIDs, missingKRS } = await lookupCompanyIDs(
    ctx,
    body.companies,
  );
  if (missingKRS.length > 0) {
    console.info("[404] Missing companies:", missingKRS);
    setResponseStatus(
      event,
      404,
      `Missing companies: ${missingKRS.join(", ")}`,
    );
    return {
      message: `Missing companies: ${missingKRS.join(", ")}`,
      data: missingKRS,
    };
  }

  try {
    // The document, not just its id: the update below needs the visibility
    // stored on it, and this query has already read it - asking again would be
    // a second read of every person in the payload.
    const personDoc = await lookupNodeDoc(ctx, "name", body.name);
    let personId: string | undefined = personDoc?.id;
    if (!personId) {
      const personRef = db.collection("nodes").doc();
      personId = personRef.id;
      createRevisionTransaction(
        db,
        batch,
        user,
        personRef,
        createPerson(body),
        {
          automatic: true,
          approve: ctx.autoapprove,
          published: ctx.autoapprove,
        },
      );
    } else {
      const personRef = db.collection("nodes").doc(personId);
      // The stored document, not just its visibility. A revision is written to
      // its target with `set` and states only the data, so every field the node
      // owns - whether it is published, the counters the listings filter on,
      // the votes - is deleted by an update that does not carry it back. Every
      // re-ingested person came off the site that way, and then out of every
      // listing, which is the one thing a scraper re-run must never do.
      const stored = personDoc?.data() ?? {};
      const published = pageIsPublic(stored);
      const revision = updatedPerson(stored, body);
      if (revision) {
        createRevisionTransaction(db, batch, user, personRef, revision, {
          automatic: true,
          // A live page's node is a copy of an approved revision, so an update
          // to one has to be approved with it or the page would show data no
          // reviewer ever accepted.
          approve: ctx.autoapprove || published,
          stored,
        });
      }
    }

    // Track results
    const articlesResult: EntityResult[] = [];
    const electionsResult: EntityResult[] = [];

    const companiesResult: EntityResult[] = await Promise.all(
      body.companies.map(async (company, index) => {
        const companyID = companyIDs[index];
        if (!companyID)
          throw new Error(
            `Missing company ID idx=${index}, krs=${company.krs}`,
          );
        return await createEmployment(ctx, personId, company, companyID).catch(
          (e) => {
            console.error("Error creating employment", e);
            return {
              nodeId: companyID,
              krs: company.krs,
              created: false,
              edgeId: undefined,
            };
          },
        );
      }),
    );

    for (const article of assertArray(body.sources, "articles")) {
      articlesResult.push(await createArticle(ctx, personId, article));
    }
    for (const election of assertArray(body.elections, "elections")) {
      const result = await createElection(ctx, personId, election);
      if (!result) continue; // TODO handle missing teryt for sejm etc.
      electionsResult.push(result);
    }

    // Invalidate cache
    await useStorage("cache").clear("nitro:handlers");
    console.info(`Uploaded person ${body.name}`);
    return {
      personId,
      companies: companiesResult,
      articles: articlesResult,
      elections: electionsResult,
      status: "ok",
    };
  } finally {
    await batch.commit();
  }
});

// TODO get rid of this, just use zod,
function assertArray<T>(vs: T[] | undefined, field: string) {
  if (!vs) {
    return [];
  }
  if (!Array.isArray(vs)) {
    throw badRequest(`${field} must be an array`);
  }
  return vs;
}

function badRequest(message: string) {
  return createError({
    statusCode: 400,
    message: message,
  });
}

/** What to store for a person the database already has, or nothing to do.
 *
 * The edges of a re-ingested person were always updated; the person was not.
 * Everything on the node itself - the parties, the Wikipedia link, the
 * rejestr.io link - was written once when the node was created and never
 * again, so a pipeline that learns something new about one of the 6077 people
 * already stored had no way to say so.
 *
 * A payload carries only what the scrapers found, and a revision is written to
 * the node wholesale, so the new fields are layered over what is there rather
 * than replacing it - the same shape the company ingest uses. A field the
 * payload does not mention keeps its stored value; `parties` is a set union,
 * because two runs can each find a different half of somebody's career and
 * neither is a correction of the other.
 *
 * Returns undefined when the payload says nothing the node does not already
 * say, so an unchanged person does not accrue a revision per run.
 *
 * `storedDoc` is the document as the name lookup read it, rather than a fresh
 * read of it, and the fields a revision may not carry are dropped here - what
 * the node owns is carried through the write itself, not restated as data.
 */
function updatedPerson(
  storedDoc: Record<string, unknown>,
  body: PersonRequest,
): Record<string, unknown> | undefined {
  const stored = withoutInternalFields(storedDoc);
  const learned: Record<string, unknown> = {};

  const storedParties = Array.isArray(stored.parties)
    ? (stored.parties as string[])
    : [];
  const parties = [...new Set([...storedParties, ...(body.parties ?? [])])];
  parties.sort();
  if (parties.length > storedParties.length) learned.parties = parties;

  if (body.content) learned.content = body.content;
  if (body.wikipedia) learned.wikipedia = body.wikipedia;
  if (body.rejestrIo) learned.rejestrIo = body.rejestrIo;
  // Filled in, never rewritten. A date of birth does not change, so a stored
  // one is either right or is somebody's correction of what the register says -
  // and unlike `wikipedia` there is no version of this that gets better on the
  // next run. Leaving it alone also keeps a re-ingest from writing a revision
  // per person for a value nobody disputed.
  if (body.birthDate && !stored.birthDate) learned.birthDate = body.birthDate;

  const changed = Object.entries(learned).some(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(stored[key]),
  );
  return changed ? { ...stored, ...learned } : undefined;
}

function createPerson(body: Partial<Person>): Person {
  if (!body.name) throw badRequest("Missing required person name");
  const person: Person = {
    name: body.name,
    type: "person",
    parties: body.parties || [],
  };
  if (body.content) person.content = body.content;
  if (body.wikipedia) {
    person.wikipedia = body.wikipedia;
  }
  if (body.rejestrIo) person.rejestrIo = body.rejestrIo;
  if (body.birthDate) person.birthDate = body.birthDate;
  return person;
}

class Context {
  /** How many edges of each `edgeIdentity` this request has placed so far.
   *
   * A payload routinely carries several ties between the same pair - two spells
   * at one company, two candidacies in one region - and the employments are
   * resolved concurrently. Nothing is committed until the end, so a lookup
   * cannot see what an earlier row just added; counting is what lets the second
   * row be placed as the second edge rather than either colliding with the
   * first or being mistaken for it.
   */
  readonly edgeOccurrences = new Map<string, number>();

  /** Stored edges this request has already matched a payload row onto.
   *
   * Enrichment picks the first stored candidacy that a row could be a
   * better-informed version of, and several rows of one payload routinely have
   * the same candidates - three indistinguishable 2024 bids in one powiat are
   * three candidates for all three rows. Without this the second row would
   * enrich the document the first one just did, and two facts would be written
   * over one.
   */
  readonly claimedEdgeIds = new Set<string>();

  constructor(
    readonly db: FirebaseFirestore.Firestore,
    readonly user: { uid: string },
    readonly batch: FirebaseFirestore.WriteBatch,
    readonly autoapprove: boolean,
  ) {
    this.db = db;
    this.user = user;
    this.batch = batch;
    this.autoapprove = autoapprove;
  }
}

async function createEmployment(
  ctx: Context,
  personId: string,
  employment: EmploymentRequest,
  companyId: string,
): Promise<EntityResult> {
  const edgeData: Edge = {
    type: "employed",
    name: employment.role, // TODO check that the role is always populated
    source: personId,
    target: companyId,
  };
  if (employment.start) edgeData.start_date = employment.start;
  if (employment.end) edgeData.end_date = employment.end;

  const edgeId = await findEdgeOrCreate(ctx, edgeData);

  return {
    nodeId: companyId,
    krs: employment.krs,
    created: false,
    edgeId,
  };
}

async function createArticle(
  ctx: Context,
  personId: string,
  articleURL: string,
): Promise<EntityResult> {
  let articleId = await lookupNode(ctx, "sourceURL", articleURL);

  let created = false;
  if (!articleId) {
    const articleRef = ctx.db.collection("nodes").doc();
    articleId = articleRef.id;
    const revisionData: Article = {
      name: "",
      type: "article",
      sourceURL: articleURL,
    };
    createRevisionTransaction(
      ctx.db,
      ctx.batch,
      ctx.user,
      articleRef,
      revisionData,
      {
        automatic: true,
        approve: ctx.autoapprove,
        published: ctx.autoapprove,
      },
    );
    created = true;
  }

  // Create Edge: Person -> "appears in" -> Article
  const edgeData: Edge = {
    source: personId,
    target: articleId,
    type: "mentions",
  };
  const edgeId = await findEdgeOrCreate(ctx, edgeData);

  return {
    nodeId: articleId,
    created,
    edgeId,
  };
}

// TODO remove it and fix it all the missing codes
const allowedFailingElections: Partial<ElectionRequest>[] = [
  { election_type: "Samorząd", election_year: "1994" },
  { election_type: "Samorząd", election_year: "1998" },
  { election_type: "Sejm", election_year: "1991" },
  { election_type: "Sejm", election_year: "1993" },
  { election_type: "Sejm", election_year: "1997" },
  { election_type: "Sejm", election_year: "2001" },
  { election_type: "Senat", election_year: "1991" },
  { election_type: "Senat", election_year: "1993" },
  { election_type: "Senat", election_year: "1997" },
  { election_type: "Senat", election_year: "2001" },
  { election_type: "Senat", election_year: "2005" },
  { election_type: "Parlament Europejski" },
];

async function lookupRegionId(
  ctx: Context,
  election: ElectionRequest,
): Promise<string | undefined> {
  if (!election.teryt) {
    for (const allowed of allowedFailingElections) {
      if (
        allowed.election_type === election.election_type &&
        (!allowed.election_year ||
          allowed.election_year === election.election_year)
      ) {
        console.info(`Skipping missing region for allowed election`);
        return undefined;
      }
    }

    console.error(`Election without teryt: ${JSON.stringify(election)}`);
    throw new Error(
      "Election without teryt: " +
        election.election_type +
        " " +
        election.election_year,
    );
  }
  const regionId = await lookupNode(ctx, "teryt", election.teryt);
  if (!regionId) throw new Error(`Region not found: ${election.teryt}`);
  return regionId;
}

async function createElection(
  ctx: Context,
  personId: string,
  election: ElectionRequest,
): Promise<EntityResult | undefined> {
  if (!electionPositions.includes(election.election_type)) {
    throw badRequest(
      "Election must have a valid election_type, got: " +
        election.election_type,
    );
  }

  const regionId = await lookupRegionId(ctx, election);
  if (!regionId) {
    return undefined;
  }

  const edgeData: Edge = {
    source: personId,
    target: regionId,
    type: "election",
    name: "kandydatura",
    position: election.election_type as ElectionPosition,
  };
  if (election.party) edgeData.party = election.party;
  // The electoral committee the person stood for. The pipeline has always sent
  // it and the schema has always dropped it, which is why no stored candidacy
  // has one - and why two candidacies in one town in one year are so often
  // indistinguishable. It is the strongest discriminator the payload carries.
  if (election.committee) edgeData.committee = election.committee;
  if (election.election_year) {
    edgeData.start_date = `${election.election_year}-01-01`;
  }

  // Whether a change to a candidacy the database already holds is written out
  // or only proposed. The scrapers set this when the committee is one their
  // curated table names, which is a judgement a human has already made about
  // that exact committee - a candidacy carrying one has nothing left to review.
  // An unrecognised committee is usually a one-gmina KWW and harmless, but it
  // is also where a newly-worded national committee hides, so those wait.
  const edgeId = await findEdgeOrCreate(
    ctx,
    edgeData,
    election.party_from_committee ?? false,
  );
  if (!edgeId) throw new Error("Failed to create edge");
  return {
    nodeId: regionId,
    edgeId,
    created: false,
  };
}

/** Lookup company node IDs for given employment relations.
 *
 * Currently it only uses KRS numbers.
 * Makes sure the companies are already present.
 * If not, fails with 404 with the missing KRS numbers
 *
 * @param db Connection to firestore DB
 * @param companies
 * @returns
 */
async function lookupCompanyIDs(
  ctx: Context,
  employments: EmploymentRequest[],
): Promise<{ companyIDs: string[]; missingKRS: string[] }> {
  const failingLookup: string[] = [];
  const companyIDsUnfiltered: (string | undefined)[] = await Promise.all(
    employments.map(async (employment) => {
      const node = await lookupNode(ctx, "krsNumber", employment.krs);
      if (!node) {
        failingLookup.push(employment.krs);
      }
      return node;
    }),
  );
  return {
    companyIDs: companyIDsUnfiltered.filter(
      (id: string | undefined): id is string => id !== undefined,
    ),
    missingKRS: failingLookup,
  };
}

// TODO move this to general utils
/** Look up a node by the given filtering field and value.
 *
 * @param db
 * @param field
 * @param value
 * @returns
 */
async function lookupNode(
  ctx: Context,
  field: string,
  value: string,
): Promise<string | undefined> {
  return (await lookupNodeDoc(ctx, field, value))?.id;
}

/** The stored node itself, for callers that need more of it than its id. */
async function lookupNodeDoc(
  ctx: Context,
  field: string,
  value: string,
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  const snap = await ctx.db
    .collection("nodes")
    .where(field, "==", value)
    .limit(1)
    .get();
  return snap.empty ? undefined : snap.docs[0];
}

/** The edge recording this fact, creating it if the database has no such edge.
 *
 * Matched on what the edge type says identifies it, not on the pair alone: two
 * spells at the same company are two edges, and the previous `(source, target)`
 * lookup collapsed them - returning an unrelated edge between the same two
 * nodes and quietly dropping the second fact.
 *
 * Where the payload states the same thing twice, that is taken as two facts
 * rather than as a repeat. It has to be: for an `election` the pipeline strips
 * the office, the committee and the run-off round before the ingest sees them,
 * so a burmistrz bid and a rada bid in one town in 2024 arrive as two
 * indistinguishable rows, and keeping only one loses a candidacy. The n-th such
 * row is matched against the n-th stored edge, so re-sending the payload maps
 * each row back onto the edge it made last time and the collection stops at
 * `max(rows in the payload, edges already stored)` - never fewer, never more.
 */
async function findEdgeOrCreate(
  ctx: Context,
  edge: Edge,
  /** Whether a change to an edge that already exists may be written straight
   * out, rather than left for a reviewer. See `createElection`. */
  vouched: boolean = false,
) {
  // Counted before the first await, so the concurrent employments dispatched
  // through Promise.all cannot interleave between the read and the write.
  const identity = edgeIdentity(edge);
  const occurrence = ctx.edgeOccurrences.get(identity) ?? 0;
  ctx.edgeOccurrences.set(identity, occurrence + 1);

  const { same, enrichable, ids } = await findEdgeMatches(ctx.db, edge);

  // Skipping what this request has already taken is what keeps two rows from
  // landing on one document. The query cannot help: nothing is committed until
  // the end, so a row enriched a moment ago still reads back as it was, and a
  // later row carrying less would match it exactly and be silently dropped.
  const existing = same.filter((id) => !ctx.claimedEdgeIds.has(id))[occurrence];
  if (existing) {
    ctx.claimedEdgeIds.add(existing);
    return existing;
  }

  // Nothing says this, but something may say a poorer version of it. Only
  // reachable for an `enrichable` type, and those are resolved in a sequential
  // loop, so the read above cannot interleave with another row's claim the way
  // the concurrent employments would.
  const candidate = enrichable.find((c) => !ctx.claimedEdgeIds.has(c.id));
  if (candidate) {
    ctx.claimedEdgeIds.add(candidate.id);
    const edgeRef = ctx.db.collection("edges").doc(candidate.id);
    const enriched = enrichedEdge(
      withoutInternalFields(candidate.stored),
      edge,
    );

    if (vouched || ctx.autoapprove) {
      createRevisionTransaction(
        ctx.db,
        ctx.batch,
        ctx.user,
        edgeRef,
        enriched,
        {
          automatic: true,
          approve: true,
          // Carried across rather than decided here, so learning a committee
          // neither publishes a candidacy that was awaiting review nor hides one
          // that was live - and does not drop the votes cast on it either.
          stored: candidate.stored,
        },
      );
    } else {
      proposeRevisionTransaction(
        ctx.db,
        ctx.batch,
        ctx.user,
        edgeRef,
        enriched,
        {
          automatic: true,
          // What the edge would assert, not the text it would say it in: PKW
          // writes one committee in whatever case that year's file had, and
          // re-filing the same offer under every spelling is how a review queue
          // fills up with duplicates of itself.
          key: identity,
        },
      );
    }
    return edgeRef.id;
  }

  // A new document, at an id no stored edge already occupies. Normally
  // `occurrence` is enough, but an enriched edge keeps the id it was created
  // under while its fields have moved on, so a later row carrying less can hash
  // straight back onto it - and `createRevisionTransaction` ends in a `set`,
  // which would erase the committee that was just written there.
  let copy = occurrence;
  while (ids.has(edgeDocumentId(edge, copy))) copy++;

  const edgeRef = ctx.db.collection("edges").doc(edgeDocumentId(edge, copy));
  createRevisionTransaction(ctx.db, ctx.batch, ctx.user, edgeRef, edge, {
    automatic: true,
    approve: ctx.autoapprove,
    published: ctx.autoapprove,
  });
  ctx.claimedEdgeIds.add(edgeRef.id);
  return edgeRef.id;
}
