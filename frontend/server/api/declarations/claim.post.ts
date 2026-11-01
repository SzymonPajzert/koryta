import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { compareSettled } from "~~/server/utils/declarationSettled";
import { claimAnswers, readerIdOf } from "~~/server/utils/declarations";
import type { DeclarationClaimResult } from "~~/shared/declarations";

const claimSchema = z.object({ readerId: z.string().max(64) });

/** Pages of the publication queue a claim takes up, as an answer does: the
 * page waits for the claim before it serves the account's first crop. */
const PAGES_PER_CLAIM = 1;

/** Crops a claim compares with their pages before it answers. A reader
 * without an account is served the crops a vote short first, so one claim can
 * settle dozens at once; the sweep the job calls after every upload compares
 * the rest. */
const CROPS_COMPARED_PER_CLAIM = 10;

/**
 * The readings a browser made without an account, moved onto the account
 * that has just signed in there (`claimAnswers`): /oswiadczenia sends the
 * browser's reader id once the reader signs in, and forgets the id when this
 * answers. They vote from then on, so the crops they settle are compared with
 * their pages as after an answer (`compareSettled`).
 *
 * A token is required: the answers go to its account. An account whose
 * address nobody confirmed gets a 403 (`claimAnswers`), and the page keeps
 * the id for a later visit: moved now, the answers would never vote. Only
 * where the browser has readings to move, though: for one that only looked,
 * this answers 0 and the page forgets the id.
 *
 * A claim that moved some answers and not others (`left`, a crop whose
 * transaction kept failing) is a 503, after the crops it did settle have been
 * compared: the page keeps the id on any failure, and the next signed-in
 * visit moves the rest. Answered 200, the page would forget the id, and the
 * answers left under it with it.
 *
 * The reader id is the only proof the answers are this reader's, so it never
 * goes to Sentry: not in this body (`PRIVATE_BODIES` in
 * sentry.server.config.ts covers every /api/declarations/ path), nor in the
 * `X-Reader-Id` header the other declaration requests carry it in
 * (`PRIVATE_HEADERS` there). Sent twice, the second claim finds nothing and
 * answers 0.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const body = await readValidatedBody(event, (raw) => claimSchema.parse(raw));
  const readerId = readerIdOf(body.readerId);
  if (!readerId) {
    throw createError({
      statusCode: 400,
      message: "Nieprawidłowy identyfikator czytelnika.",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const { claimed, settled, left } = await claimAnswers(db, {
    readerId,
    user,
  });
  const settledOnDay = settled
    .filter(
      ({ settlement }) =>
        settlement.status === "agreed" && settlement.kind === "date",
    )
    .map(({ extractId }) => extractId);
  await compareSettled(
    event,
    db,
    settledOnDay.slice(0, CROPS_COMPARED_PER_CLAIM),
    PAGES_PER_CLAIM,
  );
  if (left > 0) {
    throw createError({
      statusCode: 503,
      message:
        "Nie wszystkie odczyty z tej przeglądarki przeszły na Twoje konto. Reszta przejdzie przy następnej wizycie.",
    });
  }

  setResponseHeader(event, "Cache-Control", "private, no-store");
  return { claimed, settled: settled.length } satisfies DeclarationClaimResult;
});
