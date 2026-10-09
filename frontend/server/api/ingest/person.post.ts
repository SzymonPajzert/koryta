import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  proposeRevisionTransaction,
  revisionChangesNothing,
  withoutInternalFields,
  type ProposalOutcome,
} from "~~/server/utils/revisions";
import {
  addsOnlyAnnotations,
  edgeDocumentId,
  edgeIdentity,
  enrichedEdge,
  findEdgeMatches,
  type EdgeLike,
} from "~~/server/utils/edges";
import {
  edgeRevisions,
  publishCandidateRevision,
  publishEdgeInBatch,
} from "~~/server/utils/edgePublication";
import { resolveMergedNode } from "~~/server/utils/merge";
import { electionPositions, sortParties } from "~~/shared/misc";
import type {
  Edge,
  Article,
  Person,
  ElectionPosition,
  NodeType,
} from "~~/shared/model";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import {
  addsMiddleNames,
  namesAgree,
  withoutDiacritics,
} from "~~/shared/names";
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

    ctx.verifiedEmployments = await verifiedEmployments(
      ctx,
      personDoc,
      body,
      companyIDs,
    );

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
      // Also omitted when there are none, which is the usual case.
      ...(Object.keys(ctx.proposals).length > 0
        ? { proposals: ctx.proposals }
        : {}),
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

  // A set union, so the pipelines can only ever add a party they have found -
  // never silently drop one the register stopped listing. That also means they
  // cannot be allowed near a list somebody curated by hand: a union undoes a
  // removal on the very next run, which is how SLD came back onto a published
  // page an hour after a reviewer took it off. `partiesSource` is the same
  // marker `isPublicSource` is for a company, written by
  // `/api/revisions/create` when a person proposal states `parties`.
  if (stored.partiesSource !== "manual") {
    const storedParties = Array.isArray(stored.parties)
      ? (stored.parties as string[])
      : [];
    // By name with „Inne” last, the order the pipeline sends them in.
    const parties = sortParties(
      new Set([...storedParties, ...(body.parties ?? [])]),
    );
    if (parties.length > storedParties.length) learned.parties = parties;
  }

  if (body.content) learned.content = body.content;
  if (body.wikipedia) learned.wikipedia = body.wikipedia;
  if (body.rejestrIo) learned.rejestrIo = body.rejestrIo;
  // Filled in, never rewritten. A date of birth does not change, so a stored
  // one is either right or is somebody's correction of what the register says -
  // and unlike `wikipedia` there is no version of this that gets better on the
  // next run. Leaving it alone also keeps a re-ingest from writing a revision
  // per person for a value nobody disputed.
  if (body.birthDate && !stored.birthDate) learned.birthDate = body.birthDate;
  // Written into, never rewritten. The pipeline names a person with every given
  // name the register knows, and a page made when it took the shortest spelling
  // instead - "Antoni Sikoń" for Antoni Ignacy Sikoń - stayed short: 492 pages
  // on 2026-10-09, 73 of them live. A name that only adds middle names to the
  // stored one is taken; any other difference is not, since the stored spelling
  // may be a reviewer's and the register's is not the better one by default.
  if (
    typeof stored.name === "string" &&
    addsMiddleNames(body.name, stored.name)
  ) {
    learned.name = body.name;
  }

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

  /** Whether each company the payload names is live, by node id, as the
   * company lookup read it. A relation cannot be live while one of its ends is
   * a draft, so this is what an employment's publication waits on. */
  readonly companyPublished = new Map<string, boolean>();

  /** The person's employment edges as stored, by id - present only when the
   * payload may put the person's jobs on the site without a review. See
   * `verifiedEmployments`. */
  verifiedEmployments: Map<string, FirebaseFirestore.DocumentData> | undefined;

  /** What became of each change this request proposed rather than wrote, by
   * outcome. A night re-sends hundreds of people whose candidacies already
   * have a proposal standing, and "filed 3, 40 already waiting, 2 answered by
   * a reviewer" is what tells a re-send from new work. */
  readonly proposals: Partial<Record<ProposalOutcome, number>> = {};

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

/** The edge one row of `companies` asserts. */
function employmentEdge(
  personId: string,
  employment: EmploymentRequest,
  companyId: string,
): Edge {
  const edgeData: Edge = {
    type: "employed",
    name: employment.role, // TODO check that the role is always populated
    source: personId,
    target: companyId,
  };
  if (employment.start) edgeData.start_date = employment.start;
  if (employment.end) edgeData.end_date = employment.end;
  return edgeData;
}

async function createEmployment(
  ctx: Context,
  personId: string,
  employment: EmploymentRequest,
  companyId: string,
): Promise<EntityResult> {
  const edgeData = employmentEdge(personId, employment, companyId);

  // Both ends have to be live for the relation to be: a company still in
  // draft leaves the job for whoever publishes the company, who reviews its
  // relations in the same dialog.
  const verified =
    ctx.verifiedEmployments !== undefined &&
    ctx.companyPublished.get(companyId) === true;
  const edgeId = await findEdgeOrCreate(ctx, edgeData, false, verified);

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
  // Only a win is written. `false` is what the edit form stores for a box
  // nobody ticked, so an ingested one would claim a named person lost an
  // election PKW may simply have said nothing about - and it says nothing
  // about 70% of the register. See `elected` in shared/api.ts.
  if (election.elected) edgeData.elected = true;
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
 * Whether each company is live goes into `ctx.companyPublished` on the way:
 * the lookup reads the document anyway, so knowing it costs nothing more.
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
      const node = await lookupNodeDoc(ctx, "krsNumber", employment.krs);
      if (!node) {
        failingLookup.push(employment.krs);
        return undefined;
      }
      ctx.companyPublished.set(node.id, pageIsPublic(node.data() ?? {}));
      return node.id;
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
 * 3. Failing that, with a birth date, the name and the date together
 *    (`lookupByNameAndBirthDate`). It is how a person only an odpis names is
 *    found: the pipeline keys them by their PESEL, which never leaves it, and
 *    sends their name and the date the PESEL gives.
 * 4. Failing that, the name - but only onto a page that has *no* register
 *    entry of its own, and no birth date other than the payload's
 *    (`lookupByName`). 880 people predate the pipeline sending an entry, and
 *    refusing to match them would give every one of them a second page on the
 *    next run. The match adopts the entry, so it happens once per person.
 *    A payload with neither an entry nor a page id does not get this far
 *    where it has a birth date: a namesake's page that stores none holds it
 *    back instead (`lookupByNameAndBirthDate`).
 *
 * A page whose register entry is a *different* one is never a match, however
 * the two are spelled. That is the whole of the collapse bug: it is what used
 * to put two strangers who share a name on one page, and let the second of
 * them overwrite the first's `rejestrIo` on the way in.
 *
 * A payload with neither a register entry nor a birth date still matches by
 * the name alone, onto the first page of that exact name whatever it links.
 * Nothing else identifies it, and the pipelines are not the only callers.
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

  if (body.birthDate) return lookupByNameAndBirthDate(ctx, body);
  return lookupByName(ctx, body);
}

/** The first page of the payload's exact name, as the ingest has always
 * matched one: unless it links another register entry than the payload's, or
 * stores a birth date and the payload's is another. */
async function lookupByName(
  ctx: Context,
  body: PersonRequest,
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  const byName = await lookupNodeDoc(ctx, "name", body.name, "person");
  if (!byName) return undefined;

  const stored = byName.data();
  if (
    body.birthDate &&
    stored?.birthDate &&
    stored.birthDate !== body.birthDate
  ) {
    return undefined;
  }
  const storedRegister = stored?.rejestrIo;
  if (!body.rejestrIo || !storedRegister) return byName;
  return storedRegister === body.rejestrIo ? byName : undefined;
}

/** The page of the person of this name born on this day, if the site has it.
 *
 * Read by the date, which few pages share, and narrowed to the ones whose
 * name agrees with the payload's (`namesAgree`): folded, and past a middle
 * name one side writes and the other does not. A page of the name storing
 * another birth date is somebody else - 26 of the people only an odpis named
 * on 2026-10-09 shared a name only with such pages - so the payload gets a
 * page of its own. A page linking another register entry than the payload's
 * is never a match either.
 *
 * Two pages of that name and day are a 409, nothing written: which of them
 * the payload is about is a reviewer's question.
 *
 * Where no page has the day, a payload with a register entry goes on to the
 * name alone (`lookupByName`), the way 447 entries on 2026-10-09 still
 * reached unlinked pages that store no birth date - 103 of them published.
 * One without an entry - somebody only an odpis names - is held back with a
 * 409 instead wherever a page of the name stores no birth date: that page
 * could be theirs or a namesake's, and a wrong guess hangs a stranger's posts
 * on a real page. 191 people on 2026-10-09; 177 of them wait behind linked
 * pages, which learn their date when their own payload next goes out. The
 * pipeline leaves them out before sending (`SiteSnapshot.resolve`), so this is
 * the guard for a page made since the export it read.
 */
async function lookupByNameAndBirthDate(
  ctx: Context,
  body: PersonRequest,
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  const dated = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  const undated = new Set<string>();

  /** Where a page of the name leaves the payload, followed through a merge. */
  async function consider(doc: FirebaseFirestore.DocumentSnapshot) {
    const stored = doc.data();
    if (!isNamesake(stored, body)) return;
    let page: FirebaseFirestore.DocumentSnapshot | undefined = doc;
    if (stored?.merged_into) {
      page = (await resolveMergedNode(ctx.db, doc.id)).snapshot;
    }
    const data = page?.data();
    if (!page || data?.type !== "person") return;
    if (linksAnotherEntry(data.rejestrIo, body.rejestrIo)) return;
    if (!data.birthDate) undated.add(page.id);
    else if (data.birthDate === body.birthDate) dated.set(page.id, page);
  }

  const born = await ctx.db
    .collection("nodes")
    .where("birthDate", "==", body.birthDate)
    .get();
  for (const doc of born.docs) {
    if (doc.data().birthDate === body.birthDate) await consider(doc);
  }
  if (dated.size === 1) return [...dated.values()][0];
  if (dated.size > 1) {
    throw conflict(
      `${body.name}, born ${body.birthDate}: ${dated.size} pages share the name ` +
        `and the date (${[...dated.keys()].join(", ")}); held`,
    );
  }
  if (body.rejestrIo) return lookupByName(ctx, body);

  // Every page of the name, the dated ones again: a merged page found here
  // can stand for a survivor born that day, which the date did not reach.
  for (const doc of await namesakes(ctx, body.name)) await consider(doc);
  if (dated.size === 1 && undated.size === 0) return [...dated.values()][0];
  if (dated.size + undated.size > 0) {
    throw conflict(
      `${body.name}, born ${body.birthDate}: pages of that name store no birth ` +
        `date to tell (${[...undated, ...dated.keys()].join(", ")}); held`,
    );
  }
  return undefined;
}

/** Whether a stored node is a person whose name agrees with the payload's. */
function isNamesake(
  stored: FirebaseFirestore.DocumentData | undefined,
  body: PersonRequest,
): boolean {
  return (
    stored?.type === "person" &&
    typeof stored.name === "string" &&
    namesAgree(stored.name, body.name)
  );
}

/** Whether a page links another register entry than the payload names. */
function linksAnotherEntry(stored: unknown, sent: string | undefined): boolean {
  const page = registerEntry(stored);
  const payload = registerEntry(sent);
  return page !== undefined && payload !== undefined && page !== payload;
}

/** Every node carrying a word the name ends in, as `/api/search` indexes
 * them (`generateChunksLower`): the surname as written and with its Polish
 * letters written plain, so a page typed without them is found too. Wider
 * than the namesakes - a surname is a prefix of longer ones, and companies
 * are indexed alike - so the caller narrows them by the name. */
async function namesakes(
  ctx: Context,
  name: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const surname = name.trim().toLowerCase().split(/\s+/).at(-1);
  if (!surname) return [];
  const spellings = [...new Set([surname, withoutDiacritics(surname)])];
  const snapshot = await ctx.db
    .collection("nodes")
    .where("nameChunksLower", "array-contains-any", spellings)
    .get();
  return snapshot.docs;
}

function conflict(message: string) {
  return createError({ statusCode: 409, message });
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
  /** Whether the relation itself needs no reviewer: a new edge is written
   * approved and live, and a stored one still waiting for its first review is
   * approved and put live as it stands. See `verifiedEmployments`. */
  verified: boolean = false,
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
    if (verified) await approveWaitingEdge(ctx, existing);
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

    // A revision that adds nothing but the result is written out rather than
    // proposed: PKW published the mandate column, so there is no judgement in
    // it for a reviewer to make, and 15,681 stored candidacies are waiting to
    // be told what happened to them. Anything else in the same revision -
    // above all a committee the curated table does not recognise - puts it
    // back on the reviewed path.
    const resultOnly = addsOnlyAnnotations(candidate.stored, edge);
    if (vouched || resultOnly || ctx.autoapprove) {
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
      // A reviewer's answer to this offer stands: the same key is the same
      // ask, so one approved or rejected is left as it is rather than asked
      // again on every send. See `proposeRevisionTransaction`.
      const { outcome } = await proposeRevisionTransaction(
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
      ctx.proposals[outcome] = (ctx.proposals[outcome] ?? 0) + 1;
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
    approve: ctx.autoapprove || verified,
    published: ctx.autoapprove || verified,
  });
  if (verified) {
    console.info(
      `[ingest] approved employment ${edgeRef.id} on its register entry`,
    );
  }
  ctx.claimedEdgeIds.set(edgeRef.id, identity);
  return edgeRef.id;
}

/** The person's stored employments, when this payload may put the person's
 * jobs on the site without a reviewer; undefined when it may not.
 *
 * A person who is already published, and whose page is linked to a register
 * entry, needs nobody to review the jobs that entry lists: the register is the
 * source, and the link is what says the entry is this person. So:
 *
 * 1. The page is live. Publishing a person is a reviewer's decision about who
 *    they are; a draft has had no such decision.
 * 2. The payload is that register entry's: the page's `rejestrIo` names the
 *    payload's entry (`registerEntry`), or the page has none and adopts the
 *    payload's now. A page linking a different entry is never verified,
 *    whatever matched it.
 * 3. The payload restates at least one job the page already shows - the same
 *    company, role and start date as one of its live employments.
 *
 * The third is what makes the second worth anything when the link is new. A
 * page without one gets it from this very request on nothing but a name
 * (`lookupPersonDoc`; `people_merged` sends `korytaId` for a name that fits a
 * single page), and the revision carrying it is approved because the page is
 * live - so "the approved revision has the link" would hold for a namesake as
 * well. That is the case this rule was first asked about: Łukasz Żelewski's
 * page had no register link until the 10-06 run adopted one by name, in the
 * request that added his KGHM seat. What vouched for him was the rest of that
 * payload - four of its seven jobs were on his page already, published since
 * March, and the other three are the ones a reviewer approved by hand within
 * the half hour. A namesake's entry restates nothing a reviewer published, and
 * the right person's nearly always does: of the 970 published pages the 10-06
 * run's payloads reach with the page's own register entry or a new one, 802
 * restate a live job. Of the 572 adopting the link, 135 restate none. Those
 * wait for a reviewer, and once one of their jobs is published the next run
 * takes the rest.
 *
 * The stored employments come back with the answer because they are read for
 * it anyway, and approving a stored edge needs its document.
 *
 * A payload with no register entry - somebody only an odpis names, found by
 * name and birth date - is never verified: the PESEL that identifies them
 * stays in the pipeline, and a name and a date are what a namesake has too.
 */
async function verifiedEmployments(
  ctx: Context,
  personDoc: FirebaseFirestore.DocumentSnapshot | undefined,
  body: PersonRequest,
  companyIDs: string[],
): Promise<Map<string, FirebaseFirestore.DocumentData> | undefined> {
  const stored = personDoc?.data();
  if (!personDoc || !stored || !pageIsPublic(stored)) return undefined;
  if (!body.rejestrIo) return undefined;
  const linked = registerEntry(stored.rejestrIo);
  if (linked && linked !== registerEntry(body.rejestrIo)) return undefined;

  const snapshot = await ctx.db
    .collection("edges")
    .where("source", "==", personDoc.id)
    .where("type", "==", "employed")
    .get();
  const employments = new Map<string, FirebaseFirestore.DocumentData>(
    snapshot.docs.map((doc) => [doc.id, doc.data()]),
  );

  const shown = new Set<string>();
  for (const edge of employments.values()) {
    if (pageIsPublic(edge)) shown.add(edgeIdentity(edge as EdgeLike));
  }
  const restated = body.companies.filter((employment, index) => {
    const companyId = companyIDs[index];
    return (
      companyId !== undefined &&
      shown.has(
        edgeIdentity(employmentEdge(personDoc.id, employment, companyId)),
      )
    );
  }).length;
  if (restated === 0) return undefined;

  console.info(
    `[ingest] ${body.name}: jobs verified by ${body.rejestrIo} (${restated} already published)`,
  );
  return employments;
}

/** The register entry a rejestr.io link names: its number, where it has one.
 *
 * The pipelines send `https://rejestr.io/osoby/<number>`. A link pasted from a
 * browser carries the person's name after the number, or a trailing slash, and
 * 10 published pages store one of those. Read as written, eight of them looked
 * linked to some other entry than the payloads the 10-06 run had for them,
 * which named the very same number. Anything else is compared as written.
 */
function registerEntry(link: unknown): string | undefined {
  if (typeof link !== "string" || !link) return undefined;
  return /rejestr\.io\/osoby\/(\d+)/.exec(link)?.[1] ?? link;
}

/** Approves and publishes a stored employment the payload restates, if it is
 * still waiting for its first review.
 *
 * That is how a job left for a reviewer reaches the site once its person is
 * verified: one sent before this rule existed, or before a reviewer published
 * the job that corroborates the link. Nothing anybody has decided is reopened.
 * A live edge is done with; an approved one that is not live was approved and
 * kept off the site by somebody, or taken off it; a rejected revision is a
 * reviewer's no; and a revision not written automatically is a person's word
 * on the relation. Each of those stays theirs.
 *
 * The newest revision is approved only where the edge already holds it, so
 * what goes live is what the page would show - `publishEdgeInBatch`'s rule for
 * a reviewer, without the audit row an administrator's decision gets. Only the
 * newest: an older revision the edge holds would put the job up past a newer
 * one saying something else, which is a change nobody has looked at.
 */
async function approveWaitingEdge(ctx: Context, edgeId: string) {
  const stored = ctx.verifiedEmployments?.get(edgeId);
  if (!stored) return;
  if (
    pageIsPublic(stored) ||
    stored.deleted === true ||
    approvedRevisionId(stored.revision_id)
  ) {
    return;
  }

  const revisions = await edgeRevisions(ctx.db, edgeId);
  if (
    revisions.some(
      (revision) =>
        revision.status === "rejected" || revision.update_automatic !== true,
    )
  ) {
    return;
  }
  const newest = revisions.slice(0, 1);
  if (!publishCandidateRevision(newest, stored)) return;

  publishEdgeInBatch(
    ctx.db,
    ctx.batch,
    ctx.db.collection("edges").doc(edgeId),
    stored,
    newest,
    ctx.user,
    false,
  );
  console.info(`[ingest] approved waiting employment ${edgeId}`);
}
