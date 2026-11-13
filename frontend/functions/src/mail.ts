import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import {
  CAMPAIGN_BATCH_GAP_MS,
  CAMPAIGN_BATCH_SIZE,
  HANDED_OVER_AT,
  HELD_STATE,
  releaseRoom,
  utcDayStart,
} from "../../shared/campaignPacing";

/** Firestore's gRPC status for a precondition that no longer holds. */
const FAILED_PRECONDITION = 9;

/** Hands the next batch of held campaign mail to the mail extension, as far
 * as the batch gap and the day's allowance let it (shared/campaignPacing.ts),
 * and says how many messages went.
 *
 * Releasing writes `delivery` the way the extension itself does for a
 * document it has just been given - PENDING, no attempts yet - so it sends the
 * message on that write. The gap and the day are counted by
 * `delivery.startTime`, which the extension stamps on every message the site
 * sends, so mail that never waits - a notification, a newsletter confirmation,
 * the owner's test - takes its share of both. `released_at` marks what a
 * release let out; nothing else writes it.
 *
 * Each message is written only as it was read. A run that read it HELD just
 * before another run let it out would otherwise set PENDING again over a
 * message the extension is sending or has sent, and it would go out twice.
 * One changed message fails the whole batch, and the next minute's run reads
 * afresh.
 */
export async function releaseHeldMail(
  db: Firestore,
  now: Date,
): Promise<number> {
  const mail = db.collection("mail");
  // In no particular order: any held message is as good as another, and an
  // equality filter alone needs no composite index.
  const held = await mail
    .where("delivery.state", "==", HELD_STATE)
    .limit(CAMPAIGN_BATCH_SIZE)
    .get();
  if (held.empty) return 0;

  const handedOverSince = async (since: Date) =>
    (await mail.where(HANDED_OVER_AT, ">=", since).count().get()).data().count;
  const [recently, today] = await Promise.all([
    handedOverSince(new Date(now.getTime() - CAMPAIGN_BATCH_GAP_MS)),
    handedOverSince(utcDayStart(now)),
  ]);

  const batch = held.docs.slice(0, releaseRoom({ recently, today }));
  if (batch.length === 0) return 0;
  const writes = db.batch();
  for (const doc of batch) {
    writes.update(
      doc.ref,
      {
        delivery: {
          startTime: now,
          state: "PENDING",
          attempts: 0,
          error: null,
        },
        released_at: now,
      },
      { lastUpdateTime: doc.updateTime },
    );
  }
  try {
    await writes.commit();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== FAILED_PRECONDITION) {
      throw error;
    }
    logger.info(
      "Campaign mail: released nothing, a message changed after this run read it",
    );
    return 0;
  }
  return batch.length;
}

/** Campaign mail goes out from here, a batch a minute: /api/admin/mail/send
 * only writes it held back (shared/campaignPacing.ts says why).
 *
 * Deployed by hand, like every function here. Until it runs, a campaign's
 * messages wait; none is lost.
 */
export const releaseCampaignMail = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "europe-west1",
    // One run at a time, so two cannot both find the same gap free: one
    // instance, taking one request - a 2nd gen function otherwise takes 80 at
    // once. Cloud Run can still run two for a moment, around a deploy for
    // one, so releaseHeldMail never writes over a message another run has
    // let out.
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    // On the first run rather than when the module loads, so a test can
    // import `releaseHeldMail` alone: under vitest the copy of firebase-admin
    // in functions/node_modules is transformed, and its exports come back
    // undefined.
    if (getApps().length === 0) initializeApp();
    const released = await releaseHeldMail(
      getFirestore("koryta-pl"),
      new Date(),
    );
    // Silent otherwise: once the day's allowance is spent, every minute until
    // midnight releases nothing.
    if (released > 0) logger.info(`Campaign mail: released ${released}`);
  },
);
