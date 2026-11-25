/** The mail that asks to confirm an address: the one sent at sign-up and on
 * request, and the one reminder.
 *
 * Both go through `mail` and the Trigger Email extension, from the site's own
 * address, as campaigns do. Firebase's own mail came from its firebaseapp.com
 * address, which mail filters often put in spam (decision on 2026-11-25).
 * The site writes only to confirmed addresses (shared/campaigns.ts), so this
 * is the one kind of message an unconfirmed address gets.
 *
 * The reminder goes to the accounts a confirmation would change something
 * for: a yes to the newsletter, team mail, or readings of declarations, which
 * vote only from a confirmed account (decision on 2026-11-25). An account that
 * said no or never answered, and read nothing, is not reminded.
 *
 * Pure: the server renders the messages with these, and the tests read the
 * same functions.
 */
import { campaignTopics, type AudienceMember } from "./campaigns";
import { email, ink, surface } from "./colors";
import { escapeHtml, type MailMessage } from "./notifications";

/** How many confirmation mails an account can ask for in a UTC day. */
export const CONFIRMATIONS_PER_DAY = 3;

/** Where an account's confirmation mails of `day` (`YYYY-MM-DD`, UTC) are
 * kept in `mail`: one slot per message, so the day's limit is the number of
 * slots. */
export function confirmationIds(uid: string, day: string): string[] {
  return Array.from(
    { length: CONFIRMATIONS_PER_DAY },
    (_, i) => `confirmAddress_${uid}_${day}_${i + 1}`,
  );
}

/** Where the reminder is kept in `mail`: one per account, ever. */
export function confirmReminderId(uid: string): string {
  return `confirmReminder_${uid}`;
}

/** What an unconfirmed account waits on, in the order the reminder says it. */
export const confirmReasons = ["newsletter", "team", "readings"] as const;

export type ConfirmReason = (typeof confirmReasons)[number];

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
const NOT_YOURS = "Jeśli to nie Twoje konto, zignoruj tę wiadomość.";

/** The mail sent at sign-up and whenever the reader asks for the link again,
 * with `url`, the link that confirms their address. */
export function renderAddressConfirmation(args: { url: string }): MailMessage {
  return renderMail({
    lines: ["Potwierdź adres e-mail swojego konta na koryta.pl."],
    url: args.url,
    footer: NOT_YOURS,
  });
}

/** The reminder for an account waiting on `reasons`. */
export function renderConfirmReminder(args: {
  reasons: ConfirmReason[];
  url: string;
}): MailMessage {
  return renderMail({
    lines: confirmReasons
      .filter((reason) => args.reasons.includes(reason))
      .map((reason) => REASON_LINES[reason]),
    url: args.url,
    footer: `To jedyne przypomnienie. ${NOT_YOURS}`,
  });
}

function renderMail(args: {
  lines: string[];
  url: string;
  footer: string;
}): MailMessage {
  const text = [...args.lines, `${BUTTON}: ${args.url}`, args.footer].join(
    "\n\n",
  );

  const button = `display: inline-block; background: ${ink.sage}; color: ${surface.white}; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;`;
  const html = [
    `<div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.5; color: ${email.text};">`,
    ...args.lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p style="margin: 24px 0;"><a href="${escapeHtml(args.url)}" style="${button}">${BUTTON}</a></p>`,
    `<hr style="border: none; border-top: 1px solid ${email.rule}; margin: 24px 0;">`,
    `<p style="font-size: 13px; color: ${email.muted};">${escapeHtml(args.footer)}</p>`,
    "</div>",
  ].join("\n");

  return { subject: SUBJECT, text, html };
}
