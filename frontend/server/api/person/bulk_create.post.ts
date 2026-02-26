import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import type {
  Edge,
  Article,
  Company,
  Person,
  ElectionPosition,
} from "~~/shared/model";

type CompanyRequest = {
  name: string;
  krs?: string;
  role?: string;
  start?: string;
  end?: string;
};

type ArticleRequest = {
  url: string;
};

type ElectionRequest = {
  party?: string;
  election_year?: string;
  election_type: ElectionPosition;
  teryt?: string;
};

type Request = {
  name: string;
  content?: string;
  wikipedia?: string;
  rejestrIo?: string;
  companies?: Array<CompanyRequest>;
  articles?: Array<ArticleRequest>;
  elections?: Array<ElectionRequest>;
};

type EntityResult = {
  nodeId: string;
  created: boolean;
  edgeId?: string;
  krs?: string;
};

export default defineEventHandler(async (event) => {
  const bodyUntyped = await readBody(event);
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  // TODO do some checking of the body format - zod should be used here?
  if (!bodyUntyped.name) throw badRequest("Missing required person name");
  const body: Request = bodyUntyped;
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

  for (const company of assertArray(body.companies, "companies")) {
    companiesResult.push(
      await createCompany(db, batch, user, personId, company),
    );
  }
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

async function createCompany(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  personId: string,
  company: CompanyRequest,
): Promise<EntityResult> {
  if (!company.krs) throw badRequest(`Company must have a KRS`);

  let companyId: string | undefined = undefined;
  if (company.krs) companyId = await lookupNode(db, "krs", company.krs);
  if (!companyId) companyId = await lookupNode(db, "name", company.name);

  let created = false;
  if (!companyId) {
    const companyRef = db.collection("nodes").doc();
    companyId = companyRef.id;
    const revisionData: Company = {
      name: company.name,
      type: "place",
    };
    if (company.krs) revisionData.krsNumber = company.krs;
    batch.set(companyRef, revisionData);
    createRevisionTransaction(db, batch, user, companyRef, revisionData);
    created = true;
  }

  const edgeData: Edge = {
    type: "employed",
    name: company.role || "",
    source: personId,
    target: companyId,
  };
  if (company.start) edgeData.start_date = company.start;
  if (company.end) edgeData.end_date = company.end;

  const edgeId = await findEdgeOrCreate(db, batch, user, edgeData);

  return {
    nodeId: companyId,
    krs: company.krs,
    created,
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

async function createElection(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  personId: string,
  election: ElectionRequest,
): Promise<EntityResult | undefined> {
  let regionId: string | undefined = undefined;
  if (!election.teryt) {
    console.error("Election without teryt");
    return undefined;
  }
  regionId = await lookupNode(db, "teryt", election.teryt);

  if (!regionId) throw new Error("Region not found");

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
