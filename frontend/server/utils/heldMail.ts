import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import {
  heldMailVerdict,
  loadConsent,
  withdrawal,
} from "~~/shared/campaignConsent";
import { HELD_STATE } from "~~/shared/campaignPacing";

/** Withdraws the campaign mail of `uid`'s still held for its batch that they
 * may no longer be sent, by the check the release makes right before it lets
 * a message out (shared/campaignConsent.ts), and says how many.
 *
 * For the moment a reader leaves: the owner's page says so at once, and a
 * release that read the message before the change finds it changed and
 * writes nothing. The release would withdraw it anyway when its batch came.
 *
 * Each message only while it is still held. One the release let out since
 * this read is already on its way, and writing over it would only lose the
 * record of what became of it.
 */
export async function withdrawHeldMail(
  db: Firestore,
  uid: string,
  now: Date,
): Promise<number> {
  // Two equality filters, which Firestore serves by merging the single-field
  // indexes: no composite index.
  const held = await db
    .collection("mail")
    .where("uid", "==", uid)
    .where("delivery.state", "==", HELD_STATE)
    .get();
  if (held.docs.length === 0) return 0;

  const consent = (await loadConsent({ db, auth: getAuth() }, [uid])).get(uid);
  let withdrawn = 0;
  for (const doc of held.docs) {
    const verdict = heldMailVerdict(doc.data(), consent);
    if (verdict.send) continue;
    const done = await db.runTransaction(async (tx) => {
      const current = (await tx.get(doc.ref)).data();
      const state = (current?.delivery as { state?: unknown } | undefined)
        ?.state;
      if (state !== HELD_STATE) return false;
      tx.update(doc.ref, withdrawal(verdict.reason, now));
      return true;
    });
    if (done) withdrawn++;
  }
  return withdrawn;
}
