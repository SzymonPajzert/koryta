import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { isAlreadyExists } from "~~/server/utils/mailTokens";
import type { AudienceMember } from "~~/shared/campaigns";
import {
  confirmReasonsFor,
  confirmReminderId,
  renderConfirmReminder,
  type ConfirmReason,
} from "~~/shared/confirmReminder";

/** The most reminders queued by one call. The pilot lost 11 of the 40
 * messages queued at once to Mailgun's burst limit; a second call sends the
 * rest. */
export const CONFIRM_REMINDER_BATCH = 20;

/** An account the reminder is for (shared/confirmReminder.ts). */
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
    outcomes[recipient.uid] = await queueOne(db, recipient, options.siteUrl);
  }
  const queued = Object.values(outcomes).filter((o) => o === "queued").length;
  console.info(`confirmReminders: queued ${queued} of ${due.length}`);
  return outcomes;
}

async function queueOne(
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
