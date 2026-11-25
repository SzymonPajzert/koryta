/** One reminder to confirm an address, for an account whose confirmation
 * would change something for it.
 *
 * The site writes only to confirmed addresses (shared/campaigns.ts). Firebase
 * mails the confirmation link at sign-up, and again when an unconfirmed
 * account says yes to the newsletter; after that nothing asks. The owner
 * decided on 2026-11-25 to ask once more, and only the accounts that wait on
 * the address: a yes to the newsletter, team mail, or readings of
 * declarations, which vote only from a confirmed account. An account that
 * said no or never answered, and read nothing, is not written to.
 *
 * Pure: the server renders the message with these, and the tests read the
 * same functions.
 */
import { campaignTopics, type AudienceMember } from "./campaigns";
import { email, ink, surface } from "./colors";
import { escapeHtml, type MailMessage } from "./notifications";

/** What an unconfirmed account waits on, in the order the message says it. */
export const confirmReasons = ["newsletter", "team", "readings"] as const;

export type ConfirmReason = (typeof confirmReasons)[number];

/** Where a reminder is kept in `mail`: one per account, ever. */
export function confirmReminderId(uid: string): string {
  return `confirmReminder_${uid}`;
}

/** What `member` waits on until its address is confirmed - nothing for a
 * confirmed, blocked or address-less account, or a reader without one. */
export function confirmReasonsFor(
  member: Pick<
    AudienceMember,
    | "kind"
    | "email"
    | "emailVerified"
    | "disabled"
    | "admin"
    | "preferences"
    | "activity"
  >,
): ConfirmReason[] {
  if (member.kind || member.disabled || !member.email || member.emailVerified) {
    return [];
  }
  const waiting: Record<ConfirmReason, boolean> = {
    newsletter: campaignTopics.some(
      (topic) => member.preferences.newsletter?.[topic] === true,
    ),
    team: member.admin && member.preferences.teamMail !== false,
    readings: member.activity.counts.reading > 0,
  };
  return confirmReasons.filter((reason) => waiting[reason]);
}

const REASON_LINES: Record<ConfirmReason, string> = {
  newsletter:
    "Twoje konto na koryta.pl jest zapisane na newsletter, ale adres nie jest potwierdzony, więc nic do Ciebie nie wysyłamy.",
  team: "Wiadomości dla zespołu docierają tylko na potwierdzony adres.",
  readings:
    "Potwierdź adres e-mail, a kolejne odczyty oświadczeń zaczną się liczyć.",
};

const SUBJECT = "Potwierdź adres e-mail na koryta.pl";
const BUTTON = "Potwierdź adres";
const FOOTER =
  "To jedyne przypomnienie. Jeśli to nie Twoje konto, zignoruj tę wiadomość.";

/** The reminder for an account waiting on `reasons`, with `url`, the link
 * that confirms its address. */
export function renderConfirmReminder(args: {
  reasons: ConfirmReason[];
  url: string;
}): MailMessage {
  const lines = confirmReasons
    .filter((reason) => args.reasons.includes(reason))
    .map((reason) => REASON_LINES[reason]);

  const text = [...lines, `${BUTTON}: ${args.url}`, FOOTER].join("\n\n");

  const button = `display: inline-block; background: ${ink.sage}; color: ${surface.white}; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;`;
  const html = [
    `<div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.5; color: ${email.text};">`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p style="margin: 24px 0;"><a href="${escapeHtml(args.url)}" style="${button}">${BUTTON}</a></p>`,
    `<hr style="border: none; border-top: 1px solid ${email.rule}; margin: 24px 0;">`,
    `<p style="font-size: 13px; color: ${email.muted};">${escapeHtml(FOOTER)}</p>`,
    "</div>",
  ].join("\n");

  return { subject: SUBJECT, text, html };
}
