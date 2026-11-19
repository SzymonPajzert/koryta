import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getReader, settledWithReader } from "~~/server/utils/declarations";
import type { DeclarationProgress } from "~~/shared/declarations";

/**
 * This reader's part in how far the readers got, for the progress under the
 * form on /oswiadczenia. The page asks once a visit, after the first crop is
 * on screen, and adds what the reader settles from then on itself.
 *
 * A reader without a vote has no part yet, so nothing is read for them: asking
 * costs a stranger nothing here, and a fresh reader id is free.
 *
 * Per reader and private, so never cached.
 */
export default defineEventHandler(async (event) => {
  const reader = await getReader(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return {
    settled: reader.votes
      ? await settledWithReader(getFirestore(getApp(), "koryta-pl"), reader.uid)
      : 0,
    votes: reader.votes,
  } satisfies DeclarationProgress;
});
