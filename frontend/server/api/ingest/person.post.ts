import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  proposeRevisionTransaction,
  revisionChangesNothing,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import {
  edgeDocumentId,
  edgeIdentity,
  enrichedEdge,
  findEdgeMatches,
} from "~~/server/utils/edges";
import { resolveMergedNode } from "~~/server/utils/merge";
import { electionPositions } from "~~/shared/misc";
import type {
  Edge,
  Article,
  Person,
  ElectionPosition,
  NodeType,
} from "~~/shared/model";
import { pageIsPublic } from "~~/shared/model";
import {
  personRequestSchema,
  type EntityResult,
  type ElectionRequest,
  type EmploymentRequest,
  type PersonRequest,
  type UnplacedElection,
} from "#shared/api";

export default defineEventHandler(async (event) => {
  const body: PersonRequest = await readValidatedBody(event, (body) =>
    personRequestSchema.parse(body),
  );
  const user = requireDatascience(await getUser(event));
  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();
  const ctx = new Context(db, user, batch, body.autoapprove ?? false);

  /** What the request did to the person node itself. The edges are reported
   * per company and per election; this is the node. */
  let person: "created" | "updated" | "unchanged" = "unchanged";

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
    const personDoc = await lookupPersonDoc(ctx, body);
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
      person = "created";
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
        const options = {
          automatic: true,
          // A live page's node is a copy of an approved revision, so an update
          // to one has to be approved with it or the page would show data no
          // reviewer ever accepted.
          approve: ctx.autoapprove || published,
          stored,
        };
        // `updatedPerson` decides what the payload has to teach the node, and
        // this decides whether saying it would change the document at all - a
        // narrower question, and the one that governs whether a write is worth
        // making. Two answers rather than one because they are about different
        // things: the first is where `parties` become a union and a blank field
        // in the payload is not a deletion, the second covers the bookkeeping
        // the node owns and the write would restate.
        if (!revisionChangesNothing(personRef, revision, options)) {
          createRevisionTransaction(
            db,
            batch,
            user,
            personRef,
            revision,
            options,
          );
          person = "updated";
        }
      }
    }

    // Track results
    const articlesResult: EntityResult[] = [];
    const electionsResult: EntityResult[] = [];
    const unplacedElections: UnplacedElection[] = [];

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
      // Per candidacy, the way the employments above are handled per company.
      // A payload is a person, not a transaction: whatever the site cannot
      // make sense of is one relation, and the rest of the person still goes
      // in. Everything dropped comes back in `unplacedElections`.
      const outcome = await createElection(ctx, personId, election).catch(
        (e) => {
          console.error("Error creating candidacy", e);
          return { unplaced: unplaced(election, "rejected", false) };
        },
      );
      if ("placed" in outcome) {
        electionsResult.push(outcome.placed);
      } else {
        unplacedElections.push(outcome.unplaced);
      }
    }

    // Invalidate cache
    await useStorage("cache").clear("nitro:handlers");
    console.info(`Uploaded person ${body.name}`);
    return {
      personId,
      person,
      companies: companiesResult,
      articles: articlesResult,
      elections: electionsResult,
      // Omitted when there are none, so the ordinary response is unchanged.
      // A caller uploading a region wants the total rather than the list, but
      // the list is what makes a total worth anything: 300 candidacies from
      // the 1990s is the shape of the data, and 300 from 2024 is a bug.
      ...(unplacedElections.length > 0 ? { unplacedElections } : {}),
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

  /** Stored edges this request has already matched a payload row onto, and the
   * `edgeIdentity` of the row that took each.
   *
   * Enrichment picks the first stored candidacy that a row could be a
   * better-informed version of, and several rows of one payload routinely have
   * the same candidates - three indistinguishable 2024 bids in one powiat are
   * three candidates for all three rows. Without this the second row would
   * enrich the document the first one just did, and two facts would be written
   * over one.
   *
   * The identity, not just the id, because the exact-match path in
   * `findEdgeOrCreate` has to tell "taken by a row saying something else" from
   * "taken by an earlier row saying exactly this". Only the first excludes an
   * edge; the second is already counted by `edgeOccurrences`, and subtracting
   * it twice is what wrote a duplicate.
   */
  readonly claimedEdgeIds = new Map<string, string>();

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

/** Elections whose candidacies the scrapers cannot place, and never will.
 *
 * PKW published no constituency mapping for these that `candidacy_teryt` can
 * resolve, so a candidacy from one of them arrives without a `teryt` every
 * time. They are dropped like any other unplaceable candidacy; the list is
 * what tells a reader which drops are the permanent ones and which are worth
 * looking into.
 *
 * It used to do more than that. A candidacy outside this list threw, and the
 * throw escaped the handler - so one 2010 samorząd row PKW had filed without a
 * constituency cost the whole person: their node, their employments and every
 * candidacy after it in the payload. `--company-category szpitale
 * --currently-employed` is a run about board seats, and it was failing on
 * candidacies nobody had asked it for.
 */
const expectedMissingRegion: Partial<ElectionRequest>[] = [
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

function isExpectedMissingRegion(election: ElectionRequest): boolean {
  return expectedMissingRegion.some(
    (allowed) =>
      allowed.election_type === election.election_type &&
      (!allowed.election_year ||
        allowed.election_year === String(election.election_year)),
  );
}

/** What to report about a candidacy that is not going to be written. */
function unplaced(
  election: ElectionRequest,
  reason: UnplacedElection["reason"],
  expected: boolean,
): UnplacedElection {
  const record: UnplacedElection = {
    election_type: election.election_type,
    reason,
    expected,
  };
  if (election.election_year) record.election_year = election.election_year;
  if (election.teryt) record.teryt = election.teryt;
  return record;
}

/** Either the candidacy that was written, or a note of why none was. */
type ElectionOutcome =
  { placed: EntityResult } | { unplaced: UnplacedElection };

async function createElection(
  ctx: Context,
  personId: string,
  election: ElectionRequest,
): Promise<ElectionOutcome> {
  if (!electionPositions.includes(election.election_type)) {
    // Unreachable through the endpoint as things stand - `election_type` is a
    // zod enum and `electionPositions` currently lists the same eleven - but
    // the two are separate declarations and this is the one place that would
    // notice them drifting. Reported like any other unusable row rather than
    // failing the person, which is what it used to do.
    console.warn(
      `Election type the site does not have: ${election.election_type}`,
    );
    return { unplaced: unplaced(election, "rejected", false) };
  }

  if (!election.teryt) {
    const expected = isExpectedMissingRegion(election);
    if (!expected) {
      console.warn(
        `Election without teryt: ${election.election_type} ${election.election_year ?? "?"}`,
      );
    }
    return { unplaced: unplaced(election, "no-teryt", expected) };
  }
  const regionId = await lookupNode(ctx, "teryt", election.teryt);
  if (!regionId) {
    // 985 gminy have a region node because they own something; a code that
    // resolves to none is one `RegionPayloads` has not reached yet, and it
    // will be there on a later run.
    console.warn(
      `No region node for TERYT ${election.teryt} (${election.election_type} ${election.election_year ?? "?"})`,
    );
    return { unplaced: unplaced(election, "no-region", false) };
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
  if (!edgeId) {
    console.error(
      `Failed to place ${election.election_type} ${election.election_year ?? "?"} in ${regionId}`,
    );
    return { unplaced: unplaced(election, "rejected", false) };
  }
  return {
    placed: {
      nodeId: regionId,
      edgeId,
      created: false,
    },
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

/** The stored node itself, for callers that need more of it than its id.
 *
 * `type` is part of every lookup because a name is not unique across kinds: an
 * article titled "Pawe\u0142 Obermeyer" - his facebook page - is stored beside the
 * person of that name, and an equality query with `limit(1)` and no ordering
 * would hand back whichever of them Firestore reached first. Four such pairs
 * were live when this was written, and matching one of them would have written
 * a person's parties onto an article.
 *
 * A merge is followed the same way the `korytaId` branch below follows one. A
 * tombstone keeps the `name` and the `rejestrIo` that got it matched here - it
 * has to, they are the record of what the page was - so with 171 of them
 * stored, a lookup can perfectly well land on the page a merge took out of use
 * while the survivor sits one document further down the same equality query.
 * `limit(1)` does not choose between them and nothing orders the two, so
 * without this a re-ingest writes the person's jobs onto the tombstone: hidden
 * from every reader, and missing from the page that replaced it.
 */
async function lookupNodeDoc(
  ctx: Context,
  field: string,
  value: string,
  type?: NodeType,
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  let query = ctx.db.collection("nodes").where(field, "==", value);
  if (type) query = query.where("type", "==", type);
  const snap = await query.limit(1).get();
  const doc = snap.docs[0];
  if (!doc) return undefined;
  if (!doc.data().merged_into) return doc;

  const { snapshot } = await resolveMergedNode(ctx.db, doc.id);
  if (!snapshot?.exists) return undefined;
  // Type-checked on the way out for the same reason the `korytaId` branch does
  // it: the survivor is a document this query never filtered.
  if (type && snapshot.data()?.type !== type) return undefined;
  return snapshot;
}

/** The person this payload is about, if the site already has them.
 *
 * The name is not the identity and never was. The pipeline picks it out of a
 * `list_distinct` whose order is a hash, so the same human is "Andrzej
 * Golimont" one run and "Andrzej Marcin Golimont" the next; matching on it
 * exactly filed 170 people under two pages each, and matching on it loosely
 * would file two Micha\u0142 Nowaks under one. `rejestrIo` is the identity - one
 * register entry is one human - and the payload has carried it all along.
 *
 * So, in order:
 *
 * 1. `korytaId`, where the payload carries one: the page's own id, read
 *    directly. `people_merged` sends it only where it matched a page without
 *    having to choose between two, so it is not a guess this has to second-
 *    guess - and it is the one identifier that works for the 868 people with no
 *    register entry at all. Followed through `merged_into`, because a page
 *    merged away since the export the pipeline read is not a page to write to.
 * 2. The register entry. Exact, and enough: two spellings of one entry are one
 *    person whatever they are called.
 * 3. Failing that, the name - but only onto a page that has *no* register entry
 *    of its own. 880 people predate the pipeline sending one, and refusing to
 *    match them would give every one of them a second page on the next run. The
 *    match adopts the entry, so it happens once per person.
 * 4. A page whose register entry is a *different* one is not a match, however
 *    the two are spelled. That is the whole of the collapse bug: it is what
 *    used to put two strangers who share a name on one page, and let the second
 *    of them overwrite the first's `rejestrIo` on the way in.
 *
 * A payload with neither id still matches by name alone. Nothing else
 * identifies it, and the pipelines are not the only callers.
 */
async function lookupPersonDoc(
  ctx: Context,
  body: PersonRequest,
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  if (body.korytaId) {
    const { snapshot } = await resolveMergedNode(ctx.db, body.korytaId);
    // Type-checked like every other lookup here: an id that has come to name a
    // company since the export would otherwise take a person's parties.
    if (snapshot?.exists && snapshot.data()?.type === "person") return snapshot;
    console.info(
      `[ingest] korytaId ${body.korytaId} names no person; falling back`,
    );
  }

  if (body.rejestrIo) {
    const byRegister = await lookupNodeDoc(
      ctx,
      "rejestrIo",
      body.rejestrIo,
      "person",
    );
    if (byRegister) return byRegister;
  }

  const byName = await lookupNodeDoc(ctx, "name", body.name, "person");
  if (!byName) return undefined;

  const storedRegister = byName.data()?.rejestrIo;
  if (!body.rejestrIo || !storedRegister) return byName;
  return storedRegister === body.rejestrIo ? byName : undefined;
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

  // The n-th row of this identity onto the n-th stored edge that says it, out
  // of those no *other* identity has taken.
  //
  // Both halves are needed and they are about different collisions. Skipping
  // what another row has taken is what stops a bare row re-taking the candidacy
  // an earlier row just enriched: nothing is committed until the end, so the
  // enriched edge still reads back bare and matches exactly. Counting by
  // `occurrence` is what tells two rows of the *same* identity apart, and it
  // has to be the counter rather than the claim, because the employments are
  // dispatched through `Promise.all` and both would read the pool before either
  // wrote to it.
  //
  // Applying both to one list was the bug: a same-identity claim advanced the
  // position once by being counted and again by being filtered, so two
  // identical rows against two identical stored edges took the first, skipped
  // the second and wrote a duplicate. Matching k rows needed 2k-1 stored edges.
  // Round-tripping the 31 August export found 826 identity groups with a
  // repeat, across 605 people, that a re-upload would have grown by 839 edges
  // before settling.
  const existing = same.filter(
    (id) => (ctx.claimedEdgeIds.get(id) ?? identity) === identity,
  )[occurrence];
  if (existing) {
    ctx.claimedEdgeIds.set(existing, identity);
    return existing;
  }

  // Nothing says this, but something may say a poorer version of it. Only
  // reachable for an `enrichable` type, and those are resolved in a sequential
  // loop, so the read above cannot interleave with another row's claim the way
  // the concurrent employments would.
  const candidate = enrichable.find((c) => !ctx.claimedEdgeIds.has(c.id));
  if (candidate) {
    ctx.claimedEdgeIds.set(candidate.id, identity);
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
  ctx.claimedEdgeIds.set(edgeRef.id, identity);
  return edgeRef.id;
}
