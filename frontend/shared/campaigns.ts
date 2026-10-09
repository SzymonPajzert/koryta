/** Campaigns: one message the owner writes, sent to many accounts at once.
 *
 * The other half of the site's mail. `notifications.ts` tells one person what
 * happened to something they did, and defaults to on because they caused it. A
 * campaign is broadcast - "this is where your help is needed now" - so it goes
 * only where somebody agreed to it:
 *
 * - an account that switched the campaign's topic on in /profil (the newsletter
 *   switches, which stay off until touched), or
 * - an administrator, as a message to the team, unless they turned team mail
 *   off. The owner decided this on 2026-10-09: the team is written to without a
 *   newsletter opt-in, everybody else only with one.
 *
 * Either way, mail goes only to a confirmed address, like every message the
 * site sends.
 *
 * As in `notifications.ts`, the copy is a pure function. The server renders it
 * per recipient before queueing, and /admin/mailing runs the same function in
 * the browser for its preview, so the owner checks exactly what goes out.
 */
import {
  activityKinds,
  type ActivityCounts,
  type ActivityKind,
} from "./activity";
import { ink } from "./colors";
import { escapeHtml, type MailMessage } from "./notifications";
import {
  nominativeNoun,
  polishCountingGenitive,
  polishCountingGrouped,
  polishNumber,
} from "../app/composables/polish";

/** What a campaign is about, which is what a reader agrees to. The same two
 * switches /profil has offered since before anything was sent. */
export const campaignTopics = ["callsToAction", "recentPeople"] as const;

export type CampaignTopic = (typeof campaignTopics)[number];

export const campaignTopicLabels: Record<
  CampaignTopic,
  { title: string; hint: string }
> = {
  callsToAction: {
    title: "Wezwania do działania",
    hint: "Informacje, gdzie Twoja pomoc jest najbardziej potrzebna",
  },
  recentPeople: {
    title: "Nowo znalezione osoby",
    hint: "Powiadomienia o osobach niedawno dodanych do serwisu",
  },
};

/** The fields of `users/{uid}` campaign mail reads. The document is writable
 * by its owner, which is the point: these are their own choices. */
export type MailPreferences = {
  /** Absent means never asked, which is no. */
  newsletter?: Partial<Record<CampaignTopic, boolean>>;
  /** Administrators only. Absent means yes - see the module comment. */
  teamMail?: boolean;
};

/** Whether a reader has answered the mail question - on /profil or in the
 * prompt the layout shows - with either answer. Any stored newsletter choice
 * counts: somebody who switched both topics off has answered too. */
export function mailPromptAnswered(
  config: { newsletter?: unknown } | null | undefined,
): boolean {
  return typeof config?.newsletter === "object" && config.newsletter !== null;
}

/** One account, as the owner's audience list shows it. Server-built: the auth
 * service holds the address and the roles, Firestore the preferences and the
 * activity. */
export type AudienceMember = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  disabled: boolean;
  displayName: string | null;
  /** Holds the `admin` claim, trial administrators included. */
  admin: boolean;
  newAdmin: boolean;
  owner: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** The latest sign of life: a sign-in, a token refresh in an open tab, or a
   * contribution. Null for an account never seen since it was created. */
  lastSeenAt: string | null;
  /** What they did over the last `CAMPAIGN_STATS_DAYS`. */
  activity: { counts: ActivityCounts; total: number };
  preferences: MailPreferences;
};

/** What /api/admin/mail/audience answers: every account, most recently seen
 * first, and the site-wide numbers a message can quote. */
export type Audience = {
  members: AudienceMember[];
  community: CommunityStats;
  generatedAt: string;
};

export type IneligibleReason =
  "disabled" | "noAddress" | "unverified" | "noConsent" | "teamOptOut";

export type Eligibility =
  | { eligible: true; via: "optedIn" | "team" }
  | { eligible: false; reason: IneligibleReason };

export const ineligibleLabels: Record<IneligibleReason, string> = {
  disabled: "Konto zablokowane",
  noAddress: "Brak adresu e-mail",
  unverified: "Adres niepotwierdzony",
  noConsent: "Bez zgody na ten temat",
  teamOptOut: "Wypisano z maili zespołu",
};

/** Whether `member` may be sent a campaign about `topic`, and on what grounds.
 *
 * The grounds end up in the footer of the message, which says why the reader
 * is getting it.
 */
export function campaignEligibility(
  member: Pick<
    AudienceMember,
    "email" | "emailVerified" | "disabled" | "admin" | "preferences"
  >,
  topic: CampaignTopic,
): Eligibility {
  if (member.disabled) return { eligible: false, reason: "disabled" };
  if (!member.email) return { eligible: false, reason: "noAddress" };
  if (!member.emailVerified) return { eligible: false, reason: "unverified" };

  if (member.preferences.newsletter?.[topic] === true) {
    return { eligible: true, via: "optedIn" };
  }
  // A switched-off topic does not stop team mail: /profil saves both newsletter
  // switches whenever either moves, so `false` there is as often "never touched"
  // as it is "no". Team mail has a switch of its own.
  if (member.admin) {
    return member.preferences.teamMail === false
      ? { eligible: false, reason: "teamOptOut" }
      : { eligible: true, via: "team" };
  }
  return { eligible: false, reason: "noConsent" };
}

/** "Recently active", for the pilot: a sign-in, a token refresh or a
 * contribution in this many days. */
export const ACTIVE_DAYS = 30;

/** The window a reader's own numbers are counted over. One of
 * `activityRanges`, so it reads the same stored days as the stats page. */
export const CAMPAIGN_STATS_DAYS = 90;

/** The window of the site-wide numbers. */
export const COMMUNITY_STATS_DAYS = 30;

export const audiencePresets = [
  "pilot",
  "admins",
  "active",
  "everyone",
] as const;

export type AudiencePreset = (typeof audiencePresets)[number];

export const audiencePresetLabels: Record<AudiencePreset, string> = {
  pilot: "Pilot: admini i aktywni",
  admins: "Admini",
  active: `Aktywni w ostatnich ${ACTIVE_DAYS} dniach`,
  everyone: "Wszyscy",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRecentlyActive(
  member: Pick<AudienceMember, "lastSeenAt">,
  now: Date,
  days = ACTIVE_DAYS,
): boolean {
  if (!member.lastSeenAt) return false;
  return Date.parse(member.lastSeenAt) >= now.getTime() - days * DAY_MS;
}

/** Whether a preset picks `member`. Picking is only where the owner's
 * selection starts: eligibility is checked again on top, and once more on the
 * server before anything is queued. */
export function presetIncludes(
  preset: AudiencePreset,
  member: Pick<AudienceMember, "admin" | "lastSeenAt">,
  now: Date,
): boolean {
  switch (preset) {
    case "pilot":
      return member.admin || isRecentlyActive(member, now);
    case "admins":
      return member.admin;
    case "active":
      return isRecentlyActive(member, now);
    case "everyone":
      return true;
  }
}

/** What the owner writes. */
export type CampaignContent = {
  subject: string;
  /** Paragraphs separated by a blank line. `[label](/path)` is a link; a
   * path on the site gets the campaign's tracking parameters. */
  body: string;
  /** The button under the text. An empty label leaves it out. */
  ctaLabel: string;
  /** A path on the site, starting with `/`. */
  ctaPath: string;
  topic: CampaignTopic;
  /** Whether to add the reader's own numbers and the site's. */
  includeStats: boolean;
};

/** A campaign's id: the day it was written and its subject, as a slug. It is
 * also the `utm_campaign` a visit from it carries. */
export const CAMPAIGN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const campaignLimits = {
  subject: 150,
  body: 10_000,
  ctaLabel: 60,
  ctaPath: 300,
} as const;

export type PersonalStats = {
  days: number;
  counts: ActivityCounts;
  total: number;
};

export type CommunityStats = {
  days: number;
  votes: number;
  /** Distinct people who did anything in the window. */
  voters: number;
  publications: number;
  /** People in the queue nobody has checked yet; null where unknown. */
  toCheck: number | null;
};

export type UnsubscribeUrls = {
  /** The page the footer links to: it asks before it acts, so a mail
   * scanner that follows every link unsubscribes nobody. */
  pageUrl: string;
  /** What `List-Unsubscribe` names. Mail clients POST to it (RFC 8058). */
  oneClickUrl: string;
};

/** The links that take a reader off a topic. `campaignId`, when given, says
 * which campaign the reader left from, so the owner can see what put people
 * off. */
export function unsubscribeUrls(
  siteUrl: string,
  args: {
    uid: string;
    token: string;
    topic: CampaignTopic;
    campaignId?: string;
  },
): UnsubscribeUrls {
  const base = siteUrl.replace(/\/$/, "");
  const query = `u=${encodeURIComponent(args.uid)}&t=${encodeURIComponent(
    args.token,
  )}&k=${args.topic}${args.campaignId ? `&c=${args.campaignId}` : ""}`;
  return {
    pageUrl: `${base}/wypisz?${query}`,
    oneClickUrl: `${base}/api/mail/unsubscribe?${query}`,
  };
}

export type CampaignRender = {
  campaignId: string;
  content: CampaignContent;
  via: "optedIn" | "team";
  personal: PersonalStats | null;
  community: CommunityStats | null;
  /** No trailing slash. Decides which deployment links point at, so mail
   * rendered against the emulator never sends anybody to production. */
  siteUrl: string;
  unsubscribe: UnsubscribeUrls;
};

/** A message the Trigger Email extension can send, with the headers it passes
 * through to the SMTP server. */
export type CampaignMail = MailMessage & { headers: Record<string, string> };

/** Where a visit from a campaign says it came from. Plausible reads these off
 * the landing URL, so the dashboard can tell which campaign brought whom. */
export function withCampaignTracking(href: string, campaignId: string): string {
  const url = new URL(href);
  url.searchParams.set("utm_source", "newsletter");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", campaignId);
  return url.href;
}

/** `[label](target)`: the target runs to the first closing parenthesis, so a
 * URL with one in it needs encoding as `%29`. */
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** A site path (`/...`, not `//...`) or an https URL - nothing else is linked,
 * so a pasted `javascript:` stays text. */
function resolveLink(
  target: string,
  base: string,
  campaignId: string,
): string | null {
  if (target.startsWith("/") && !target.startsWith("//")) {
    return withCampaignTracking(`${base}${target}`, campaignId);
  }
  if (!/^https:\/\//i.test(target)) return null;
  try {
    const url = new URL(target);
    return url.origin === new URL(base).origin
      ? withCampaignTracking(url.href, campaignId)
      : url.href;
  } catch {
    return null;
  }
}

type Inline = { html: string; text: string };

function renderInline(line: string, base: string, campaignId: string): Inline {
  let html = "";
  let text = "";
  let last = 0;
  for (const match of line.matchAll(LINK)) {
    const [raw, label, target] = match as unknown as [string, string, string];
    const before = line.slice(last, match.index);
    html += escapeHtml(before);
    text += before;
    const href = resolveLink(target, base, campaignId);
    if (href) {
      html += `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
      text += `${label} (${href})`;
    } else {
      html += escapeHtml(raw);
      text += raw;
    }
    last = match.index + raw.length;
  }
  const rest = line.slice(last);
  return { html: html + escapeHtml(rest), text: text + rest };
}

function paragraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Every link to the site the message carries, as bare paths - for the owner
 * to open one by one before sending. The button's included. */
export function campaignLinks(content: CampaignContent): string[] {
  const links: string[] = [];
  for (const match of content.body.matchAll(LINK)) {
    const target = match[2]!;
    if (target.startsWith("/") && !target.startsWith("//")) links.push(target);
  }
  if (content.ctaLabel.trim() && content.ctaPath.startsWith("/")) {
    links.push(content.ctaPath);
  }
  return links;
}

/** "a", "a i b", "a, b i c". */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} i ${items.at(-1)}`;
}

/** Each kind of work as a counted noun phrase: one, two to four, many. */
const KIND_FORMS: Record<ActivityKind, [string, string, string]> = {
  vote: ["ocena", "oceny", "ocen"],
  revision: ["propozycja zmiany", "propozycje zmian", "propozycji zmian"],
  noteSource: [
    "źródło lub zgłoszenie",
    "źródła lub zgłoszenia",
    "źródeł lub zgłoszeń",
  ],
  publication: [
    "opublikowana strona",
    "opublikowane strony",
    "opublikowanych stron",
  ],
};

function counted(count: number, [one, few, many]: [string, string, string]) {
  return `${polishNumber(count)} ${nominativeNoun(count, one, few, many)}`;
}

/** The reader's own work, or nothing. A line saying "you did nothing" helps
 * nobody come back, so it is never written. */
function personalLine(stats: PersonalStats | null): string | null {
  if (!stats || stats.total <= 0) return null;
  const parts = activityKinds
    .filter((kind) => stats.counts[kind] > 0)
    .map((kind) => counted(stats.counts[kind], KIND_FORMS[kind]));
  if (parts.length === 0) return null;
  return `Twój wkład w ostatnich ${stats.days} dniach: ${listJoin(parts)}.`;
}

function communityLines(stats: CommunityStats | null): string[] {
  if (!stats) return [];
  const lines: string[] = [];
  const parts: string[] = [];
  if (stats.votes > 0) {
    const by =
      stats.voters > 0
        ? ` od ${polishCountingGenitive(stats.voters, "osoby", "osób")}`
        : "";
    parts.push(`${counted(stats.votes, KIND_FORMS.vote)}${by}`);
  }
  if (stats.publications > 0) {
    parts.push(counted(stats.publications, KIND_FORMS.publication));
  }
  if (parts.length > 0) {
    lines.push(`Ostatnie ${stats.days} dni na koryta.pl: ${listJoin(parts)}.`);
  }
  if (stats.toCheck && stats.toCheck > 0) {
    lines.push(
      `W kolejce do sprawdzenia: ${polishCountingGrouped(stats.toCheck, "osoba", "osoby", "osób")}.`,
    );
  }
  return lines;
}

function reasonLine(via: "optedIn" | "team", topic: CampaignTopic): string {
  return via === "team"
    ? "Dostajesz tę wiadomość, bo należysz do zespołu koryta.pl."
    : `Dostajesz tę wiadomość, bo w ustawieniach profilu zapisano Cię na „${campaignTopicLabels[topic].title}”.`;
}

const STYLE = {
  wrapper:
    "font-family: system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1c1c;",
  stats:
    "background: #f3f6f2; border-radius: 8px; padding: 4px 16px; margin: 16px 0;",
  button: `display: inline-block; background: ${ink.sage}; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;`,
  footer: "font-size: 13px; color: #666;",
};

/** The message for one recipient, both formats, and its headers. */
export function renderCampaign(args: CampaignRender): CampaignMail {
  const base = args.siteUrl.replace(/\/$/, "");
  const { content } = args;
  const body = paragraphs(content.body).map((paragraph) =>
    paragraph
      .split("\n")
      .map((line) => renderInline(line, base, args.campaignId)),
  );

  const stats = content.includeStats
    ? [personalLine(args.personal), ...communityLines(args.community)].filter(
        (line): line is string => line !== null,
      )
    : [];

  const cta =
    content.ctaLabel.trim() && content.ctaPath.startsWith("/")
      ? {
          label: content.ctaLabel.trim(),
          href: withCampaignTracking(
            `${base}${content.ctaPath}`,
            args.campaignId,
          ),
        }
      : null;

  const reason = reasonLine(args.via, content.topic);
  const settingsUrl = `${base}/profil`;
  const { pageUrl, oneClickUrl } = args.unsubscribe;

  const text = [
    ...body.map((lines) => lines.map((line) => line.text).join("\n")),
    ...stats,
    ...(cta ? [`${cta.label}: ${cta.href}`] : []),
    `${reason}\nNie chcesz takich wiadomości? Wypisz się: ${pageUrl}\nUstawienia wiadomości: ${settingsUrl}`,
  ].join("\n\n");

  const html = [
    `<div style="${STYLE.wrapper}">`,
    ...body.map(
      (lines) => `<p>${lines.map((line) => line.html).join("<br>")}</p>`,
    ),
    ...(stats.length > 0
      ? [
          `<div style="${STYLE.stats}">`,
          ...stats.map((line) => `<p>${escapeHtml(line)}</p>`),
          "</div>",
        ]
      : []),
    ...(cta
      ? [
          `<p style="margin: 24px 0;"><a href="${escapeHtml(cta.href)}" style="${STYLE.button}">${escapeHtml(cta.label)}</a></p>`,
        ]
      : []),
    '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">',
    `<p style="${STYLE.footer}">${escapeHtml(reason)} <a href="${escapeHtml(
      pageUrl,
    )}">Wypisz się</a> · <a href="${escapeHtml(settingsUrl)}">Ustawienia wiadomości</a></p>`,
    "</div>",
  ].join("\n");

  return {
    subject: content.subject.trim(),
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** Where a queued message is, as the Trigger Email extension records it on the
 * `mail` document - or `queued` while nothing has picked it up yet, which is
 * all a message ever is until the extension is installed. */
export const deliveryStates = [
  "queued",
  "PENDING",
  "PROCESSING",
  "RETRY",
  "SUCCESS",
  "ERROR",
] as const;

export type DeliveryState = (typeof deliveryStates)[number];

export const deliveryStateLabels: Record<DeliveryState, string> = {
  queued: "W kolejce",
  PENDING: "Czeka",
  PROCESSING: "Wysyłanie",
  RETRY: "Ponowna próba",
  SUCCESS: "Wysłano",
  ERROR: "Błąd",
};

/** What became of one requested recipient when a campaign was sent. */
export type SendOutcome =
  | "queued"
  /** Already had this campaign. */
  | "duplicate"
  /** No such account any more. */
  | "unknown"
  | "failed"
  | IneligibleReason;

export const sendOutcomeLabels: Record<SendOutcome, string> = {
  queued: "Wysłano do kolejki",
  duplicate: "Ma już tę kampanię",
  unknown: "Nie ma takiego konta",
  failed: "Błąd zapisu",
  ...ineligibleLabels,
};

/** One press of a send button, kept on the campaign as its history. */
export type CampaignSend = {
  at: string;
  by: string;
  /** A copy to the owner alone, which reaches no recipient. */
  test: boolean;
  outcomes: Partial<Record<SendOutcome, number>>;
};

/** A campaign as stored in `mailCampaigns/{id}`. */
export type CampaignRecord = CampaignContent & {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  /** Everybody it was queued for, ever. One campaign reaches one person
   * once, so sending it again only reaches the people added since. */
  recipients: string[];
  /** Who left a topic through this campaign's link. */
  unsubscribed: string[];
  sends: CampaignSend[];
};

/** One queued message, as far as the extension has got with it. */
export type Delivery = {
  state: DeliveryState;
  queuedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};
