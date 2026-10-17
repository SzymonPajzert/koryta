import { randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  CAMPAIGN_ID_PATTERN,
  campaignTopics,
  type CampaignTopic,
  type NewsletterChangeVia,
} from "~~/shared/campaigns";
import { SUBSCRIBERS, SUBSCRIBER_PREFIX } from "~~/shared/newsletterSignup";

/** One document per account that has been sent a campaign, holding the secret
 * its unsubscribe links carry. Server-only, like `mail`.
 *
 * A random token kept here rather than a signature, so nothing needs a key in
 * Secret Manager, and so a leaked link can be revoked by deleting one document.
 * It lives apart from `users/{uid}` because that document is writable by its
 * owner, and a client save that replaced it whole would break every link in
 * their inbox.
 */
export const MAIL_TOKENS = "mailTokens";

/** The account's token, made on first use and kept for good. */
export async function mailToken(db: Firestore, uid: string): Promise<string> {
  const ref = db.collection(MAIL_TOKENS).doc(uid);
  const existing = (await ref.get()).data()?.token;
  if (typeof existing === "string" && existing) return existing;

  const token = randomBytes(24).toString("base64url");
  try {
    await ref.create({ token, created_at: Timestamp.now() });
    return token;
  } catch (error) {
    // Two sends racing for the same new account: the first one's stands.
    if (!isAlreadyExists(error)) throw error;
    const raced = (await ref.get()).data()?.token;
    if (typeof raced === "string" && raced) return raced;
    throw error;
  }
}

/** Whether `token` is the one `id`'s links carry. */
export async function mailTokenMatches(
  db: Firestore,
  id: string,
  token: string,
): Promise<boolean> {
  const stored = (await db.collection(MAIL_TOKENS).doc(id).get()).data()?.token;
  return typeof stored === "string" && sameToken(stored, token);
}

export type UnsubscribeOutcome = "unsubscribed" | "invalid";

/** Takes the holder of `uid`'s token off `topic`, and off team mail.
 *
 * Both, because a reader who clicks "Wypisz się" under a team message expects
 * it to stop, and the link does not say which of the two grounds the message
 * was sent on. The other topic stays as it was: that one they chose separately.
 * /profil puts back whatever they did not mean.
 */
export async function unsubscribe(
  db: Firestore,
  args: {
    uid: string;
    token: string;
    topic: CampaignTopic;
    campaignId?: string;
  },
): Promise<UnsubscribeOutcome> {
  if (!(await mailTokenMatches(db, args.uid, args.token))) return "invalid";

  if (args.uid.startsWith(SUBSCRIBER_PREFIX)) {
    await withdrawSubscriberTopic(db, {
      id: args.uid.slice(SUBSCRIBER_PREFIX.length),
      topic: args.topic,
    });
  } else {
    await unsubscribeAccount(db, args.uid, args.topic);
  }

  if (args.campaignId && CAMPAIGN_ID_PATTERN.test(args.campaignId)) {
    try {
      await db
        .collection("mailCampaigns")
        .doc(args.campaignId)
        .update({ unsubscribed: FieldValue.arrayUnion(args.uid) });
    } catch (error) {
      // The reader is off the list either way; a campaign deleted since only
      // loses the count.
      console.warn(
        `Unsubscribe from ${args.campaignId} not counted on the campaign`,
        error,
      );
    }
  }
  return "unsubscribed";
}

async function unsubscribeAccount(
  db: Firestore,
  uid: string,
  topic: CampaignTopic,
) {
  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        newsletter: { [topic]: false },
        teamMail: false,
        newsletterUpdated: {
          at: FieldValue.serverTimestamp(),
          via: "wypisz" satisfies NewsletterChangeVia,
        },
      },
      { merge: true },
    );
}

/** Takes a reader without an account off `topic`. With no topic left, the
 * address is unsubscribed, and the form can sign it up again. */
async function withdrawSubscriberTopic(
  db: Firestore,
  args: { id: string; topic: CampaignTopic },
) {
  const ref = db.collection(SUBSCRIBERS).doc(args.id);
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data) return;
    const topics = { ...(data.topics ?? {}), [args.topic]: false };
    const anyLeft = campaignTopics.some((topic) => topics[topic] === true);
    tx.update(ref, {
      topics,
      ...(anyLeft
        ? {}
        : { status: "unsubscribed", unsubscribedAt: Timestamp.now() }),
    });
  });
}

function sameToken(stored: string, given: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAlreadyExists(error: unknown): boolean {
  // grpc ALREADY_EXISTS; firebase-admin surfaces the numeric code.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 6
  );
}
