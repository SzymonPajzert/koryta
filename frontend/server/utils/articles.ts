import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { Article } from "~~/shared/model";
import { normalizeUrl } from "~~/shared/url";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export function parseArticleDate(
  dateStr: string | undefined,
): Timestamp | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    console.error("Invalid date string:", dateStr);
    return undefined;
  }
  return Timestamp.fromDate(date);
}

/** The article node for a url, if one is already stored.
 *
 * Two passes, because the same article reaches the database written several
 * ways. The exact query is what the common case — re-adding a url someone
 * already added — costs, and it costs one document read. Only when that misses
 * does this fall back to reading the article nodes and comparing them
 * normalized, which is the same trade `/api/ingest/extraction` makes and for
 * the same reason: at a few hundred articles it is cheaper than the alternative
 * of a second stored field, and it is the only thing that matches
 * `https://www.example.pl/a/` against `example.pl/a`.
 */
export async function findArticleNodeId(
  db: Firestore,
  url: string,
): Promise<string | undefined> {
  const exact = await db
    .collection("nodes")
    .where("type", "==", "article")
    .where("sourceURL", "==", url)
    .limit(1)
    .get();
  if (!exact.empty) return exact.docs[0]!.id;

  const wanted = normalizeUrl(url);
  const all = await db
    .collection("nodes")
    .where("type", "==", "article")
    .select("sourceURL")
    .get();
  for (const doc of all.docs) {
    const sourceURL = doc.data().sourceURL as string | undefined;
    if (sourceURL && normalizeUrl(sourceURL) === wanted) return doc.id;
  }
  return undefined;
}

/** The article node for a url, created if it is not there yet.
 *
 * Writes go on the caller's batch so that creating the node and whatever else
 * the caller is recording about the same article commit together.
 */
export async function ensureArticleNode(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  article: {
    url: string;
    name: string;
    publishedDate?: string;
    meta?: unknown;
  },
): Promise<{ nodeId: string; created: boolean }> {
  const existing = await findArticleNodeId(db, article.url);
  if (existing) return { nodeId: existing, created: false };

  const articleRef = db.collection("nodes").doc();
  const revisionData: Article = {
    name: article.name,
    type: "article",
    sourceURL: article.url,
    meta: article.meta,
    publishedDate: parseArticleDate(article.publishedDate),
  };

  createRevisionTransaction(db, batch, user, articleRef, revisionData, {
    // TODO don't autoapprove
    approve: true,
    published: true,
  });

  return { nodeId: articleRef.id, created: true };
}
