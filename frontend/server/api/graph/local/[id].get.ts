import { getLocalGraph } from "~~/server/utils/localGraph";
import {
  eventHasUser,
  wantsLatest as callerWantsLatest,
} from "~~/server/utils/handlers";
import { getQuery, getRouterParam, type H3Event } from "h3";

async function localGraph(event: H3Event, showUnapproved: boolean) {
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

  return getLocalGraph(focusNodeId, showUnapproved, distance, expansions);
}

/** The approved-only graph, which is what everybody without a token gets.
 *
 * Written out rather than reusing `authCachedEventHandler` so that
 * `showUnapproved` is decided once, above, and cannot be re-read from the query
 * string inside the cached path. `shouldBypassCache` is false because nothing
 * reaches here that could want bypassing: this wrapper is only ever called for
 * a caller with no verified user.
 */
const cachedLocalGraph = defineCachedEventHandler(
  (event: H3Event) => localGraph(event, false),
  {
    swr: true,
    maxAge: 21600, // 6 hours
    shouldBypassCache: async () => false,
  },
);

export default defineEventHandler(async (event) => {
  // `latest` says what the caller *wants*; the token says what they may have.
  //
  // Both are needed, and conflating them was a hole. `authFetch` appends
  // `latest=true` to every request a signed in reader makes, so it reads like
  // "this is an editor" - but it is an ordinary query parameter that anybody
  // can type, and `getLocalGraph`'s `showUnapproved` argument used to come
  // straight from it. Measured against production on 2026-09-14 with no
  // Authorization header at all: this route returned 63 nodes and no drafts,
  // and `&latest=true` returned 76 nodes and 77 edges including thirteen
  // unpublished people by name. `server/utils/handlers.ts` says the same thing
  // in the abstract - "`latest=true` is a query flag any caller can set, so it
  // is NOT an authorization signal" - and this is the route that was not
  // obeying it.
  //
  // So the draft graph now costs a verified token. `eventHasUser` returns null
  // without a round trip when there is no `Authorization: Bearer` header, and
  // it is only reached when `latest` is present, so logged out traffic - which
  // is nearly all of it - verifies nothing and still shares one cache entry.
  // A logged out caller who asks for `latest` anyway gets the approved-only
  // answer under its own cache key, which is the right thing to fill that key
  // with.
  //
  // The freshness half of the old comment still holds: a signed in reader may
  // have just added the edge they are looking for, and a six hour cache is long
  // enough to convince them it was never written. They read through to
  // Firestore; everybody else is served from the cache.
  if (callerWantsLatest(event) && (await eventHasUser(event))) {
    setResponseHeader(
      event,
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );
    return localGraph(event, true);
  }
  return cachedLocalGraph(event);
});
