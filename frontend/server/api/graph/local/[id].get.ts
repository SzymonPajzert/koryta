import { getLocalGraph } from "~~/server/utils/localGraph";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { getQuery, getRouterParam, type H3Event } from "h3";

async function localGraph(event: H3Event) {
  const query = getQuery(event);
  // Clamped: the url is the reader's to type, and every hop past the second
  // multiplies both the fetch and what lands on the canvas.
  const distance = Math.min(
    Math.max(
      query.distance ? parseInt(query.distance as string, 10) || 1 : 1,
      1,
    ),
    3,
  );
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  let expansions: string[] = [];
  if (query.expand) {
    expansions = (query.expand as string).split(",");
  }

  return getLocalGraph(
    focusNodeId,
    await wantsLatest(event),
    distance,
    expansions,
  );
}

// A signed in reader is the one who may have just added the edge they are
// looking for, and the cache holds a response for six hours - long enough to
// convince somebody their relation was never written. So they read through to
// Firestore, while logged out traffic, which is nearly all of it, still gets
// the cache. This route hand-rolled that first, deciding it from `latest`
// alone, and that is how anybody with curl was drawn the drafts: the decision
// is `editorFreshCachedEventHandler`'s now, and it asks for a token.
export default editorFreshCachedEventHandler(localGraph);
