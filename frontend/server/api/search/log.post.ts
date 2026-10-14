import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { getOptionalUser } from "~~/server/utils/auth";
import { SEARCH_PICK_KINDS } from "~~/shared/analytics";
import { RETENTION_DAYS, SEARCHES_COLLECTION } from "~~/shared/searchLog";
import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  SEARCH_OUTCOMES,
  normaliseQuery,
} from "~~/shared/searchSession";
import { OPS_DATABASE } from "~~/shared/tasks";

const DAY_MS = 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  // Room for what normalising takes out; what is kept is capped below.
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH * 2),
  results: z.number().int().min(0).max(1000),
  unverified: z.number().int().min(0).max(1000),
  outcome: z.enum(SEARCH_OUTCOMES),
  picked: z.enum(SEARCH_PICK_KINDS).optional(),
  pickedUnverified: z.boolean().optional(),
});

/** Keeps one settled search from the search box - see `shared/searchSession.ts`
 * for what a settled search is, and `shared/searchLog.ts` for why the site
 * keeps its own copy beside Plausible's.
 *
 * Open to anybody, as the search box is, and it stores nothing about who
 * asked: no uid, no address, no user agent. Whether somebody was signed in is
 * the one thing about them it notes, and it works that out from the token
 * rather than taking the browser's word for it.
 */
export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: "Invalid search entry" });
  }
  const entry = parsed.data;
  const query = normaliseQuery(entry.query);
  if (query.length < MIN_QUERY_LENGTH) return { recorded: false };

  const signedIn = !!(await getOptionalUser(event).catch(() => null));
  const now = Date.now();
  await getFirestore(OPS_DATABASE)
    .collection(SEARCHES_COLLECTION)
    .add({
      query,
      results: entry.results,
      // Never more than the hits there were, whatever the browser says.
      unverified: Math.min(entry.unverified, entry.results),
      outcome: entry.outcome,
      ...(entry.outcome === "pick" && entry.picked
        ? {
            picked: entry.picked,
            pickedUnverified: entry.pickedUnverified === true,
          }
        : {}),
      signedIn,
      at: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + RETENTION_DAYS * DAY_MS),
    });
  return { recorded: true };
});
