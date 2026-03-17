import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import { electionPositions } from "~~/shared/misc";
import type { Edge, Article, Person } from "~~/shared/model";
import {
  personRequestSchema,
  type EntityResult,
  type ElectionRequest,
  type EmploymentRequest,
  type ArticleRequest,
  type PersonRequest,
} from "#shared/api";

export default defineEventHandler(async (event) => {
  const body: PersonRequest = await readValidatedBody(event, (body) =>
    personRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const companyIDs = await lookupCompanyIDs(db, body.companies);

  const batch = db.batch();

  let personId: string | undefined = await lookupNode(db, "name", body.name);
  if (!personId) {
    const personRef = db.collection("nodes").doc();
    personId = personRef.id;
    const personData = createPerson(body);
    batch.set(personRef, personData);
    createRevisionTransaction(db, batch, user, personRef, personData);
  }

  // Track results
  const companiesResult: EntityResult[] = [];
  const articlesResult: EntityResult[] = [];
  const electionsResult: EntityResult[] = [];

  body.companies.forEach(async (company, index) => {
    const companyID = companyIDs[index];
    if (!companyID)
      throw new Error(`Missing company ID idx=${index}, krs=${company.krs}`);
    companiesResult.push(
      await createEmployment(db, batch, user, personId, company, companyID),
    );
  });

  for (const article of assertArray(body.articles, "articles")) {
    articlesResult.push(
      await createArticle(db, batch, user, personId, article),
    );
  }
  for (const election of assertArray(body.elections, "elections")) {
    const result = await createElection(db, batch, user, personId, election);
    if (!result) continue; // TODO handle missing teryt for sejm etc.
    electionsResult.push(result);
  }

  await batch.commit();

  // Invalidate cache
  await useStorage("cache").clear("nitro:handlers");
  console.log("Invalidated cache");

  return {
    personId,
    companies: companiesResult,
    articles: articlesResult,
    elections: electionsResult,
    status: "ok",
  };
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

function createPerson(body: Partial<Person>): Person {
  if (!body.name) throw badRequest("Missing required person name");
  const person: Person = {
    name: body.name,
    type: "person",
  };
  if (body.content) person.content = body.content;
  if (body.wikipedia) person.wikipedia = body.wikipedia;
  if (body.rejestrIo) person.rejestrIo = body.rejestrIo;
  return person;
}

async function createEmployment(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
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

  const edgeId = await findEdgeOrCreate(db, batch, user, edgeData);

  return {
    nodeId: companyId,
    krs: employment.krs,
    created: false,
    edgeId,
  };
}

async function createArticle(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  personId: string,
  article: ArticleRequest,
): Promise<EntityResult> {
  if (!article.url) throw badRequest(`Article must have a URL`);

  let articleId: string | undefined = undefined;
  articleId = await lookupNode(db, "sourceURL", article.url);

  let created = false;
  if (!articleId) {
    const articleRef = db.collection("nodes").doc();
    articleId = articleRef.id;
    const revisionData: Article = {
      name: article.url,
      type: "article",
      sourceURL: article.url,
    };
    batch.set(articleRef, revisionData);
    createRevisionTransaction(db, batch, user, articleRef, revisionData);
    created = true;
  }

  // Create Edge: Person -> "appears in" -> Article
  const edgeData: Edge = {
    source: personId,
    target: articleId,
    type: "mentions",
  };
  const edgeId = await findEdgeOrCreate(db, batch, user, edgeData);

  return {
    nodeId: articleId,
    created,
    edgeId,
  };
}

const allowedFailingElections: Partial<ElectionRequest>[] = [
  { election_type: "Samorząd", election_year: "1998" },
  { election_type: "Samorząd", election_year: "1994" },
  { election_type: "Sejm", election_year: "2001" },
  { election_type: "Sejm", election_year: "1993" },
  { election_type: "Sejm", election_year: "1991" },
  { election_type: "Sejm", election_year: "1997" },
  { election_type: "Senat", election_year: "2005" },
  // TODO remove it and fix it all of the above
  { election_type: "Parlament Europejski" },
];

async function lookupRegionId(
  db: FirebaseFirestore.Firestore,
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
  const regionId = await lookupNode(db, "teryt", election.teryt);
  if (!regionId) throw new Error(`Region not found: ${election.teryt}`);
  return regionId;
}

async function createElection(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  personId: string,
  election: ElectionRequest,
): Promise<EntityResult | undefined> {
  if (!electionPositions.includes(election.election_type)) {
    throw badRequest(
      "Election must have a valid election_type, got: " +
        election.election_type,
    );
  }

  const regionId = await lookupRegionId(db, election);
  if (!regionId) {
    return undefined;
  }

  const edgeData: Edge = {
    source: personId,
    target: regionId,
    type: "election",
    name: "kandydatura",
  };
  if (election.party) edgeData.party = election.party;
  if (election.election_year) {
    edgeData.start_date = `${election.election_year}-01-01`;
  }

  const edgeId = await findEdgeOrCreate(db, batch, user, edgeData);
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
  db: FirebaseFirestore.Firestore,
  employments: EmploymentRequest[],
): Promise<string[]> {
  const failingLookup: string[] = [];
  const companyIDsUnfiltered: (string | undefined)[] = await Promise.all(
    employments.map(async (employment) => {
      const node = await lookupNode(db, "krsNumber", employment.krs);
      if (!node) {
        failingLookup.push(employment.krs);
      }
      return node;
    }),
  );
  if (failingLookup.length > 0) {
    throw createError({
      statusCode: 404,
      message: `Missing companies: ${failingLookup.join(", ")}`,
      data: failingLookup,
    });
  }
  return companyIDsUnfiltered.filter(
    (id: string | undefined): id is string => id !== undefined,
  );
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
  db: FirebaseFirestore.Firestore,
  field: string,
  value: string,
): Promise<string | undefined> {
  const snap = await db
    .collection("nodes")
    .where(field, "==", value)
    .limit(1)
    .get();
  if (!snap.empty) {
    return snap.docs[0]?.id;
  }
  return undefined;
}

async function findEdgeOrCreate(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  edge: Edge,
) {
  const edgeSnap = await db
    .collection("edges")
    .where("source", "==", edge.source)
    .where("target", "==", edge.target)
    .limit(1)
    .get();

  if (edgeSnap.empty) {
    const edgeRef = db.collection("edges").doc();
    batch.set(edgeRef, edge);
    createRevisionTransaction(db, batch, user, edgeRef, edge);
    return edgeRef.id;
  }
  return edgeSnap.docs[0]?.id;
}
