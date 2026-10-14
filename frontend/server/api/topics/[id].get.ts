import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { articleIdsForTopic } from "~~/server/utils/topics";
import { pageIsPublic } from "~~/shared/model";
import type { Topic } from "~~/shared/model";

export type TopicArticle = {
  id: string;
  name: string;
  sourceURL?: string;
  publishedDate?: string | null;
  /** Whether the `tagged` edge putting this article in the story is approved,
   * as opposed to a draft only signed in readers are shown. */
  taggedPublished: boolean;
};

export type TopicDetail = {
  topic: Topic & { id: string };
  articles: TopicArticle[];
};

/** One story: what it is called, and what is in it. */
export default editorFreshCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = await wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const topicSnap = await db.collection("nodes").doc(id).get();
  const topicData = topicSnap.data();

  if (!topicSnap.exists || topicData?.type !== "topic") {
    throw createError({ statusCode: 404, message: "Nie ma takiego tematu." });
  }
  if (!includeDrafts && !pageIsPublic(topicData)) {
    throw createError({ statusCode: 404, message: "Temat nieopublikowany." });
  }

  // Both passes, so that a draft tag can be told apart from an approved one on
  // the page rather than merely being absent.
  const [approvedIds, allIds] = await Promise.all([
    articleIdsForTopic(db, id, false),
    includeDrafts
      ? articleIdsForTopic(db, id, true)
      : Promise.resolve<string[]>([]),
  ]);
  const approved = new Set(approvedIds);
  const wanted = includeDrafts ? allIds : approvedIds;

  const snaps = wanted.length
    ? await db.getAll(
        ...wanted.map((articleId) => db.collection("nodes").doc(articleId)),
      )
    : [];

  const articles: TopicArticle[] = snaps
    .filter((snap) => snap.exists && snap.data()?.type === "article")
    .filter((snap) => includeDrafts || pageIsPublic(snap.data() ?? {}))
    .map((snap) => {
      const data = snap.data() ?? {};
      const date = data.publishedDate;
      return {
        id: snap.id,
        name: typeof data.name === "string" ? data.name : "",
        sourceURL:
          typeof data.sourceURL === "string" ? data.sourceURL : undefined,
        // A Firestore Timestamp does not survive JSON, so it is sent as ISO.
        publishedDate: date?.toDate ? date.toDate().toISOString() : null,
        taggedPublished: approved.has(snap.id),
      };
    })
    .sort((a, b) =>
      (b.publishedDate ?? "").localeCompare(a.publishedDate ?? ""),
    );

  return {
    topic: { id: topicSnap.id, ...topicData } as Topic & { id: string },
    articles,
  } satisfies TopicDetail;
});
