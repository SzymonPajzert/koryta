import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody, setResponseHeader } from "h3";
import { z } from "zod";
import { requireOwner } from "~~/server/utils/auth";
import {
  confirmReminderRecipients,
  queueConfirmReminders,
} from "~~/server/utils/confirmAddress";
import { loadAudience } from "~~/server/utils/mailAudience";
import { renderConfirmReminder } from "~~/shared/confirmAddress";

const bodySchema = z.object({ send: z.boolean().default(false) });

/** The one reminder to confirm an address (shared/confirmAddress.ts), for the
 * owner, who runs it from the browser console: no page calls it.
 *
 * Without `send` it only says who would get it and what each version says.
 * With `send: true` it queues it for up to `CONFIRM_REMINDER_BATCH` accounts
 * not reminded yet; calling again sends the rest. The answer carries
 * addresses, so it is never cached anywhere on the way. */
export default defineEventHandler(async (event) => {
  await requireOwner(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const { send } = await readValidatedBody(event, (body) =>
    bodySchema.parse(body ?? {}),
  );
  const db = getFirestore("koryta-pl");

  const { members } = await loadAudience(db);
  const recipients = await confirmReminderRecipients(db, members);
  const versions = new Map(recipients.map((r) => [r.reasons.join("+"), r]));
  const previews = [...versions].map(([reasons, recipient]) => {
    const mail = renderConfirmReminder({
      reasons: recipient.reasons,
      url: "<link>",
    });
    return { reasons, subject: mail.subject, text: mail.text };
  });
  if (!send) return { sent: false, recipients, previews };

  const outcomes = await queueConfirmReminders(db, recipients, {
    siteUrl: useRuntimeConfig(event).public.siteUrl,
  });
  const after = recipients.map((recipient) => ({
    ...recipient,
    reminded:
      recipient.reminded ||
      outcomes[recipient.uid] === "queued" ||
      outcomes[recipient.uid] === "duplicate",
  }));
  return {
    sent: true,
    outcomes,
    left: after.filter((recipient) => !recipient.reminded).length,
    recipients: after,
    previews,
  };
});
