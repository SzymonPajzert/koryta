import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { initializeApp, getApps } from "firebase-admin/app";
import {
  CAMPAIGN_BATCH_GAP_MS,
  CAMPAIGN_BATCH_SIZE,
  HANDED_OVER_AT,
  HELD_STATE,
  releaseRoom,
  utcDayStart,
} from "../../shared/campaignPacing";
import {
  heldMailVerdict,
  loadConsent,
  withdrawal,
  type WithdrawReason,
} from "../../shared/campaignConsent";

/** Firestore's gRPC status for a precondition that no longer holds. */
const FAILED_PRECONDITION = 9;

/** What one run did: the messages it handed over, and the ones it withdrew,
 * by document id, with why. */
export type Release = {
  released: number;
  withdrawn: { id: string; reason: WithdrawReason }[];
};

/** Hands the next batch of held campaign mail to the mail extension, as far
 * as the batch gap and the day's allowance let it (shared/campaignPacing.ts),
 * and says what went.
 *
 * Right before, it asks again whether each reader in the batch may still be
 * written to, by the rules and the reads a send uses
 * (shared/campaignConsent.ts): the message may have waited for days, and in
 * that time its reader may have left the topic or lost their account. A
 * message that may not go is withdrawn instead, and counts toward nothing.
 * Messages the day has no room for are not asked about yet; they are when
 * their batch comes.
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
 * message the extension is sending or has sent, and it would go out twice;
 * and a run that read it just before its reader unsubscribed, which withdraws
 * it, would send it all the same. One changed message fails the whole batch,
 * and the next minute's run reads afresh.
 */
export async function releaseHeldMail(
  db: Firestore,
  auth: Auth,
  now: Date,
): Promise<Release> {
  const nothing: Release = { released: 0, withdrawn: [] };
  const mail = db.collection("mail");
  // In no particular order: any held message is as good as another, and an
  // equality filter alone needs no composite index.
  const held = await mail
    .where("delivery.state", "==", HELD_STATE)
    .limit(CAMPAIGN_BATCH_SIZE)
    .get();
  if (held.empty) return nothing;

  const handedOverSince = async (since: Date) =>
    (await mail.where(HANDED_OVER_AT, ">=", since).count().get()).data().count;
  const [recently, today] = await Promise.all([
    handedOverSince(new Date(now.getTime() - CAMPAIGN_BATCH_GAP_MS)),
    handedOverSince(utcDayStart(now)),
  ]);

  const batch = held.docs.slice(0, releaseRoom({ recently, today }));
  if (batch.length === 0) return nothing;

  const uidOf = (data: Record<string, unknown>) =>
    typeof data.uid === "string" ? data.uid : null;
  const consent = await loadConsent(
    { db, auth },
    batch.flatMap((doc) => uidOf(doc.data()) ?? []),
  );

  const done: Release = { released: 0, withdrawn: [] };
  const writes = db.batch();
  for (const doc of batch) {
    const data = doc.data();
    const uid = uidOf(data);
    const verdict = heldMailVerdict(
      data,
      uid === null ? undefined : consent.get(uid),
    );
    const precondition = { lastUpdateTime: doc.updateTime };
    if (!verdict.send) {
      writes.update(doc.ref, withdrawal(verdict.reason, now), precondition);
      done.withdrawn.push({ id: doc.id, reason: verdict.reason });
      continue;
    }
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
      precondition,
    );
    done.released++;
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
    return nothing;
  }
  return done;
}

/** Campaign mail goes out from here, a batch a minute: /api/admin/mail/send
 * only writes it held back (shared/campaignPacing.ts says why).
 *
 * Deployed by hand, like every function here. Until it runs, a campaign's
 * messages wait; none is lost. It reads the auth service as well as
 * Firestore, so its service account needs to read Firebase Authentication
 * users.
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
    const { released, withdrawn } = await releaseHeldMail(
      getFirestore("koryta-pl"),
      getAuth(),
      new Date(),
    );
    // Silent otherwise: once the day's allowance is spent, every minute until
    // midnight releases nothing.
    if (released > 0 || withdrawn.length > 0) {
      const why = withdrawn.map(({ id, reason }) => `${id} (${reason})`);
      logger.info(
        `Campaign mail: released ${released}` +
          (why.length > 0 ? `, withdrew ${why.join(", ")}` : ""),
      );
    }
  },
);
