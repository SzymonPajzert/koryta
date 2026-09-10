import { getQuery } from "h3";
import type { EventHandler, H3Event } from "h3";
import { getOptionalUser } from "~~/server/utils/auth";

async function eventIsAuthenticated(_event?: H3Event): Promise<boolean> {
  return false;
}

// TODO maybe restore
// import { getUser } from "~~/server/utils/auth";
// async function eventIsAuthenticated(event: H3Event): Promise<boolean> {
//   const user = await getUser(event).catch(() => null);
//   return !!user;
// }

export function authCachedEventHandler<T>(
  handler: EventHandler<EventHandlerRequest, Promise<T>>,
  options = {},
) {
  // 1. Create the cached version of the handler
  const cachedHandler = defineCachedEventHandler(handler, {
    swr: true,
    maxAge: 21600, // 6 hours
    ...options,
    shouldBypassCache: eventIsAuthenticated,
  });

  // 2. Return a master handler that decides which path to take
  return defineEventHandler(async (event: H3Event) => {
    const isAuth = await eventIsAuthenticated(event);
    if (isAuth) {
      // Explicitly prevent browser caching for this response
      setResponseHeader(
        event,
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      return handler(event);
    }

    // Public / Unauthenticated. Use cache.
    return cachedHandler(event);
  });
}

/** Whether this request carries a signed-in reader.
 *
 * `getOptionalUser` rather than `getUser`: these are routes that answer a
 * logged out caller too, so a missing token is an answer and not a 401.
 */
export async function eventHasUser(event: H3Event): Promise<boolean> {
  return !!(await getOptionalUser(event).catch(() => null));
}

/** `authCachedEventHandler`, for a route that must serve a logged out reader
 * something narrower than it serves an editor.
 *
 * A handler cannot make that decision by itself. `authCachedEventHandler`
 * holds one six-hour entry per url and - with `eventIsAuthenticated` stubbed
 * to false above - hands it to everybody, so the first signed-in response
 * would be cached under that url and served to the next crawler. The decision
 * has to happen before the cache is consulted, which is what this does: it
 * resolves the reader, sends a signed-in one to the uncached handler, and puts
 * the answer on `event.context.hasUser` so the handler can narrow what it
 * reads for everyone else. Logged out traffic, which is nearly all of it,
 * still shares one cache entry.
 *
 * Deliberately not a fix to `eventIsAuthenticated` itself: restoring that
 * would verify a token on every request to every endpoint that uses the
 * wrapper, and drop the cache for every signed-in one.
 */
export function readerAwareCachedEventHandler<T>(
  handler: EventHandler<EventHandlerRequest, Promise<T>>,
  options = {},
) {
  const cachedHandler = defineCachedEventHandler(handler, {
    swr: true,
    maxAge: 21600, // 6 hours
    ...options,
    // This wrapper decides before the cache is reached, so the cached path is
    // only ever taken by a caller with no user - there is nothing to bypass.
    shouldBypassCache: async () => false,
  });

  return defineEventHandler(async (event: H3Event) => {
    const hasUser = await eventHasUser(event);
    event.context.hasUser = hasUser;
    if (hasUser) {
      setResponseHeader(
        event,
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      return handler(event);
    }
    return cachedHandler(event);
  });
}

/** Whether the caller asked to be shown what is not approved yet.
 *
 * `authFetch` puts it on every request a signed in reader makes, so it doubles
 * as "this is an editor" - which is the only thing the server can tell about
 * them, `eventIsAuthenticated` above being stubbed out.
 */
export function wantsLatest(event: H3Event): boolean {
  const latest = getQuery(event).latest;
  return latest !== undefined && latest !== "false";
}

/** `authCachedEventHandler`, except that an editor reads through the cache.
 *
 * `eventIsAuthenticated` always answers false, so the wrapper above serves
 * every caller from a cache held for six hours - a signed in one included. That
 * is fine for a page nobody is editing and wrong for everything else: the
 * person who just tagged an article or added a relation is exactly the person
 * whose next request must not be answered from before they did it. Six hours is
 * long enough to convince them the write never happened.
 *
 * /api/graph/local/[id] hand-rolled this first and says the same thing in its
 * own words; anything new should reach for this instead. Logged out traffic,
 * which is nearly all of it, still gets the cache.
 *
 * `editorMaxAge` buys some of the cache back. `latest=true` was meant as an
 * editor's escape hatch, but `authFetch` puts it on *every* request a signed in
 * reader makes (app/composables/auth.ts), so for anyone logged in the hatch is
 * permanently open and none of these handlers is ever cached at all. That cost
 * 111,000 Firestore reads in a 28 hour sample, most of it one person browsing.
 *
 * Set it on a handler where `latest` means "count the drafts too" rather than
 * "show me the row I just wrote": an aggregate over the whole corpus does not
 * visibly move when its author saves one edge, so serving it from a few minutes
 * ago is not the failure the paragraph above describes. Leave it unset - the
 * default - anywhere an editor reads back their own write, which is most
 * places. The editor's answer is cached under its own key either way, because
 * `latest=true` is part of the request URL nitro keys on, so it never collides
 * with the approved-only one the public gets.
 */
export function editorFreshCachedEventHandler<T>(
  handler: EventHandler<EventHandlerRequest, Promise<T>>,
  options: { editorMaxAge?: number } & Record<string, unknown> = {},
) {
  const { editorMaxAge, ...cacheOptions } = options;
  const cachedHandler = authCachedEventHandler(handler, cacheOptions);
  const editorHandler = editorMaxAge
    ? defineCachedEventHandler(handler, {
        ...cacheOptions,
        swr: true,
        maxAge: editorMaxAge,
      })
    : undefined;

  return defineEventHandler(async (event: H3Event) => {
    if (wantsLatest(event)) {
      // `no-store` either way, and set after the handler has resolved so that
      // the `s-maxage` a cached handler emits does not survive it. The server
      // side cache is ours to drop - every write path clears `nitro:handlers` -
      // and Cloud CDN's copy is not, so an editor's answer must never reach it.
      const result = editorHandler
        ? await editorHandler(event)
        : await handler(event);
      setResponseHeader(
        event,
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      return result;
    }
    return cachedHandler(event);
  });
}
