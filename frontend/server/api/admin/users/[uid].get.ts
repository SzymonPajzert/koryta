import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getRouterParam, setResponseHeader } from "h3";
import { requireEstablishedAdmin } from "~~/server/utils/auth";
import {
  buildRowFor,
  cachedLifetimeCounts,
  readAccount,
  readHistory,
  trialOf,
  userLinks,
} from "~~/server/utils/userDirectory";
import type { AdminUserDetail } from "~~/shared/userAdmin";

const uidValidator = z.string().min(1).max(128);

/** One account, opened on /admin/uzytkownicy: its row, everything it did since
 * it was created, what it did on its trial, the history of what was done to
 * it, and where to read more.
 *
 * The lifetime counts are `count()` aggregations memoized for five minutes per
 * account; the history is read fresh, so a nomination made a moment ago is in
 * it. The account is looked up before anything is counted, so a uid that is
 * nobody's is a 404 and never a memo entry.
 */
export default defineEventHandler(async (event): Promise<AdminUserDetail> => {
  await requireEstablishedAdmin(event);

  const parsed = uidValidator.safeParse(
    getRouterParam(event, "uid", { decode: true }),
  );
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: "Brak identyfikatora konta.",
    });
  }
  const uid = parsed.data;

  setResponseHeader(event, "Cache-Control", "private, no-store");

  const account = await readAccount(uid);
  if (!account) {
    throw createError({ statusCode: 404, message: "Nie ma takiego konta." });
  }

  const db = getFirestore("koryta-pl");
  const [row, lifetime, history] = await Promise.all([
    buildRowFor(db, account),
    cachedLifetimeCounts(uid),
    readHistory(db, uid),
  ]);

  return {
    row,
    lifetime,
    trial: await trialOf(row),
    history,
    links: userLinks(row),
  };
});
