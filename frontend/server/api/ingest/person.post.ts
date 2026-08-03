import { adminFirestore } from "~~/server/utils/firebase";
import { getUser } from "~~/server/utils/auth";
import {
  baseNodeFields,
  createRevisionTransaction,
} from "~~/server/utils/revisions";
import { edgeDocumentId, edgeIdentity, findEdges } from "~~/server/utils/edges";
import { electionPositions } from "~~/shared/misc";
import type { Edge, Article, Person, ElectionPosition } from "~~/shared/model";
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
  const user = await getUser(event);
  const db = adminFirestore();

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
    let personId: string | undefined = await lookupNode(ctx, "name", body.name);
    if (!personId) {
      const personRef = db.collection("nodes").doc();
      personId = personRef.id;
      createRevisionTransaction(
        db,
        batch,
        user,
        personRef,
        createPerson(body),
        true,
        ctx.autoapprove,
      );
    } else {
      const personRef = db.collection("nodes").doc(personId);
      const revision = await updatedPerson(personRef, body);
      if (revision) {
        createRevisionTransaction(
          db,
          batch,
          user,
          personRef,
          revision,
          true,
          ctx.autoapprove,
        );
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
 */
async function updatedPerson(
  personRef: FirebaseFirestore.DocumentReference,
  body: PersonRequest,
): Promise<Record<string, unknown> | undefined> {
  const stored = await baseNodeFields(personRef);
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
      true,
      ctx.autoapprove,
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

  const edgeId = await findEdgeOrCreate(ctx, edgeData);
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
  const snap = await ctx.db
    .collection("nodes")
    .where(field, "==", value)
    .limit(1)
    .get();
  if (!snap.empty) {
    return snap.docs[0]?.id;
  }
  return undefined;
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
async function findEdgeOrCreate(ctx: Context, edge: Edge) {
  // Counted before the first await, so the concurrent employments dispatched
  // through Promise.all cannot interleave between the read and the write.
  const identity = edgeIdentity(edge);
  const occurrence = ctx.edgeOccurrences.get(identity) ?? 0;
  ctx.edgeOccurrences.set(identity, occurrence + 1);

  const stored = await findEdges(ctx.db, edge);
  const existing = stored[occurrence];
  if (existing) return existing;

  const edgeRef = ctx.db
    .collection("edges")
    .doc(edgeDocumentId(edge, occurrence));
  createRevisionTransaction(
    ctx.db,
    ctx.batch,
    ctx.user,
    edgeRef,
    edge,
    true,
    ctx.autoapprove,
  );
  return edgeRef.id;
}
