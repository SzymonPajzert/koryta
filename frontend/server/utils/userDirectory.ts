import { getAuth, type UserRecord } from "firebase-admin/auth";
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import { cachedActivityWindow } from "~~/server/utils/activityWindow";
import type { ContributorAggregate } from "~~/server/utils/activityStats";
import { identify, readPublicProfiles } from "~~/server/utils/contributors";
import {
  isRoleLevel,
  roleFromClaims,
  sameRoleState,
  type RoleState,
} from "~~/shared/roles";
import { isAutomatedUid } from "~~/shared/stats";
import {
  profilePath,
  USER_ACTIVITY_WINDOW_DAYS,
  userActionKinds,
  userCollections,
  type AccessRequestDoc,
  type AdminUserDetail,
  type AdminUserRow,
  type AdminUsersResponse,
  type ProfileDoc,
  type RoleNominationDoc,
  type UserActionDoc,
  type UserListScope,
  type UserStatsDoc,
} from "~~/shared/userAdmin";

/** Everything /admin/uzytkownicy knows about an account, gathered in one place
 * so the list, the detail and the routes that change an account all answer
 * with the same row.
 *
 * Firebase Auth is the only complete list of accounts: nothing writes a
 * Firestore document when somebody signs up, and `users/{uid}` exists only for
 * people who once saved a setting. So the list is an Auth walk, and everything
 * the site keeps about an account - the nomination, the sign-ins, the request
 * for access, the public profile, the work counted on /eksploruj/statystyki -
 * is joined onto it by uid.
 *
 * Two speeds. The walk and the 90-day activity are memoized for five minutes:
 * they are the expensive part, and an account created or a vote cast a few
 * minutes ago is not what anybody opens the page for. The small collections
 * (`roleNominations`, `userStats`, `accessRequests`, `profiles`) are read fresh
 * on every request, and the accounts with a nomination or an open request are
 * re-read live from Auth, because those are the rows an administrator acts on:
 * a nomination has to show the moment it is made, and "czeka na skrypt" has to
 * go away the moment the script has run, not five minutes later.
 */

/** `listUsers` hands out at most 1000 accounts per page. */
const LIST_USERS_PAGE = 1000;

/** How many pages the walk takes before it stops - the same bound
 * `listNewAdmins` uses (server/utils/contributors.ts). Ten thousand accounts is
 * far past what the site has; the bound is there so a sign-up wave cannot turn
 * one memo refresh into an unbounded walk of the auth service. */
const LIST_USERS_MAX_PAGES = 10;

/** What the walk can return at most, which also bounds the whole-collection
 * reads below: each of those collections holds one document per account. */
const MAX_ACCOUNTS = LIST_USERS_PAGE * LIST_USERS_MAX_PAGES;

/** `getUsers` takes at most 100 identifiers per call. */
const AUTH_LOOKUP_CHUNK = 100;

/** An account this young is listed among the active ones even if it has done
 * nothing yet: a new sign-up is somebody an administrator may want to welcome,
 * or a burst of them something to notice. */
const NEW_ACCOUNT_DAYS = 30;

/** How many lines of an account's history the detail shows. */
const HISTORY_LIMIT = 200;

/** How many `userActions` rows of one account are read to find the newest
 * `HISTORY_LIMIT`. The log is read by `target` alone and sorted in memory - a
 * composite on `(target, at)` for a list this short is not worth its upkeep -
 * so the read is capped rather than ordered. An account with more lines than
 * this would be one somebody is hammering, and the warning says so. */
const HISTORY_SCAN_CAP = 1000;

/** Proposals read to count what a trial administrator filed since the trial
 * began. Newest first on the `(update_user, update_time)` composite, so a cap
 * cuts the oldest and the count is a lower bound - the busiest human account
 * has filed under a hundred in a month. */
const TRIAL_REVISION_SCAN_CAP = 500;

/** `audit` rows read to count a trial administrator's decisions. Read by
 * `user` alone and filtered on `at` in memory, because the equality plus a
 * range would want a composite that does not exist. */
const TRIAL_AUDIT_SCAN_CAP = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Accounts, from Firebase Auth

/** One account as the page needs it. Plain data rather than a `UserRecord`,
 * so it can sit in a memo and be handed to a row as is. */
export type DirectoryAccount = Pick<
  AdminUserRow,
  | "uid"
  | "displayName"
  | "email"
  | "emailVerified"
  | "disabled"
  | "providers"
  | "photoURL"
  | "createdAt"
  | "lastSignInAt"
  | "lastRefreshAt"
  | "current"
>;

/** Auth's metadata times are HTTP dates ("Sat, 05 Oct 2026 12:00:00 GMT");
 * everything else on the page is ISO 8601, so they are turned into that. */
function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function toDirectoryAccount(user: UserRecord): DirectoryAccount {
  return {
    uid: user.uid,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    providers: user.providerData.map((provider) => provider.providerId),
    photoURL: user.photoURL ?? null,
    createdAt: isoOrNull(user.metadata.creationTime),
    lastSignInAt: isoOrNull(user.metadata.lastSignInTime),
    lastRefreshAt: isoOrNull(user.metadata.lastRefreshTime),
    // From the account, never from anybody's token: a token keeps the claims
    // it was issued with for up to an hour.
    current: roleFromClaims(user.customClaims),
  };
}

/** Every account, as far as the bound allows. */
export async function walkAccounts(): Promise<{
  accounts: DirectoryAccount[];
  truncated: boolean;
}> {
  const accounts: DirectoryAccount[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < LIST_USERS_MAX_PAGES; page++) {
    const result = await getAuth().listUsers(LIST_USERS_PAGE, pageToken);
    accounts.push(...result.users.map(toDirectoryAccount));
    pageToken = result.pageToken;
    if (!pageToken) return { accounts, truncated: false };
  }

  console.warn(
    `walkAccounts: stopped after ${LIST_USERS_MAX_PAGES} pages of ` +
      `${LIST_USERS_PAGE} accounts; the users page is missing the rest`,
  );
  return { accounts, truncated: true };
}

/** Whether a string can be an Auth uid at all. The `by` of a nomination or a
 * history line can also be `script:…` or `migration:…`, and a Firebase uid
 * cannot contain a colon - asking Auth about those would only cost a call. */
function isAccountUid(uid: string): boolean {
  return uid.length > 0 && uid.length <= 128 && !uid.includes(":");
}

/** The given accounts, read live. Uids that do not resolve are left out. */
export async function readAccounts(
  uids: string[],
): Promise<Map<string, DirectoryAccount>> {
  const wanted = [...new Set(uids)].filter(isAccountUid);
  const found = new Map<string, DirectoryAccount>();

  for (let i = 0; i < wanted.length; i += AUTH_LOOKUP_CHUNK) {
    const chunk = wanted.slice(i, i + AUTH_LOOKUP_CHUNK);
    const result = await getAuth().getUsers(chunk.map((uid) => ({ uid })));
    for (const user of result.users) {
      found.set(user.uid, toDirectoryAccount(user));
    }
  }

  return found;
}

/** One account, read live, or null if there is no such account. */
export async function readAccount(
  uid: string,
): Promise<DirectoryAccount | null> {
  if (!isAccountUid(uid)) return null;
  try {
    return toDirectoryAccount(await getAuth().getUser(uid));
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") {
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// What the site keeps about an account

export type AccountActivity = NonNullable<AdminUserRow["activity"]>;

/** The part of a nomination a row shows. */
export type NominationRecord = Pick<
  RoleNominationDoc,
  "desired" | "trialStartedAt" | "applyError"
>;

export type AccountRecords = {
  nomination: NominationRecord | null;
  stats: Pick<
    UserStatsDoc,
    "signIns" | "activeDays" | "firstSeenAt" | "lastSeenAt"
  > | null;
  request: Pick<
    AccessRequestDoc,
    "reason" | "source" | "createdAt" | "status"
  > | null;
  profile: Pick<ProfileDoc, "handle" | "hidden"> | null;
  /** The last `USER_ACTIVITY_WINDOW_DAYS` days. */
  activity: AccountActivity | null;
};

/** A nomination document as the page can rely on it.
 *
 * Both the site and the Python script write these, and the script is run by
 * hand against production. A document whose `desired` names no level the site
 * knows is one the page cannot say anything true about, so it is left out of
 * the row - with a line in the log - rather than shown as something it is not.
 */
export function readNomination(
  uid: string,
  data: Partial<RoleNominationDoc> | undefined,
): NominationRecord | null {
  if (!data) return null;
  const desired = data.desired as Partial<RoleNominationDoc["desired"]> | null;
  if (!desired || !isRoleLevel(desired.level)) {
    console.warn(`roleNominations/${uid}: no readable desired level`);
    return null;
  }
  return {
    desired: {
      level: desired.level,
      trial: desired.level === "admin" && desired.trial === true,
      reason: desired.reason ?? "",
      by: desired.by ?? "",
      at: desired.at ?? "",
    },
    trialStartedAt: data.trialStartedAt ?? null,
    applyError: data.applyError ?? null,
  };
}

function toActivity(contributor: ContributorAggregate): AccountActivity {
  return {
    counts: contributor.counts,
    total: contributor.total,
    lastActiveAt: contributor.lastActiveAt,
  };
}

export type UserCollections = {
  nominations: Map<string, NominationRecord>;
  stats: Map<string, NonNullable<AccountRecords["stats"]>>;
  requests: Map<string, NonNullable<AccountRecords["request"]>>;
  profiles: Map<string, NonNullable<AccountRecords["profile"]>>;
};

/** One whole collection, keyed by document id, with only the fields a row
 * shows. */
async function readWhole<T>(
  db: Firestore,
  collection: string,
  fields: string[],
): Promise<Map<string, T>> {
  const snapshot = await db
    .collection(collection)
    .select(...fields)
    .limit(MAX_ACCOUNTS)
    .get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data() as T]));
}

/** The four small collections, whole. Each holds at most one document per
 * account, and most accounts have none, so reading them whole is cheaper than
 * reading them per row - and it is what lets a row exist for a nomination or a
 * request the five-minute memo has not seen yet. */
export async function readUserCollections(
  db: Firestore,
): Promise<UserCollections> {
  const [nominations, stats, requests, profiles] = await Promise.all([
    readWhole<Partial<RoleNominationDoc>>(db, userCollections.roleNominations, [
      "desired",
      "trialStartedAt",
      "applyError",
    ]),
    readWhole<NonNullable<AccountRecords["stats"]>>(
      db,
      userCollections.userStats,
      ["signIns", "activeDays", "firstSeenAt", "lastSeenAt"],
    ),
    readWhole<NonNullable<AccountRecords["request"]>>(
      db,
      userCollections.accessRequests,
      ["reason", "source", "createdAt", "status"],
    ),
    readWhole<NonNullable<AccountRecords["profile"]>>(
      db,
      userCollections.profiles,
      ["handle", "hidden"],
    ),
  ]);

  const readable = new Map<string, NominationRecord>();
  for (const [uid, data] of nominations) {
    const nomination = readNomination(uid, data);
    if (nomination) readable.set(uid, nomination);
  }

  return { nominations: readable, stats, requests, profiles };
}

/** The same four documents for one account. */
async function readRecordsOf(
  db: Firestore,
  uid: string,
): Promise<Omit<AccountRecords, "activity">> {
  const [nomination, stats, request, profile] = await db.getAll(
    db.collection(userCollections.roleNominations).doc(uid),
    db.collection(userCollections.userStats).doc(uid),
    db.collection(userCollections.accessRequests).doc(uid),
    db.collection(userCollections.profiles).doc(uid),
  );
  return {
    nomination: readNomination(
      uid,
      nomination?.data() as Partial<RoleNominationDoc> | undefined,
    ),
    stats: (stats?.data() as AccountRecords["stats"] | undefined) ?? null,
    request: (request?.data() as AccountRecords["request"] | undefined) ?? null,
    profile: (profile?.data() as AccountRecords["profile"] | undefined) ?? null,
  };
}

/** Display names for the given uids, from `known` where it has them and from
 * Auth for the rest. */
async function namesOf(
  uids: string[],
  known: Map<string, DirectoryAccount> = new Map(),
): Promise<Record<string, string | null>> {
  const names: Record<string, string | null> = {};
  const missing: string[] = [];
  for (const uid of new Set(uids)) {
    if (!isAccountUid(uid)) continue;
    const account = known.get(uid);
    if (account) names[uid] = account.displayName;
    else missing.push(uid);
  }
  if (missing.length > 0) {
    const found = await identify(missing);
    for (const uid of missing) names[uid] = found[uid]?.displayName ?? null;
  }
  return names;
}

// ---------------------------------------------------------------------------
// Rows

/** Whether an account belongs on the default list (`?zakres=aktywni`).
 *
 * Most accounts were opened once and never used, and an administrator looking
 * for the team should not have to scroll past them. What keeps an account on
 * the list is anything that says somebody is, or is about to be, part of the
 * work: a role, a nomination, a request, a recorded sign-in, anything counted
 * in the last 90 days, or an account new enough that nothing could have been
 * counted yet.
 *
 * A robot - a pipeline or migration uid - is listed only while it holds a
 * role, which is the one thing about it an administrator may need to act on.
 * Its writes are not anybody's work (`isAutomatedUid`), and a pipeline login
 * gets its claims from a custom token rather than the account.
 */
export function isActiveAccount(
  account: DirectoryAccount,
  records: AccountRecords,
  now: Date,
): boolean {
  const holdsRole = account.current.level !== "normal";
  if (isAutomatedUid(account.uid)) return holdsRole;
  if (holdsRole) return true;
  if (
    records.nomination ||
    records.request ||
    records.stats ||
    records.activity
  ) {
    return true;
  }
  const created = account.createdAt ? Date.parse(account.createdAt) : NaN;
  return (
    !Number.isNaN(created) &&
    now.getTime() - created <= NEW_ACCOUNT_DAYS * DAY_MS
  );
}

/** One row of the users page.
 *
 * Whether a nomination is pending is decided here and only here: `desired`
 * against the claims the account holds now. Never against `applied`, which is
 * the script's receipt - a claim changed by hand in the console has no receipt
 * and still has to show up as a difference.
 */
export function buildUserRow(
  account: DirectoryAccount,
  records: AccountRecords & { publicProfile: boolean },
  names: Record<string, string | null>,
): AdminUserRow {
  const { nomination, stats, request, profile, activity } = records;
  return {
    ...account,
    nomination: nomination
      ? {
          desired: {
            ...nomination.desired,
            byName: names[nomination.desired.by] ?? null,
          },
          pending: !sameRoleState(nomination.desired, account.current),
          applyError: nomination.applyError,
        }
      : null,
    trialStartedAt: nomination?.trialStartedAt ?? null,
    signIns: stats
      ? {
          count: stats.signIns,
          activeDays: stats.activeDays,
          firstSeenAt: stats.firstSeenAt,
          lastSeenAt: stats.lastSeenAt,
        }
      : null,
    activity,
    accessRequest: request
      ? {
          reason: request.reason,
          source: request.source,
          createdAt: request.createdAt,
          status: request.status,
        }
      : null,
    profile: {
      handle: profile?.handle ?? null,
      public: records.publicProfile,
      hidden: !!profile?.hidden,
    },
    robot: isAutomatedUid(account.uid),
  };
}

/** The last time anything says the account was used, for ordering. */
function lastSignOfLife(row: AdminUserRow): number {
  return Math.max(
    0,
    ...[
      row.lastRefreshAt,
      row.lastSignInAt,
      row.signIns?.lastSeenAt,
      row.activity?.lastActiveAt,
      row.createdAt,
    ]
      .map((at) => (at ? Date.parse(at) : NaN))
      .filter((time) => !Number.isNaN(time)),
  );
}

export type UserDirectory = {
  accounts: DirectoryAccount[];
  truncated: boolean;
  /** The 90-day counts of everybody who did anything, by uid. */
  activity: Record<string, AccountActivity>;
  /** When the walk was taken. */
  generatedAt: string;
};

/** The Auth walk and the activity join, memoized for five minutes.
 *
 * What it holds - every account's address, every contributor's counts - is
 * only ever handed to an established administrator, the one kind of caller the
 * routes that read it let in, so there is nothing in it to strip per caller.
 * The counts come out of the same memo as the public ranking
 * (`cachedActivityWindow`), so the page and /eksploruj/statystyki cannot
 * disagree about what somebody did.
 */
export const cachedUserDirectory = defineCachedFunction(
  async (): Promise<UserDirectory> => {
    const [walk, windowed] = await Promise.all([
      walkAccounts(),
      cachedActivityWindow(USER_ACTIVITY_WINDOW_DAYS),
    ]);
    const activity: Record<string, AccountActivity> = {};
    for (const contributor of windowed.aggregate.contributors) {
      activity[contributor.uid] = toActivity(contributor);
    }
    return {
      accounts: walk.accounts,
      truncated: walk.truncated,
      activity,
      generatedAt: new Date().toISOString(),
    };
  },
  {
    name: "admin-users-directory",
    maxAge: 300,
    swr: true,
    getKey: () => "all",
  },
);

/** `GET /api/admin/users`. */
export async function listUserRows(
  db: Firestore,
  scope: UserListScope,
  now: Date = new Date(),
): Promise<AdminUsersResponse> {
  const [directory, collections] = await Promise.all([
    cachedUserDirectory(),
    readUserCollections(db),
  ]);

  const accounts = new Map(
    directory.accounts.map((account) => [account.uid, account]),
  );

  // The rows an administrator is about to act on are read live, so a pending
  // nomination clears the moment the script has applied it and a request from
  // an account opened a minute ago has somebody to belong to. An account that
  // turns out to be gone is dropped, whatever the memo remembers.
  const watched = [
    ...collections.nominations.keys(),
    ...[...collections.requests]
      .filter(([, request]) => request.status === "open")
      .map(([uid]) => uid),
  ].filter(isAccountUid);
  const live = await readAccounts(watched);
  for (const uid of watched) {
    const account = live.get(uid);
    if (account) accounts.set(uid, account);
    else accounts.delete(uid);
  }

  const entries = [...accounts.values()].map((account) => ({
    account,
    records: {
      nomination: collections.nominations.get(account.uid) ?? null,
      stats: collections.stats.get(account.uid) ?? null,
      request: collections.requests.get(account.uid) ?? null,
      profile: collections.profiles.get(account.uid) ?? null,
      activity: directory.activity[account.uid] ?? null,
    },
  }));
  const kept =
    scope === "wszyscy"
      ? entries
      : entries.filter(({ account, records }) =>
          isActiveAccount(account, records, now),
        );

  // Only for the rows that are going out: the `users` collection has a
  // document for everybody who ever saved a setting, and the default list is a
  // fraction of that.
  const [publicProfiles, names] = await Promise.all([
    readPublicProfiles(
      db,
      kept.map(({ account }) => account.uid),
    ),
    namesOf(
      kept.flatMap(({ records }) =>
        records.nomination ? [records.nomination.desired.by] : [],
      ),
      accounts,
    ),
  ]);

  const users = kept
    .map(({ account, records }) =>
      buildUserRow(
        account,
        { ...records, publicProfile: publicProfiles[account.uid] ?? false },
        names,
      ),
    )
    .sort(
      (a, b) =>
        lastSignOfLife(b) - lastSignOfLife(a) || (a.uid < b.uid ? -1 : 1),
    );

  return {
    users,
    scope,
    truncated: directory.truncated,
    generatedAt: directory.generatedAt,
  };
}

/** The row of one account that has just been read live - what the detail and
 * every route that changes an account hand back, so the page can replace the
 * row it shows without reloading the list. */
export async function buildRowFor(
  db: Firestore,
  account: DirectoryAccount,
): Promise<AdminUserRow> {
  const [records, publicProfiles, windowed] = await Promise.all([
    readRecordsOf(db, account.uid),
    readPublicProfiles(db, [account.uid]),
    cachedActivityWindow(USER_ACTIVITY_WINDOW_DAYS),
  ]);
  const contributor = windowed.aggregate.contributors.find(
    (candidate) => candidate.uid === account.uid,
  );
  const names = await namesOf(
    records.nomination ? [records.nomination.desired.by] : [],
  );
  return buildUserRow(
    account,
    {
      ...records,
      activity: contributor ? toActivity(contributor) : null,
      publicProfile: publicProfiles[account.uid] ?? false,
    },
    names,
  );
}

// ---------------------------------------------------------------------------
// The detail

export type LifetimeCounts = AdminUserDetail["lifetime"];

async function counted(query: Query): Promise<number> {
  return (await query.count().get()).data().count;
}

/** Everything an account has done since it was created, by document.
 *
 * Every number is a `count()` on one or more equalities, which Firestore
 * answers from the automatic single-field indexes - an equality-only query
 * merges them - and bills at one read per thousand matches rather than one per
 * document.
 *
 * Proposals are the hand-made ones (`update_automatic == false`), as on
 * /profil and in the public profile. That misses the 1,760 revisions written
 * before the flag existed, which are nearly all the owner's and the pipeline's
 * under one uid (see /api/revisions/queue); a count cannot tell those apart
 * either. "Oczekuje" is what is left once the approved and the rejected are
 * taken away, which also counts the ones whose stored status was never set.
 */
export async function countLifetime(
  db: Firestore,
  uid: string,
): Promise<LifetimeCounts> {
  const proposals = db
    .collection("revisions")
    .where("update_user", "==", uid)
    .where("update_automatic", "==", false);

  const [
    votes,
    notes,
    total,
    approved,
    rejected,
    decisions,
    feedback,
    qaChecks,
    comments,
    images,
  ] = await Promise.all([
    counted(db.collection("votes").where("userUid", "==", uid)),
    counted(db.collection("notes").where("userUid", "==", uid)),
    counted(proposals),
    counted(proposals.where("status", "==", "approved")),
    counted(proposals.where("status", "==", "rejected")),
    counted(db.collection("audit").where("user", "==", uid)),
    counted(db.collection("feedback").where("userUid", "==", uid)),
    counted(db.collection("qaChecks").where("userUid", "==", uid)),
    counted(db.collection("comments").where("authorId", "==", uid)),
    counted(db.collection("images").where("uploadedBy", "==", uid)),
  ]);

  return {
    votes,
    notes,
    revisions: {
      total,
      approved,
      rejected,
      pending: Math.max(0, total - approved - rejected),
    },
    decisions,
    feedback,
    qaChecks,
    comments,
    images,
  };
}

/** `countLifetime`, memoized per account for five minutes: ten aggregations
 * is cheap once and not worth paying on every open and close of a row. The
 * route checks that the account exists before it asks, so a caller cannot
 * fill the memo with keys of their choosing. */
export const cachedLifetimeCounts = defineCachedFunction(
  (uid: string): Promise<LifetimeCounts> =>
    countLifetime(getFirestore("koryta-pl"), uid),
  {
    name: "admin-user-lifetime",
    maxAge: 300,
    swr: true,
    getKey: (uid: string) => uid,
  },
);

export type TrialCounts = Pick<
  NonNullable<AdminUserDetail["trial"]>,
  "revisions" | "decisions"
>;

/** What an administrator on trial did since the trial began: proposals filed
 * by hand, and decisions in `audit` (approvals, rejections, publications,
 * merges). The numbers the established administrators read before they end a
 * trial either way. */
export async function countTrial(
  db: Firestore,
  uid: string,
  startedAt: string,
): Promise<TrialCounts> {
  const start = Date.parse(startedAt);

  const [revisions, audit] = await Promise.all([
    // `update_time` is a Timestamp; the composite (update_user ASC,
    // update_time DESC) answers this. Automatic revisions are dropped in
    // memory, as /api/revisions/mine does: a third of the history carries no
    // flag at all, and an equality would match none of it.
    db
      .collection("revisions")
      .where("update_user", "==", uid)
      .where("update_time", ">=", Timestamp.fromMillis(start))
      .orderBy("update_time", "desc")
      .select("update_automatic")
      .limit(TRIAL_REVISION_SCAN_CAP)
      .get(),
    db
      .collection("audit")
      .where("user", "==", uid)
      .select("at")
      .limit(TRIAL_AUDIT_SCAN_CAP)
      .get(),
  ]);

  if (revisions.size >= TRIAL_REVISION_SCAN_CAP) {
    console.warn(`countTrial(${uid}): proposals capped at ${revisions.size}`);
  }
  if (audit.size >= TRIAL_AUDIT_SCAN_CAP) {
    console.warn(`countTrial(${uid}): decisions capped at ${audit.size}`);
  }

  return {
    revisions: revisions.docs.filter(
      (doc) => doc.get("update_automatic") !== true,
    ).length,
    // `at` is an ISO string, but the script writes its own in Python's format
    // (`+00:00` rather than `Z`), so the comparison is on instants, not text.
    decisions: audit.docs.filter((doc) => {
      const at = Date.parse(String(doc.get("at") ?? ""));
      return !Number.isNaN(at) && at >= start;
    }).length,
  };
}

/** `countTrial`, memoized for five minutes per account and trial start - a
 * trial is opened and reopened while the administrators make up their minds. */
export const cachedTrialCounts = defineCachedFunction(
  (uid: string, startedAt: string): Promise<TrialCounts> =>
    countTrial(getFirestore("koryta-pl"), uid, startedAt),
  {
    name: "admin-user-trial",
    maxAge: 300,
    swr: true,
    getKey: (uid: string, startedAt: string) => `${uid}@${startedAt}`,
  },
);

/** The trial an account is on, if it is on one whose start was recorded.
 *
 * Only while the claims say trial: `trialStartedAt` outlives a trial ended by
 * hand in the console, and a closed trial has nothing left to decide. A trial
 * nobody recorded the start of - granted before nominations existed and not in
 * the script's legacy table - has no numbers to show, so it shows none rather
 * than counting from an invented date.
 */
export async function trialOf(
  row: AdminUserRow,
  now: Date = new Date(),
): Promise<AdminUserDetail["trial"]> {
  if (!row.current.trial || !row.trialStartedAt) return null;
  const start = Date.parse(row.trialStartedAt);
  if (Number.isNaN(start)) return null;
  const counts = await cachedTrialCounts(row.uid, row.trialStartedAt);
  return {
    startedAt: row.trialStartedAt,
    days: Math.max(0, Math.floor((now.getTime() - start) / DAY_MS)),
    ...counts,
  };
}

/** The account's history, newest first, with the names of whoever acted. */
export async function readHistory(
  db: Firestore,
  uid: string,
): Promise<AdminUserDetail["history"]> {
  const snapshot = await db
    .collection(userCollections.userActions)
    .where("target", "==", uid)
    .limit(HISTORY_SCAN_CAP)
    .get();
  if (snapshot.size >= HISTORY_SCAN_CAP) {
    console.warn(`readHistory(${uid}): capped at ${snapshot.size} lines`);
  }

  const time = (at: string) => {
    const parsed = Date.parse(at);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const lines = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as UserActionDoc) }))
    .filter((line) =>
      (userActionKinds as readonly string[]).includes(line.kind),
    )
    .sort((a, b) => time(b.at) - time(a.at))
    .slice(0, HISTORY_LIMIT);

  const names = await namesOf(lines.map((line) => line.by));
  return lines.map((line) => ({
    id: line.id,
    kind: line.kind,
    target: line.target,
    by: line.by,
    at: line.at,
    ...(line.reason !== undefined ? { reason: line.reason } : {}),
    ...(line.from !== undefined ? { from: line.from } : {}),
    ...(line.to !== undefined ? { to: line.to } : {}),
    ...(line.detail !== undefined ? { detail: line.detail } : {}),
    byName: names[line.by] ?? null,
  }));
}

/** Where else the page sends an administrator about this account. */
export function userLinks(row: AdminUserRow): AdminUserDetail["links"] {
  const uid = encodeURIComponent(row.uid);
  return {
    revisions: `/admin/rewizje?author=${uid}&status=all&automatic=all#kolejka`,
    activity: `/aktywnosc?kto=${uid}`,
    // Only a profile anybody can open: switched on, not hidden, and with a
    // handle to be opened under.
    profile:
      row.profile.public && !row.profile.hidden && row.profile.handle
        ? profilePath(row.profile.handle)
        : null,
  };
}

/** A role as `userActions.to` and a nomination's `desired` store it: the level
 * and the trial, without the owner flag a live role carries or the reason and
 * author a wish carries. */
export const roleState = (role: RoleState): RoleState => ({
  level: role.level,
  trial: role.trial,
});
