import type { EventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";

async function eventIsAuthenticated(event: any): Promise<boolean> {
  const user = await getUser(event).catch(() => null);
  console.log("Checking auth cache for event:", event.path, "User:", !!user);
  return !!user;
}

export const authCachedEventHandler = (handler: EventHandler, options = {}) => {
  // 1. Create the cached version of the handler
  const cachedHandler = defineCachedEventHandler(handler, {
    swr: true,
    maxAge: 60, // 1 minute
    ...options,
    shouldBypassCache: eventIsAuthenticated,
  });

  // 2. Return a master handler that decides which path to take
  return defineEventHandler(async (event) => {
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
};
