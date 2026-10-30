import type { Firestore } from "firebase-admin/firestore";
import type { H3Event } from "h3";
import { z } from "zod";
import {
  decideExtract,
  type DecidedExtract,
} from "~~/server/utils/declarationDecisions";
import {
  afterDecision,
  decisionRequest,
} from "~~/server/utils/declarationDecisionRequest";
import { matchAndDrain } from "~~/server/utils/declarationPublish";
import { parseTypedDate, publishLimitOf } from "~~/shared/declarations";

const settleSchema = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("date"),
    // As the page's `parseTypedDate` read the admin's typing; read again
    // here rather than trusted.
    value: z
      .string()
      .max(20)
      .refine((value) => parseTypedDate(value).kind !== "invalid", {
        message: "A date (YYYY-MM-DD) or a year (YYYY)",
      }),
  }),
  z.object({ verdict: z.literal("unreadable") }),
]);

/** Queued pages a decision takes up, as an answer does: the admin is waiting
 * for the reload, and the sweep takes up the rest. */
const PAGES_PER_DECISION = 1;

/**
 * An admin settles a crop from /admin/oswiadczenia: on the date they read off
 * it (a day, or a year where the form gives no more), or as unreadable
 * (`decideExtract`). Admins only, checked before the body is read.
 *
 * A crop settled on a day meets its pages at once and takes up the queue
 * under the daily limit (`matchAndDrain`), the way the answer that settles a
 * crop does - never at the decision's expense. The admin's date queues no
 * page itself: a draft born that day is held (`admin_decision`), and the pass
 * after it takes up only what readers and the job queued.
 *
 * Either decision leaves the crop confirming no page, so a public page that
 * linked it stops showing it, and the pages' cached answers are dropped then,
 * as they are when the pass published somebody.
 */
export default defineEventHandler(async (event): Promise<DecidedExtract> => {
  const { uid, id, db } = await decisionRequest(event);
  const body = await readValidatedBody(event, (raw) => settleSchema.parse(raw));

  const decided = await decideExtract(db, {
    extractId: id,
    uid,
    decision:
      body.verdict === "date"
        ? {
            verdict: "date",
            value: (parseTypedDate(body.value) as { value: string }).value,
          }
        : { verdict: "unreadable" },
  });
  const published = decided.compare && (await compareWithPages(event, db, id));
  await afterDecision(db, id, published);
  return decided;
});

/** The decided crop meets its pages; whether the pass after it published
 * anybody. The decision is stored whatever happens here, and the sweep the
 * job calls after every upload compares a crop this did not. */
async function compareWithPages(
  event: H3Event,
  db: Firestore,
  extractId: string,
): Promise<boolean> {
  try {
    const { drain } = await matchAndDrain(
      db,
      [extractId],
      new Date(),
      publishLimitOf(useRuntimeConfig(event)),
      { maxPages: PAGES_PER_DECISION },
    );
    return drain.published.length > 0;
  } catch (error) {
    console.error(`[declarations] comparing ${extractId} failed`, error);
    return false;
  }
}
