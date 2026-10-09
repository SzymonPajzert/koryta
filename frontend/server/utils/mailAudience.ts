import { getAuth, type UserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { mergeRollups } from "~~/server/utils/activityRollup";
import { loadActivityRollups } from "~~/server/utils/activityWindow";
import { isNewAdmin } from "~~/server/utils/contributors";
import type { QueueTierStats } from "~~/server/api/stats/queueTiers.get";
import { emptyActivityCounts } from "~~/shared/activity";
import {
  CAMPAIGN_STATS_DAYS,
  COMMUNITY_STATS_DAYS,
  campaignTopics,
  type Audience,
  type AudienceMember,
  type CampaignTopic,
  type MailPreferences,
} from "~~/shared/campaigns";

/** `listUsers` hands out at most 1000 accounts per page. */
const LIST_USERS_PAGE = 1000;

/** Ten thousand accounts is far past what the site has. The bound keeps a
 * sign-up wave from turning one page load into an unbounded walk of the auth
 * service. */
const LIST_USERS_MAX_PAGES = 10;

/** `getAll` takes its references as one argument list. */
const PREFERENCES_CHUNK = 300;

/** Every account the site could write to, with what a campaign needs to know
 * about each: whether it may be written to, how recently it was around and
 * what it did - and the site-wide numbers a message can quote.
 *
 * Built fresh on each call, for the owner's page alone. Two hundred accounts
 * are one page of the auth service, one batched read of `users` and the same
 * stored days the stats page reads, so there is nothing worth caching, and a
 * cached copy would show a consent somebody withdrew a minute ago.
 *
 * @param toCheck people waiting in the queue, if the caller knows; it is
 * passed through to the numbers a message quotes.
 */
export async function loadAudience(
  db: Firestore,
  options: { now?: Date; toCheck?: number | null } = {},
): Promise<Audience> {
  const now = options.now ?? new Date();
  const [accounts, activity] = await Promise.all([
    listAccounts(),
    loadActivityRollups(db, CAMPAIGN_STATS_DAYS, now),
  ]);
  const preferences = await readMailPreferences(
    db,
    accounts.map((account) => account.uid),
  );

  const long = mergeRollups(activity.spanned, activity.rollups);
  const recentDays = activity.spanned.slice(-COMMUNITY_STATS_DAYS);
  const inRecent = new Set(recentDays);
  const recent = mergeRollups(
    recentDays,
    activity.rollups.filter((rollup) => inRecent.has(rollup.date)),
  );

  const contributions = new Map(long.contributors.map((c) => [c.uid, c]));
  const members = accounts
    .map((account) =>
      toMember(
        account,
        contributions.get(account.uid),
        preferences[account.uid] ?? {},
      ),
    )
    .sort(byLastSeen);

  return {
    members,
    community: {
      days: COMMUNITY_STATS_DAYS,
      votes: recent.totals.vote,
      voters: recent.contributors.filter((c) => c.counts.vote > 0).length,
      publications: recent.totals.publication,
      toCheck: options.toCheck ?? null,
    },
    generatedAt: now.toISOString(),
  };
}

/** People nobody has checked yet, summed over the queue's tiers: the count
 * /pomoc shows, read through its own five-minute cache. Null when it cannot be
 * had, and a message then leaves the line out rather than say "0". */
export async function queueToCheck(
  fetchTiers: () => Promise<QueueTierStats> = () =>
    $fetch<QueueTierStats>("/api/stats/queueTiers"),
): Promise<number | null> {
  try {
    const known = (await fetchTiers()).tiers
      .map((tier) => tier.toCheck)
      .filter((count): count is number => typeof count === "number");
    return known.length > 0
      ? known.reduce((sum, count) => sum + count, 0)
      : null;
  } catch (error) {
    console.warn("queueToCheck: the queue count is unavailable", error);
    return null;
  }
}

async function listAccounts(): Promise<UserRecord[]> {
  const found: UserRecord[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < LIST_USERS_MAX_PAGES; page++) {
    const result = await getAuth().listUsers(LIST_USERS_PAGE, pageToken);
    found.push(...result.users);
    pageToken = result.pageToken;
    if (!pageToken) return found;
  }
  console.warn(
    `loadAudience: stopped after ${LIST_USERS_MAX_PAGES} pages of ` +
      `${LIST_USERS_PAGE} accounts; the accounts past that are missing`,
  );
  return found;
}

/** The two fields campaigns read off each `users` document, and nothing else.
 *
 * The field mask is not an optimisation: the document is writable by its owner
 * with no constraint on shape, so this takes only booleans where booleans are
 * expected, and an odd value counts as no answer rather than a yes.
 */
export async function readMailPreferences(
  db: Firestore,
  uids: string[],
): Promise<Record<string, MailPreferences>> {
  const found: Record<string, MailPreferences> = {};
  for (let i = 0; i < uids.length; i += PREFERENCES_CHUNK) {
    const chunk = uids.slice(i, i + PREFERENCES_CHUNK);
    const snapshots = await db.getAll(
      ...chunk.map((uid) => db.collection("users").doc(uid)),
      { fieldMask: ["newsletter", "teamMail"] },
    );
    for (const snapshot of snapshots) {
      found[snapshot.id] = mailPreferences(snapshot.data());
    }
  }
  return found;
}

function mailPreferences(
  data: Record<string, unknown> | undefined,
): MailPreferences {
  const preferences: MailPreferences = {};
  const newsletter = data?.newsletter;
  if (newsletter && typeof newsletter === "object") {
    const topics: Partial<Record<CampaignTopic, boolean>> = {};
    for (const topic of campaignTopics) {
      const choice = (newsletter as Record<string, unknown>)[topic];
      if (typeof choice === "boolean") topics[topic] = choice;
    }
    preferences.newsletter = topics;
  }
  if (typeof data?.teamMail === "boolean") preferences.teamMail = data.teamMail;
  return preferences;
}

/** An auth-service time - an HTTP date, or an ISO one for the refresh time -
 * as ISO, or null. */
function isoTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function toMember(
  account: UserRecord,
  contribution:
    | {
        counts: AudienceMember["activity"]["counts"];
        total: number;
        lastActiveAt: string;
      }
    | undefined,
  preferences: MailPreferences,
): AudienceMember {
  const claims = account.customClaims;
  const lastSignInAt = isoTime(account.metadata.lastSignInTime);
  const seen = [
    lastSignInAt,
    isoTime(account.metadata.lastRefreshTime),
    isoTime(contribution?.lastActiveAt),
  ].filter((time): time is string => time !== null);

  return {
    uid: account.uid,
    email: account.email ?? null,
    emailVerified: account.emailVerified,
    disabled: account.disabled,
    displayName: account.displayName ?? null,
    admin: claims?.admin === true,
    newAdmin: isNewAdmin(claims),
    owner: claims?.owner === true,
    createdAt: isoTime(account.metadata.creationTime),
    lastSignInAt,
    lastSeenAt: seen.length > 0 ? seen.sort().at(-1)! : null,
    activity: contribution
      ? { counts: { ...contribution.counts }, total: contribution.total }
      : { counts: emptyActivityCounts(), total: 0 },
    preferences,
  };
}

function byLastSeen(a: AudienceMember, b: AudienceMember): number {
  if (a.lastSeenAt !== b.lastSeenAt) {
    if (!a.lastSeenAt) return 1;
    if (!b.lastSeenAt) return -1;
    return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
  }
  return a.uid < b.uid ? -1 : 1;
}
