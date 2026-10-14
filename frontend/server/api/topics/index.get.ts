import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { pageIsPublic } from "~~/shared/model";

export type TopicSummary = {
  id: string;
  name: string;
  description?: string;
  /** How many articles are tagged into it, counted on the same terms the
   * caller sees them: drafts included for a signed in reader. */
  articleCount: number;
  published: boolean;
};

/** Every story, with the size of each.
 *
 * One pass over the `tagged` edges rather than a count query per topic - there
 * are far fewer of both than there are articles, and this is the index page.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const includeDrafts = await wantsLatest(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const [topicsSnap, taggedSnap] = await Promise.all([
    db.collection("nodes").where("type", "==", "topic").get(),
    db.collection("edges").where("type", "==", "tagged").get(),
  ]);

  const counts = new Map<string, Set<string>>();
  for (const doc of taggedSnap.docs) {
    const data = doc.data();
    if (data.deleted === true) continue;
    if (!includeDrafts && !pageIsPublic(data)) continue;
    const target = data.target as string | undefined;
    const source = data.source as string | undefined;
    if (!target || !source) continue;
    if (!counts.has(target)) counts.set(target, new Set());
    counts.get(target)!.add(source);
  }

  const topics: TopicSummary[] = topicsSnap.docs
    .filter((doc) => doc.data().deleted !== true)
    .filter((doc) => includeDrafts || pageIsPublic(doc.data()))
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: typeof data.name === "string" ? data.name : "",
        description:
          typeof data.description === "string" ? data.description : undefined,
        articleCount: counts.get(doc.id)?.size ?? 0,
        published: pageIsPublic(data),
      };
    });

  // Biggest story first: the one with the most behind it is the one worth
  // opening, and an empty topic somebody has just created goes last.
  topics.sort(
    (a, b) =>
      b.articleCount - a.articleCount || a.name.localeCompare(b.name, "pl"),
  );

  return { topics };
});
