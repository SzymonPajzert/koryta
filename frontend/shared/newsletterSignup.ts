/** The newsletter for readers without an account.
 *
 * A reader leaves an address in the form on the home page and confirms
 * it from the mail that follows (double opt-in). Nothing else is ever sent to
 * an address nobody confirmed, so a reader who types somebody else's address
 * costs that person one message, which says to ignore it. A confirmed address
 * gets the campaigns of both topics, like an account that said yes to the
 * newsletter question; an address that also has an account is written to as
 * the account, which has its own switches.
 *
 * Pure: the server renders the confirmation mail with these, and the tests
 * read the same functions.
 */
import { email, ink, surface } from "./colors";
import { escapeHtml, type MailMessage } from "./notifications";

/** How long an unconfirmed address is kept, and its link works. */
export const CONFIRMATION_DAYS = 7;

/** The longest address taken. RFC 5321 caps a path at 254 characters. */
export const EMAIL_MAX = 254;

/** Readers who signed up without an account. Server-only: an address is
 * personal data, and the rules deny the collection to the client. */
export const SUBSCRIBERS = "newsletterSubscribers";

/** Subscribers' ids in the campaign audience start with this, which is how
 * an unsubscribe link tells a subscriber from an account. Firebase's own uids
 * never contain an underscore. */
export const SUBSCRIBER_PREFIX = "sub_";

/** Where the form is, as stored with the address and sent to Plausible as
 * the mail goals' `where`: under the call to action on the home page. */
export const newsletterSignupPlaces = ["home"] as const;

export type NewsletterSignupPlace = (typeof newsletterSignupPlaces)[number];

/** Trimmed and lowercased, so one address typed twice is one subscriber. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A plain check that turns away typos; the confirmation is the real test. */
export function looksLikeEmail(value: string): boolean {
  return (
    value.length <= EMAIL_MAX &&
    /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(value)
  );
}

/** The page a confirmation link opens. It asks before it confirms: mail
 * filters open the links in a message to look at them, and a link that
 * confirmed on opening would confirm for whoever's filter got there first. */
export function confirmationUrl(
  siteUrl: string,
  args: { id: string; token: string },
): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}/newsletter/potwierdz?s=${encodeURIComponent(
    args.id,
  )}&t=${encodeURIComponent(args.token)}`;
}

/** The message that asks to confirm an address. */
export function renderConfirmation(args: { url: string }): MailMessage {
  const subject = "Potwierdź zapis na newsletter koryta.pl";
  const intro =
    "Ktoś, mamy nadzieję, że Ty, zapisał ten adres na newsletter koryta.pl. Piszemy w nim raz na jakiś czas, kogo ostatnio znaleźliśmy na stanowiskach w publicznych spółkach i gdzie przyda się pomoc.";
  const ignore = `Jeśli to nie Ty, zignoruj tę wiadomość. Bez potwierdzenia nie napiszemy więcej, a adres usuniemy po ${CONFIRMATION_DAYS} dniach.`;

  const text = [intro, `Potwierdź zapis: ${args.url}`, ignore].join("\n\n");

  const button = `display: inline-block; background: ${ink.sage}; color: ${surface.white}; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;`;
  const html = [
    `<div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.5; color: ${email.text};">`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p style="margin: 24px 0;"><a href="${escapeHtml(args.url)}" style="${button}">Potwierdzam zapis</a></p>`,
    `<hr style="border: none; border-top: 1px solid ${email.rule}; margin: 24px 0;">`,
    `<p style="font-size: 13px; color: ${email.muted};">${escapeHtml(ignore)}</p>`,
    "</div>",
  ].join("\n");

  return { subject, text, html };
}
