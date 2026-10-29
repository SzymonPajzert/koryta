import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  admitToQueue,
  getReader,
  queueFor,
} from "~~/server/utils/declarations";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";

/** Crops a request may name as already on the page. The page names none here
 * and at most ten with an answer (`holding`); each one named is a crop the
 * queue reads past, and a list long enough to cover a page of the queue would
 * make every ask read page after page. */
const MAX_EXCLUDED = 10;

/**
 * The crops a reader should read next, for /oswiadczenia: a signed-in reader
 * by their token, one without an account by their browser's reader id
 * (`getReader`). A reader without a vote asks within the day's room for such
 * readers (`admitToQueue`): with no account needed, nothing else stops a
 * stranger asking over and over.
 *
 * `count` (1-5) asks for a few at once, so the page can show the next one
 * the moment an answer is sent; `exclude` names crops the page already holds.
 * Per reader and private, so never cached: a cached answer would hand one
 * reader's queue, and with it which crops they have read, to the next.
 */
export default defineEventHandler(async (event) => {
  const reader = await getReader(event);
  const query = getQuery(event);
  const count = Math.min(5, Math.max(1, Number(query.count) || 1));
  const exclude = new Set(
    String(query.exclude ?? "")
      .split(",")
      .filter((id) => EXTRACT_ID_PATTERN.test(id))
      .slice(0, MAX_EXCLUDED),
  );

  const db = getFirestore(getApp(), "koryta-pl");
  await admitToQueue(db, reader);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return queueFor(db, reader.uid, count, exclude);
});
