import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { mailTokenMatches, mailToken } from "~~/server/utils/mailTokens";
import { campaignTopics, type CampaignTopic } from "~~/shared/campaigns";
import {
  CONFIRMATION_DAYS,
  SUBSCRIBERS,
  SUBSCRIBER_PREFIX,
  confirmationUrl,
  renderConfirmation,
} from "~~/shared/newsletterSignup";

/** One document per day, counting the confirmation mails sent on it. */
export const SUBSCRIBE_LIMITS = "newsletterLimits";

/** The most confirmation mails the site sends in a day, far above any real
 * day. Past it the form still answers as usual and nothing is sent: a script
 * pouring addresses in must not turn the site into somebody's spam cannon. */
export const DAILY_CONFIRMATIONS_CAP = 200;

/** One address is sent its confirmation at most this often... */
const RESEND_AFTER_MS = 10 * 60 * 1000;
/** ...and at most this many times in a day. */
const MAX_CONFIRMATIONS_A_DAY = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";

export type Subscriber = {
  id: string;
  email: string;
  status: SubscriberStatus;
  topics: Partial<Record<CampaignTopic, boolean>>;
};

/** What became of a request. The form says the same thing for all of them -
 * which of these happened is nobody's business who only knows the address. */
export type SubscribeOutcome =
  "sent" | "alreadyConfirmed" | "throttled" | "capped";

/** The subscriber document's id for an address: the same address always
 * lands on the same document, so two quick submissions cannot make two. 128
 * bits of SHA-256, which no two addresses will share. */
export function subscriberId(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

/** Takes an address from the form: a new one, or one whose earlier request
 * was never confirmed or later withdrawn, is sent the confirmation mail. */
export async function requestSubscription(
  db: Firestore,
  args: { email: string; where: string; siteUrl: string; now: Date },
): Promise<SubscribeOutcome> {
  const ref = db.collection(SUBSCRIBERS).doc(subscriberId(args.email));
  const limitRef = db
    .collection(SUBSCRIBE_LIMITS)
    .doc(args.now.toISOString().slice(0, 10));
  const sentAt = Timestamp.fromDate(args.now);

  const outcome = await db.runTransaction(
    async (tx): Promise<SubscribeOutcome> => {
      const [snapshot, limit] = await Promise.all([
        tx.get(ref),
        tx.get(limitRef),
      ]);
      const data = snapshot.data();
      if (data?.status === "confirmed") return "alreadyConfirmed";

      const recent = timestamps(data?.confirmationsSent).filter(
        (at) => args.now.getTime() - at.getTime() < DAY_MS,
      );
      const last = recent.at(-1);
      if (
        recent.length >= MAX_CONFIRMATIONS_A_DAY ||
        (last && args.now.getTime() - last.getTime() < RESEND_AFTER_MS)
      ) {
        return "throttled";
      }
      const sentToday = (limit.get("count") as number | undefined) ?? 0;
      if (sentToday >= DAILY_CONFIRMATIONS_CAP) return "capped";

      tx.set(
        limitRef,
        { count: sentToday + 1, day: limitRef.id },
        {
          merge: true,
        },
      );
      tx.set(
        ref,
        {
          email: args.email,
          status: "pending",
          topics: Object.fromEntries(
            campaignTopics.map((topic) => [topic, true]),
          ),
          where: args.where,
          createdAt: data?.createdAt ?? sentAt,
          confirmationsSent: [
            ...recent.map((at) => Timestamp.fromDate(at)),
            sentAt,
          ],
          // Removes an address nobody confirmed, once the TTL policy on this
          // field is on. Cleared when it is confirmed.
          expireAt: Timestamp.fromMillis(
            args.now.getTime() + CONFIRMATION_DAYS * DAY_MS,
          ),
        },
        { merge: true },
      );
      return "sent";
    },
  );
  if (outcome !== "sent") return outcome;

  const token = await mailToken(db, `${SUBSCRIBER_PREFIX}${ref.id}`);
  await db.collection("mail").add({
    to: [args.email],
    message: renderConfirmation({
      url: confirmationUrl(args.siteUrl, { id: ref.id, token }),
    }),
    kind: "newsletterConfirmation",
    subscriber: ref.id,
    created_at: sentAt,
  });
  return "sent";
}

export type ConfirmOutcome = "confirmed" | "alreadyConfirmed" | "invalid";

/** Confirms the address behind a confirmation link. */
export async function confirmSubscription(
  db: Firestore,
  args: { id: string; token: string; now: Date },
): Promise<ConfirmOutcome> {
  if (
    !(await mailTokenMatches(db, `${SUBSCRIBER_PREFIX}${args.id}`, args.token))
  ) {
    return "invalid";
  }
  const ref = db.collection(SUBSCRIBERS).doc(args.id);
  const data = (await ref.get()).data();
  if (!data) return "invalid";
  if (data.status === "confirmed") return "alreadyConfirmed";
  // A request withdrawn by its own link is not brought back by an old
  // confirmation mail: the form makes a new one.
  if (data.status !== "pending") return "invalid";
  const expireAt = data.expireAt as Timestamp | undefined;
  if (expireAt && expireAt.toMillis() < args.now.getTime()) return "invalid";

  await ref.update({
    status: "confirmed",
    confirmedAt: Timestamp.fromDate(args.now),
    expireAt: FieldValue.delete(),
  });
  return "confirmed";
}

/** Every confirmed subscriber, for the campaign audience. */
export async function confirmedSubscribers(
  db: Firestore,
): Promise<Subscriber[]> {
  const snapshot = await db
    .collection(SUBSCRIBERS)
    .where("status", "==", "confirmed")
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const topics: Partial<Record<CampaignTopic, boolean>> = {};
    for (const topic of campaignTopics) {
      if (typeof data.topics?.[topic] === "boolean") {
        topics[topic] = data.topics[topic];
      }
    }
    return {
      id: doc.id,
      email: String(data.email ?? ""),
      status: "confirmed",
      topics,
    };
  });
}

function timestamps(value: unknown): Date[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      item && typeof (item as Timestamp).toDate === "function"
        ? (item as Timestamp).toDate()
        : null,
    )
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
}
