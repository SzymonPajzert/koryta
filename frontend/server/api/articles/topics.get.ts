import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { pageIsPublic } from "~~/shared/model";

/** A story an article belongs to, as a list of articles needs it. */
export type ArticleTopicLink = {
  id: string;
  name: string;
  /** Whether both the tag and the topic behind it are live for the public.
   * A draft is drawn differently rather than hidden, the same as on the
   * article's own page. */
  published: boolean;
};

export type ArticleTopics = {
  /** Topics keyed by the id of the article tagged into them. Articles with no
   * tag are absent rather than mapped to an empty list. */
  byArticle: Record<string, ArticleTopicLink[]>;
};

/** Which stories every article belongs to, in one request.
 *
 * `/api/articles/[id]/relations` answers this for one article, which is what
 * the article page needs and what a list of a hundred of them cannot use - it
 * would be a hundred round trips, each reading the article's own edges. There
 * are far fewer `tagged` edges and topics than there are articles, so one pass
 * over both collections is cheaper than any per-article query, and it is the
 * same pass /api/topics already makes to count them.
 *
 * A signed in reader is shown drafts, everyone else only what is published -
 * the same rule as everywhere else a tag is visible.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const includeDrafts = await wantsLatest(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const [topicsSnap, taggedSnap] = await Promise.all([
    db.collection("nodes").where("type", "==", "topic").get(),
    db.collection("edges").where("type", "==", "tagged").get(),
  ]);

  const topics = new Map<string, { name: string; published: boolean }>();
  for (const doc of topicsSnap.docs) {
    const data = doc.data();
    if (data.deleted === true) continue;
    if (!includeDrafts && !pageIsPublic(data)) continue;
    topics.set(doc.id, {
      name: typeof data.name === "string" ? data.name : "",
      published: pageIsPublic(data),
    });
  }

  const byArticle: Record<string, ArticleTopicLink[]> = {};
  for (const doc of taggedSnap.docs) {
    const data = doc.data();
    if (data.deleted === true) continue;
    if (!includeDrafts && !pageIsPublic(data)) continue;
    const source = data.source as string | undefined;
    const target = data.target as string | undefined;
    if (!source || !target) continue;
    // A tag pointing at a topic that is deleted, or is a draft this reader may
    // not see, is not a link anywhere.
    const topic = topics.get(target);
    if (!topic) continue;
    const list = (byArticle[source] ??= []);
    // The same article tagged into the same topic twice is one chip.
    if (list.some((entry) => entry.id === target)) continue;
    list.push({
      id: target,
      name: topic.name,
      published: pageIsPublic(data) && topic.published,
    });
  }

  for (const list of Object.values(byArticle)) {
    list.sort((a, b) => a.name.localeCompare(b.name, "pl"));
  }

  return { byArticle } satisfies ArticleTopics;
});
