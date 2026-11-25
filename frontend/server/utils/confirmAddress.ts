import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { isAlreadyExists } from "~~/server/utils/mailTokens";
import type { AudienceMember } from "~~/shared/campaigns";
import {
  confirmationIds,
  confirmReasonsFor,
  confirmReminderId,
  renderAddressConfirmation,
  renderConfirmReminder,
  type ConfirmReason,
} from "~~/shared/confirmAddress";

/** The shortest wait between two confirmation mails of one account. */
export const CONFIRMATION_GAP_MS = 60_000;

/** What came of a request for the confirmation mail. */
export type ConfirmationOutcome =
  | "queued"
  /** Confirmed already: nothing to send. */
  | "confirmed"
  | "noAddress"
  /** Asked again within `CONFIRMATION_GAP_MS`. */
  | "tooSoon"
  /** Had `CONFIRMATIONS_PER_DAY` today. */
  | "dailyLimit";

/** Queues the mail with the link that confirms `account`'s address
 * (shared/confirmAddress.ts), unless it is confirmed or has asked too often.
 *
 * The limit keeps one account from spending the site's 100 messages a day on
 * Mailgun, or from writing to one address over and over: anybody can register
 * with anybody's address. It lives in the ids of the messages themselves, one
 * slot per message of the day, so it needs no collection or index of its own.
 */
export async function queueAddressConfirmation(
  db: Firestore,
  account: { uid: string; email: string | null; emailVerified: boolean },
  options: { siteUrl: string; now: Date },
): Promise<ConfirmationOutcome> {
  if (!account.email) return "noAddress";
  if (account.emailVerified) return "confirmed";

  const day = options.now.toISOString().slice(0, 10);
  const ids = confirmationIds(account.uid, day);
  const snapshots = await db.getAll(
    ...ids.map((id) => db.collection("mail").doc(id)),
  );
  const free = ids.find((_, i) => !snapshots[i]?.exists);
  if (!free) return "dailyLimit";
  const last = Math.max(
    0,
    ...snapshots.map((snapshot) => millis(snapshot.get("created_at"))),
  );
  if (options.now.getTime() - last < CONFIRMATION_GAP_MS) return "tooSoon";

  const url = await confirmationLink(account.email, options.siteUrl);
  try {
    await db
      .collection("mail")
      .doc(free)
      .create({
        to: [account.email],
        message: renderAddressConfirmation({ url }),
        kind: "confirmAddress",
        uid: account.uid,
        created_at: Timestamp.fromDate(options.now),
      });
  } catch (error) {
    // Two requests at once took the same slot, and the other one sent it.
    if (isAlreadyExists(error)) return "tooSoon";
    throw error;
  }
  return "queued";
}

function millis(value: unknown): number {
  return (value as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

/** The most reminders queued by one call. The pilot lost 11 of the 40
 * messages queued at once to Mailgun's burst limit; a second call sends the
 * rest. */
export const CONFIRM_REMINDER_BATCH = 20;

/** An account the reminder is for (shared/confirmAddress.ts). */
export type ConfirmReminderRecipient = {
  uid: string;
  email: string;
  reasons: ConfirmReason[];
  createdAt: string | null;
  lastSeenAt: string | null;
  /** Had its reminder already: it goes once. */
  reminded: boolean;
};

export type ConfirmReminderOutcome = "queued" | "duplicate" | "failed";

/** Every account in `members` that waits on its address, and whether it has
 * been reminded. */
export async function confirmReminderRecipients(
  db: Firestore,
  members: AudienceMember[],
): Promise<ConfirmReminderRecipient[]> {
  const waiting = members.flatMap((member) => {
    const reasons = confirmReasonsFor(member);
    return reasons.length > 0 ? [{ member, reasons }] : [];
  });
  if (waiting.length === 0) return [];

  const snapshots = await db.getAll(
    ...waiting.map(({ member }) =>
      db.collection("mail").doc(confirmReminderId(member.uid)),
    ),
  );
  const sent = new Set(
    snapshots.filter((snapshot) => snapshot.exists).map((s) => s.id),
  );
  return waiting.map(({ member, reasons }) => ({
    uid: member.uid,
    email: member.email!,
    reasons,
    createdAt: member.createdAt,
    lastSeenAt: member.lastSeenAt,
    reminded: sent.has(confirmReminderId(member.uid)),
  }));
}

/** Queues the reminder for the recipients not reminded yet, at most `limit`
 * of them, one after another. */
export async function queueConfirmReminders(
  db: Firestore,
  recipients: ConfirmReminderRecipient[],
  options: { siteUrl: string; limit?: number },
): Promise<Record<string, ConfirmReminderOutcome>> {
  const due = recipients
    .filter((recipient) => !recipient.reminded)
    .slice(0, options.limit ?? CONFIRM_REMINDER_BATCH);
  const outcomes: Record<string, ConfirmReminderOutcome> = {};
  for (const recipient of due) {
    outcomes[recipient.uid] = await queueReminder(
      db,
      recipient,
      options.siteUrl,
    );
  }
  const queued = Object.values(outcomes).filter((o) => o === "queued").length;
  console.info(`confirmReminders: queued ${queued} of ${due.length}`);
  return outcomes;
}

async function queueReminder(
  db: Firestore,
  recipient: ConfirmReminderRecipient,
  siteUrl: string,
): Promise<ConfirmReminderOutcome> {
  try {
    const url = await confirmationLink(recipient.email, siteUrl);
    await db
      .collection("mail")
      .doc(confirmReminderId(recipient.uid))
      .create({
        to: [recipient.email],
        message: renderConfirmReminder({ reasons: recipient.reasons, url }),
        kind: "confirmReminder",
        uid: recipient.uid,
        reasons: recipient.reasons,
        created_at: Timestamp.now(),
      });
    return "queued";
  } catch (error) {
    if (isAlreadyExists(error)) return "duplicate";
    console.error(`confirmReminders: failed for uid=${recipient.uid}`, error);
    return "failed";
  }
}

/** The link that confirms `email`. Firebase's page it opens offers a way back
 * to /profil, and is in Polish; where Firebase does not know the site's
 * address, the link goes without the way back. */
async function confirmationLink(
  email: string,
  siteUrl: string,
): Promise<string> {
  const auth = getAuth();
  let link: string;
  try {
    link = await auth.generateEmailVerificationLink(email, {
      url: `${siteUrl.replace(/\/$/, "")}/profil`,
    });
  } catch (error) {
    if (!continueUrlRefused(error)) throw error;
    link = await auth.generateEmailVerificationLink(email);
  }
  const url = new URL(link);
  url.searchParams.set("lang", "pl");
  return url.href;
}

function continueUrlRefused(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === "auth/unauthorized-continue-uri" ||
    code === "auth/invalid-continue-uri"
  );
}
