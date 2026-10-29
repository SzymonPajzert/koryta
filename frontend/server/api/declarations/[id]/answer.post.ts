import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { H3Event } from "h3";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { matchAndDrain } from "~~/server/utils/declarationPublish";
import {
  queueFor,
  recordAnswer,
  requireCountedReader,
} from "~~/server/utils/declarations";
import {
  answerVerdicts,
  EXTRACT_ID_PATTERN,
  parseTypedDate,
  publishLimitOf,
  type DeclarationAnswerResult,
} from "~~/shared/declarations";

const answerSchema = z
  .object({
    verdict: z.enum(answerVerdicts),
    value: z.string().max(20).nullable().optional(),
    name: z.string().max(200).nullable().optional(),
    /** Crops the page already holds, so the queue sent back skips them. */
    holding: z.array(z.string().regex(EXTRACT_ID_PATTERN)).max(10).optional(),
  })
  .refine(
    // The page sends the value as `parseTypedDate` read it; checked again
    // here rather than trusted.
    (answer) =>
      answer.verdict !== "date" ||
      (!!answer.value && parseTypedDate(answer.value).kind !== "invalid"),
    { message: "A date answer needs a date (YYYY-MM-DD) or a year (YYYY)" },
  );

/** How many queued pages an answer takes up. The reader is waiting for their
 * next crop, and a page is a few seconds of writes; the job's sweep and the
 * admin's button take up the rest. */
const PAGES_PER_ANSWER = 1;

/**
 * A reader's answer to one crop: the date they read, that it cannot be read,
 * that the field is empty, or a skip. Settles the crop when enough readers
 * agree (`recordAnswer`) and answers with the next crops, plus - now that the
 * crop was read blind - the link to the whole declaration on BIP.
 *
 * An answer that settles a crop on a full date also compares it with its
 * pages and takes up the publication queue (`matchAndDrain`), beside fetching
 * the next crops rather than before them.
 */
export default defineEventHandler(async (event) => {
  const user = requireCountedReader(await getUser(event));
  const id = getRouterParam(event, "id") ?? "";
  if (!EXTRACT_ID_PATTERN.test(id)) {
    throw createError({ statusCode: 404, message: "Nie ma takiego wycinka." });
  }
  const body = await readValidatedBody(event, (raw) => answerSchema.parse(raw));
  const value =
    body.verdict === "date" && body.value
      ? (parseTypedDate(body.value) as { value: string }).value
      : null;

  const db = getFirestore(getApp(), "koryta-pl");
  const recorded = await recordAnswer(db, {
    extractId: id,
    user,
    answer: { verdict: body.verdict, value, name: body.name ?? null },
  });
  const settledOnDay =
    recorded.settled?.status === "agreed" && recorded.settled.kind === "date";
  const [queue] = await Promise.all([
    queueFor(db, user.uid, 3, new Set([id, ...(body.holding ?? [])])),
    settledOnDay ? compareWithPages(event, db, id) : undefined,
  ]);

  setResponseHeader(event, "Cache-Control", "private, no-store");
  return {
    ...queue,
    settled: recorded.settled !== null,
    answered: { id, documentUrl: recorded.documentUrl, host: recorded.host },
  } satisfies DeclarationAnswerResult;
});

/** The settled crop meets its pages. Never at the reader's expense: the
 * answer is stored and the crop settled whatever happens here, and the sweep
 * the job calls after every upload compares a crop this did not. */
async function compareWithPages(
  event: H3Event,
  db: Firestore,
  extractId: string,
): Promise<void> {
  try {
    const { drain } = await matchAndDrain(
      db,
      [extractId],
      new Date(),
      publishLimitOf(useRuntimeConfig(event)),
      { maxPages: PAGES_PER_ANSWER },
    );
    if (drain.published.length > 0) {
      await useStorage("cache").clear("nitro:handlers");
    }
  } catch (error) {
    console.error(`[declarations] comparing ${extractId} failed`, error);
  }
}
