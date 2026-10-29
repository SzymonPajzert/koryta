import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { queueFor, requireCountedReader } from "~~/server/utils/declarations";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";

/**
 * The crops a signed-in reader should read next, for /oswiadczenia.
 *
 * `count` (1-5) asks for a few at once, so the page can show the next one
 * the moment an answer is sent; `exclude` names crops the page already holds.
 * Per reader and private, so never cached: a cached answer would hand one
 * reader's queue, and with it which crops they have read, to the next.
 */
export default defineEventHandler(async (event) => {
  const user = requireCountedReader(await getUser(event));
  const query = getQuery(event);
  const count = Math.min(5, Math.max(1, Number(query.count) || 1));
  const exclude = new Set(
    String(query.exclude ?? "")
      .split(",")
      .filter((id) => EXTRACT_ID_PATTERN.test(id)),
  );

  setResponseHeader(event, "Cache-Control", "private, no-store");
  return queueFor(
    getFirestore(getApp(), "koryta-pl"),
    user.uid,
    count,
    exclude,
  );
});
