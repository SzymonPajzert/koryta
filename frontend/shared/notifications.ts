/** What the site may write to a contributor, and what each message says.
 *
 * Kept apart from the sending in `server/utils/notifications.ts` so the copy is
 * a pure function of the event: a test can assert what an email says without a
 * Firestore, and the profile page can label the switches from the same list the
 * server checks before sending.
 *
 * Adding a kind means three things and no more: a member of `notificationKinds`,
 * an entry in `notificationDefaults` and `notificationLabels`, and a branch of
 * `renderNotification`. Everything else is driven off those.
 */

import { email } from "./colors";

export const notificationKinds = [
  "revisionApproved",
  "revisionRejected",
] as const;

export type NotificationKind = (typeof notificationKinds)[number];

/** Which kinds a user wants. Absent means "never decided", which is answered by
 * `notificationDefaults` rather than by silence. */
export type NotificationPreferences = Partial<
  Record<NotificationKind, boolean>
>;

/** Whether a user who has never opened their settings gets this kind.
 *
 * Both of these are the outcome of something the recipient did - they proposed
 * a change and somebody reviewed it - so they default to on. A kind that is
 * broadcast rather than earned (a newsletter, a call to action) should default
 * to off; see `NewsletterPreferences`, which is that other thing and stays
 * separate.
 */
export const notificationDefaults: Record<NotificationKind, boolean> = {
  revisionApproved: true,
  revisionRejected: true,
};

/** How the switches read on `/profil`. */
export const notificationLabels: Record<
  NotificationKind,
  { title: string; hint: string }
> = {
  revisionApproved: {
    title: "Zatwierdzenie Twojej zmiany",
    hint: "Gdy redakcja przyjmie zaproponowaną przez Ciebie zmianę",
  },
  revisionRejected: {
    title: "Odrzucenie Twojej zmiany",
    hint: "Gdy redakcja nie przyjmie zmiany — wraz z powodem",
  },
};

export function notificationEnabled(
  kind: NotificationKind,
  preferences: NotificationPreferences | undefined | null,
): boolean {
  const choice = preferences?.[kind];
  return choice === undefined ? notificationDefaults[kind] : choice;
}

/** The page a message is about, as far as the recipient is concerned.
 *
 * `path` is missing where the change has no page anyone can open — a relation,
 * or a node still waiting to be published. The message is still worth sending;
 * it just has nothing to link to.
 */
export interface NotificationTarget {
  name: string;
  path?: string;
}

export type NotificationEvent =
  | {
      kind: "revisionApproved";
      target: NotificationTarget;
      /** Whether the page is live. Approving does not publish, so a contributor
       * whose change was accepted can still find nothing at the link. */
      published: boolean;
    }
  | {
      kind: "revisionRejected";
      target: NotificationTarget;
      reason: string;
    };

/** A message in the shape the Trigger Email extension reads. */
export interface MailMessage {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Paragraphs of the message body, before either format is applied.
 *
 * A line is text; the link and the footer are the same in every message, so
 * only the part that differs per kind is written per kind.
 */
function bodyLines(event: NotificationEvent): string[] {
  const name = event.target.name;

  if (event.kind === "revisionApproved") {
    const lines = [
      `Twoja propozycja zmiany w „${name}” została zatwierdzona. Dziękujemy!`,
    ];
    if (!event.published) {
      lines.push(
        "Strona nie jest jeszcze widoczna publicznie — zmiana pojawi się na niej, gdy redakcja ją opublikuje.",
      );
    }
    return lines;
  }

  return [
    `Twoja propozycja zmiany w „${name}” nie została przyjęta.`,
    `Powód: ${event.reason}`,
    "Jeśli masz źródło potwierdzające zmianę, zaproponuj ją ponownie razem z odnośnikiem do niego.",
  ];
}

function subjectFor(event: NotificationEvent): string {
  return event.kind === "revisionApproved"
    ? `Zatwierdzono Twoją zmianę w „${event.target.name}”`
    : `Nie przyjęto Twojej zmiany w „${event.target.name}”`;
}

/** The email for `event`, both formats.
 *
 * `siteUrl` has no trailing slash and decides which deployment the links point
 * at, so a message rendered against the emulator never sends anyone to
 * production.
 */
export function renderNotification(
  event: NotificationEvent,
  siteUrl: string,
): MailMessage {
  const base = siteUrl.replace(/\/$/, "");
  const lines = bodyLines(event);
  const link = event.target.path ? `${base}${event.target.path}` : undefined;
  const settingsUrl = `${base}/profil`;

  const text = [
    ...lines,
    ...(link ? [`Zobacz stronę: ${link}`] : []),
    "",
    `Nie chcesz takich wiadomości? Zmień ustawienia powiadomień: ${settingsUrl}`,
  ].join("\n\n");

  const html = [
    `<div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.5; color: ${email.text};">`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(link ? [`<p><a href="${escapeHtml(link)}">Zobacz stronę</a></p>`] : []),
    `<hr style="border: none; border-top: 1px solid ${email.rule}; margin: 24px 0;">`,
    `<p style="font-size: 13px; color: ${email.muted};">Nie chcesz takich wiadomości? <a href="${escapeHtml(
      settingsUrl,
    )}">Zmień ustawienia powiadomień</a>.</p>`,
    "</div>",
  ].join("\n");

  return { subject: subjectFor(event), text, html };
}
