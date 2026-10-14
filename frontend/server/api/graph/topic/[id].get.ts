import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { GraphLayout } from "~~/shared/graph/util";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { articleIdsForTopic } from "~~/server/utils/topics";
import { graphForArticles } from "~~/server/utils/articleGraph";
import type { H3Event } from "h3";

/** The people in a story, and the networks they sit in.
 *
 * The topic's `tagged` edges give the articles, and `graphForArticles` turns
 * those into who is in the story - the same step /api/graph/article/[id] takes
 * for one article on its own, summed over every article tagged into the topic.
 *
 * Expanded around every person rather than only the ones an article names.
 * Across a dozen articles most people arrive at the end of a relation citing
 * one of them, and those were drawn as bare dots: the affair was a list of
 * names with no sense of where any of them sit. It costs a much bigger graph,
 * which is the trade a story is worth.
 */
async function topicGraph(event: H3Event): Promise<GraphLayout> {
  const topicId = getRouterParam(event, "id");
  if (!topicId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = await wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const articleIds = await articleIdsForTopic(db, topicId, includeDrafts);
  return graphForArticles(db, articleIds, includeDrafts, {
    expand: "people",
  });
}

// Whoever is signed in is the one who may have just tagged the article they are
// looking for, so they read through the six hour cache. See the helper.
export default editorFreshCachedEventHandler(topicGraph);
