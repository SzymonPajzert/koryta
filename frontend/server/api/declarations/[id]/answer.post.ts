import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import {
  queueFor,
  recordAnswer,
  requireCountedReader,
} from "~~/server/utils/declarations";
import {
  answerVerdicts,
  EXTRACT_ID_PATTERN,
  parseTypedDate,
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

/**
 * A reader's answer to one crop: the date they read, that it cannot be read,
 * that the field is empty, or a skip. Settles the crop when enough readers
 * agree (`recordAnswer`) and answers with the next crops, plus - now that the
 * crop was read blind - the link to the whole declaration on BIP.
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
  const queue = await queueFor(
    db,
    user.uid,
    3,
    new Set([id, ...(body.holding ?? [])]),
  );

  setResponseHeader(event, "Cache-Control", "private, no-store");
  return {
    ...queue,
    settled: recorded.settled !== null,
    answered: { id, documentUrl: recorded.documentUrl, host: recorded.host },
  } satisfies DeclarationAnswerResult;
});
