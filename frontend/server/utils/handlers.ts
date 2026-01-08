import type { EventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";

export const authCachedEventHandler = (handler: EventHandler, options = {}) => {
  return defineCachedEventHandler(handler, {
    ...options,
    swr: true,
    maxAge: 60,
    shouldBypassCache: async (event) => {
      const user = await getUser(event).catch(() => null);
      if (user) {
        console.log(`Bypassing cache for path ${event.req.url}`);
      }
      return !!user;
    },
  });
};
