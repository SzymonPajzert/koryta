import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { pageIsPublic, type Article } from "~~/shared/model";
import { normalizeUrl } from "~~/shared/url";
import { composedArticleTitle, isUrlShapedName } from "~~/shared/articleTitle";
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

/** The title for an article whose page gave none: who it is filed under and
 * where it is from - see shared/articleTitle.ts.
 *
 * Reads the nodes in `about` for their names, and keeps only the people and
 * companies whose pages are public: the article page is, and its title is no
 * place to name somebody still in draft. */
export async function fallbackArticleTitle(
  db: Firestore,
  url: string,
  about: readonly string[],
): Promise<string> {
  const ids = Array.from(new Set(about)).filter(Boolean);
  const snaps = ids.length
    ? await db.getAll(...ids.map((id) => db.collection("nodes").doc(id)))
    : [];
  const names = snaps
    .map((snap) => snap.data())
    .filter(
      (data) =>
        !!data &&
        (data.type === "person" || data.type === "place") &&
        pageIsPublic(data) &&
        typeof data.name === "string",
    )
    .map((data) => data!.name as string);
  return composedArticleTitle({ url, names });
}

/** The article node for a url, created if it is not there yet.
 *
 * Writes go on the caller's batch so that creating the node and whatever else
 * the caller is recording about the same article commit together.
 *
 * `name` is the page's own title. Without one - or with the address standing
 * in for it, which is what a client from before 2026-11-09 still sends for a
 * source promoted out of a note - the article is titled after the nodes in
 * `about` and the site it is on (`fallbackArticleTitle`), not after its url.
 */
export async function ensureArticleNode(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  article: {
    url: string;
    name?: string;
    publishedDate?: string;
    meta?: unknown;
    /** Who the article is about, for a title when the page gave none. */
    about?: readonly string[];
  },
): Promise<{ nodeId: string; created: boolean }> {
  const existing = await findArticleNodeId(db, article.url);
  if (existing) return { nodeId: existing, created: false };

  const given = article.name?.trim();
  const name =
    given && !isUrlShapedName(given)
      ? given
      : await fallbackArticleTitle(db, article.url, article.about ?? []);

  const articleRef = db.collection("nodes").doc();
  const revisionData: Article = {
    name,
    type: "article",
    sourceURL: article.url,
    meta: article.meta,
    // Fallback timestamp, because /zrodla sorts on it and a Firestore `orderBy`
    // skips the documents that lack the field entirely.
    publishedDate: parseArticleDate(article.publishedDate) ?? Timestamp.now(),
  };

  createRevisionTransaction(db, batch, user, articleRef, revisionData, {
    // TODO don't autoapprove
    approve: true,
    published: true,
  });

  return { nodeId: articleRef.id, created: true };
}
