import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import type { Edge, Node, Article, Company, Person } from "~~/shared/model";

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

type Request = {
  name: string;
  content?: string;
  wikipedia?: string;
  rejestrIo?: string;
  companies?: Array<CompanyRequest>;
  articles?: Array<ArticleRequest>;
};

export default defineEventHandler(async (event) => {
  const bodyUntyped = await readBody(event);
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  // TODO do some checking of the body format - zod should be used here?
  if (!bodyUntyped.name) badRequest("Missing required person name");
  const body: Request = bodyUntyped;
  const batch = db.batch();

  let personId: string | undefined = await lookupNode(db, "name", body.name);
  if (!personId) {
    const personRef = db.collection("nodes").doc();
    personId = personRef.id;
    const revisionData: Person = {
      name: body.name,
      type: "person",
    };
    if (body.content) revisionData.content = body.content;
    if (body.wikipedia) revisionData.wikipedia = body.wikipedia;
    if (body.rejestrIo) revisionData.rejestrIo = body.rejestrIo;

    createRevisionTransaction(db, batch, user, personRef, revisionData);
  }

  // Track results
  const companiesResult: { companyId: string; created: boolean }[] = [];
  const articlesResult: { articleId: string; created: boolean }[] = [];

  // Process Companies
  if (body.companies) {
    if (!Array.isArray(body.companies)) {
      badRequest("Companies must be an array");
    }
    for (const [i, company] of body.companies.entries()) {
      if (!company.name) badRequest(`Company [${i}] must have a name`);
      const result = await createCompany(db, batch, user, personId, company);
      companiesResult.push({ companyId: result[0], created: result[1] });
    }
  }

  // Process Articles
  if (body.articles) {
    if (!Array.isArray(body.articles)) {
      badRequest("Articles must be an array");
    }
    for (const [i, article] of body.articles.entries()) {
      if (!article.url) badRequest(`Article [${i}] must have a URL`);
      const result = await createArticle(db, batch, user, personId, article);
      articlesResult.push({ articleId: result[0], created: result[1] });
    }
  }

  await batch.commit();

  return {
    personId,
    companies: companiesResult,
    articles: articlesResult,
    status: "ok",
  };
});

function badRequest(message: string) {
  throw createError({
    statusCode: 400,
    statusMessage: message,
  });
}

async function createCompany(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  personId: string,
  company: CompanyRequest,
): Promise<[string, boolean]> {
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

  await findEdgeOrCreate(db, batch, user, edgeData);
  return [companyId, created];
}

async function createArticle(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  personId: string,
  article: ArticleRequest,
): Promise<[string, boolean]> {
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
    createRevisionTransaction(db, batch, user, articleRef, revisionData);
    created = true;
  }

  // Create Edge: Person -> "appears in" -> Article
  const edgeData: Edge = {
    source: personId,
    target: articleId,
    type: "mentions",
  };
  await findEdgeOrCreate(db, batch, user, edgeData);
  return [articleId, created];
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
    return snap.docs[0].id;
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
    createRevisionTransaction(db, batch, user, edgeRef, edge);
    return edgeRef.id;
  }
  return edgeSnap.docs[0].id;
}
