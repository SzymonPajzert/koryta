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
 *
 * Not every kind is sent from this codebase. `roleChanged` is queued by the
 * claims script (data/pipelines/src/set_auth_claims.py), which writes the same
 * `mail` document in Python and keeps its own copy of the wording below; it is
 * here because the switch that stops it lives on /profil with the others, and
 * the script reads that switch from the same `users/{uid}.notifications`.
 */

export const notificationKinds = [
  "revisionApproved",
  "revisionRejected",
  "roleChanged",
] as const;

export type NotificationKind = (typeof notificationKinds)[number];

/** The kinds about what happened to something the user proposed - the ones the
 * proposals card on /profil means when it promises "odezwiemy się mailem".
 * `roleChanged` is about the account, not a proposal, so whether it is on
 * says nothing about that promise. */
export const revisionNotificationKinds = [
  "revisionApproved",
  "revisionRejected",
] as const satisfies readonly NotificationKind[];

/** Which kinds a user wants. Absent means "never decided", which is answered by
 * `notificationDefaults` rather than by silence. */
export type NotificationPreferences = Partial<
  Record<NotificationKind, boolean>
>;

/** Whether a user who has never opened their settings gets this kind.
 *
 * The revision kinds are the outcome of something the recipient did - they
 * proposed a change and somebody reviewed it - so they default to on.
 * `roleChanged` is on for a different reason: it is about the recipient's own
 * account, it comes a handful of times in the life of one, and a person who
 * lost a permission and was told nothing would only find out by running into a
 * 403. A kind that is broadcast rather than earned (a newsletter, a call to
 * action) should default to off; see `NewsletterPreferences`, which is that
 * other thing and stays separate.
 */
export const notificationDefaults: Record<NotificationKind, boolean> = {
  revisionApproved: true,
  revisionRejected: true,
  roleChanged: true,
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
  roleChanged: {
    title: "Zmiana Twoich uprawnień",
    hint: "Gdy administrator nada lub odbierze Ci uprawnienia na stronie",
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
    }
  | {
      kind: "roleChanged";
      /** The role the account holds now, as `describeRole` (shared/roles.ts)
       * prints it. Already worded, because the script that sends this is
       * Python and prints the same labels itself. */
      role: string;
    };

/** The kinds that are about a page somebody proposed a change to. */
type RevisionEvent = Exclude<NotificationEvent, { kind: "roleChanged" }>;

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
function bodyLines(event: RevisionEvent): string[] {
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

function subjectFor(event: RevisionEvent): string {
  return event.kind === "revisionApproved"
    ? `Zatwierdzono Twoją zmianę w „${event.target.name}”`
    : `Nie przyjęto Twojej zmiany w „${event.target.name}”`;
}

/** The mail about a changed role, in the exact words the claims script sends.
 *
 * Its own shape rather than the revision mails' with different lines. The
 * script is the sender and keeps a copy of this text in Python, so the format
 * is the one that can be stated in a sentence and kept identical on both sides:
 * the paragraphs joined by blank lines, and for the html a `<p>` per paragraph
 * with the settings address as a link. A styled wrapper or a differently worded
 * footer here would be one more thing for the two copies to disagree on, in a
 * message whose whole job is one sentence.
 */
function renderRoleChanged(role: string, base: string): MailMessage {
  const settingsUrl = `${base}/profil`;
  const paragraphs = [
    "Dzień dobry,",
    `Twoje uprawnienia na koryta.pl się zmieniły. Teraz: ${role}.`,
    "Jeśli masz otwartą stronę, odświeży uprawnienia sama w ciągu kilku sekund. Jeśli menu się nie zmieni, wyloguj się i zaloguj ponownie.",
  ];
  const settings = "Ustawienia powiadomień: ";

  return {
    subject: "Zmiana Twoich uprawnień na koryta.pl",
    text: [...paragraphs, `${settings}${settingsUrl}`].join("\n\n"),
    html: [
      ...paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`),
      `<p>${settings}<a href="${escapeHtml(settingsUrl)}">${escapeHtml(
        settingsUrl,
      )}</a></p>`,
    ].join("\n"),
  };
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
  if (event.kind === "roleChanged") return renderRoleChanged(event.role, base);

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
    '<div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1c1c;">',
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(link ? [`<p><a href="${escapeHtml(link)}">Zobacz stronę</a></p>`] : []),
    '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">',
    `<p style="font-size: 13px; color: #666;">Nie chcesz takich wiadomości? <a href="${escapeHtml(
      settingsUrl,
    )}">Zmień ustawienia powiadomień</a>.</p>`,
    "</div>",
  ].join("\n");

  return { subject: subjectFor(event), text, html };
}
