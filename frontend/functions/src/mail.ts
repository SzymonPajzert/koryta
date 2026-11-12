import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import {
  CAMPAIGN_BATCH_GAP_MS,
  CAMPAIGN_BATCH_SIZE,
  HELD_STATE,
  releaseRoom,
  utcDayStart,
} from "../../shared/campaignPacing";

/** Hands the next batch of held campaign mail to the mail extension, as far
 * as the batch gap and the day's allowance let it (shared/campaignPacing.ts),
 * and says how many messages went.
 *
 * Releasing writes `delivery` the way the extension itself does for a
 * document it has just been given - PENDING, no attempts yet - so it sends the
 * message on that write. `released_at` is what the gap and the day are counted
 * from; nothing but a release writes it.
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

  const releasedSince = async (since: Date) =>
    (await mail.where("released_at", ">=", since).count().get()).data().count;
  const [recently, today] = await Promise.all([
    releasedSince(new Date(now.getTime() - CAMPAIGN_BATCH_GAP_MS)),
    releasedSince(utcDayStart(now)),
  ]);

  const batch = held.docs.slice(0, releaseRoom({ recently, today }));
  if (batch.length === 0) return 0;
  const writes = db.batch();
  for (const doc of batch) {
    writes.update(doc.ref, {
      delivery: { startTime: now, state: "PENDING", attempts: 0, error: null },
      released_at: now,
    });
  }
  await writes.commit();
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
    // One run at a time, so two cannot both find the same gap free.
    maxInstances: 1,
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
