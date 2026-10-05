/** Accounts as the site keeps them beyond Firebase Auth: who was nominated to
 * what, how often somebody signs in, who asked for access, and the public
 * profile they chose to have.
 *
 * Every collection here is written by the server (or the claims script) with
 * the admin SDK and closed to the client in `firestore.rules`. None of it lives
 * in `users/{uid}`: that document is writable by its owner with no constraint
 * on shape, so a level, a counter or a handle kept there would be one anybody
 * could set on themselves - the reason user badges were turned down on 09-12
 * and `newAdmin` is a claim (server/utils/contributors.ts).
 *
 * The one exception is `users/{uid}.claimsChangedAt`, which the claims script
 * writes after it changes somebody's claims. It is a hint and nothing else: the
 * open tab watching that document fetches a fresh token when it moves, and a
 * forged value only makes the forger's own browser do that.
 */
import { z } from "zod";
import type { ActivityCounts } from "./activity";
import {
  isRoleLevel,
  roleLevels,
  type CurrentRole,
  type RoleLevel,
  type RoleState,
} from "./roles";

export const userCollections = {
  /** `roleNominations/{uid}`: the role somebody should have, and the one the
   * script last gave them. */
  roleNominations: "roleNominations",
  /** `userActions/{auto}`: append-only, everything done to an account. */
  userActions: "userActions",
  /** `userStats/{uid}`: sign-ins and active days. */
  userStats: "userStats",
  /** `accessRequests/{uid}`: one standing request per account. */
  accessRequests: "accessRequests",
  /** `profiles/{uid}`: the public profile's handle, the avatar the server
   * stored for the account, and whether an administrator hid the profile. */
  profiles: "profiles",
  /** `profileHandles/{handle}`: who a handle belongs to, so a handle is unique
   * by being a document id. */
  profileHandles: "profileHandles",
} as const;

// ---------------------------------------------------------------------------
// Nominations

/** `roleNominations/{uid}`.
 *
 * A desired state, not a request log: the document says what the account should
 * hold, and a nomination overwrites `desired`. That is what lets a nomination
 * take a role away ("Uczestnik") or end a trial - the script compares the
 * account's live claims with `desired` and asks the owner about any difference,
 * so "no document" can never mean "demote". The history lives in
 * `userActions`.
 *
 * Whether a nomination is pending is never read off `applied`: the page
 * compares `desired` with the live claims, so a claim changed by hand in the
 * console still shows up as a difference. `applied` is the script's receipt. */
export type RoleNominationDoc = {
  desired: RoleState & {
    reason: string;
    /** uid of the established administrator who nominated, or
     * `migration:set_auth_claims` for the documents seeded from the claims
     * accounts held when this collection was introduced. */
    by: string;
    /** ISO 8601. */
    at: string;
  };
  applied:
    | (RoleState & {
        at: string;
        /** `script:set_auth_claims@<host>`. */
        by: string;
      })
    | null;
  /** When the account's current trial began: written by the script when it
   * grants `newAdmin`, cleared when it takes it away. Null outside a trial, and
   * for a trial whose start nobody recorded. */
  trialStartedAt: string | null;
  /** Why the script could not apply `desired` the last time it tried - the
   * account is gone, or its address is not verified. Cleared on success. */
  applyError: { at: string; message: string } | null;
};

export const NOMINATION_REASON = { min: 3, max: 500 } as const;

/** Levels that publish without review (`datascience` opens the ingest, which
 * honours `autoapprove`) or decide what is published. They need an account
 * whose address is proven: anybody may register with anybody's email, and the
 * name and address on an account are what the nominator recognises. */
export const levelsNeedingVerifiedEmail: readonly RoleLevel[] = [
  "datascience",
  "admin",
];

/** After how many days a trial is listed for a decision. */
export const TRIAL_REVIEW_DAYS = 30;

export const nominateBodySchema = z.object({
  uid: z.string().min(1).max(128),
  level: z.enum(roleLevels),
  trial: z.boolean().default(false),
  reason: z
    .string()
    .trim()
    .min(NOMINATION_REASON.min)
    .max(NOMINATION_REASON.max),
});
export type NominateBody = z.input<typeof nominateBodySchema>;

export const withdrawBodySchema = z.object({
  uid: z.string().min(1).max(128),
  reason: z.string().trim().max(NOMINATION_REASON.max).optional(),
});
export type WithdrawBody = z.input<typeof withdrawBodySchema>;

// ---------------------------------------------------------------------------
// The log

export const userActionKinds = [
  "nominate",
  "withdraw",
  "apply",
  "seed",
  "removeAvatar",
  "resetName",
  "hideProfile",
  "unhideProfile",
  "accessRequest",
  "dismissRequest",
] as const;

export type UserActionKind = (typeof userActionKinds)[number];

/** `userActions/{auto}`. Read per account with `where("target", "==", uid)`
 * and sorted in memory, so it needs no composite index. Not part of `audit`:
 * that collection is about pages and relations, and every reader of it -
 * /aktywnosc, the activity counts, the Python audit invariants - assumes a
 * node or an edge behind `target_id`. */
export type UserActionDoc = {
  kind: UserActionKind;
  /** The account acted on. */
  target: string;
  /** uid of whoever did it, or `script:…` / `migration:…`. */
  by: string;
  /** ISO 8601. */
  at: string;
  reason?: string;
  /** For role changes: before and after. */
  from?: CurrentRole | null;
  to?: RoleState | null;
  /** Anything else worth reading later, e.g. the name that was reset. */
  detail?: string;
};

export const userActionLabels: Record<UserActionKind, string> = {
  nominate: "Nominacja",
  withdraw: "Wycofanie nominacji",
  apply: "Nadanie uprawnień skryptem",
  seed: "Przeniesienie uprawnień do bazy",
  removeAvatar: "Usunięcie zdjęcia profilowego",
  resetName: "Usunięcie nazwy użytkownika",
  hideProfile: "Ukrycie profilu",
  unhideProfile: "Przywrócenie profilu",
  accessRequest: "Prośba o dostęp",
  dismissRequest: "Odrzucenie prośby o dostęp",
};

// ---------------------------------------------------------------------------
// Sign-ins

/** `userStats/{uid}`, written by `POST /api/users/seen`.
 *
 * A sign-in is a distinct `auth_time` on a verified ID token: Firebase keeps a
 * session for days (9-11 observed), and every token refreshed from it carries
 * the `auth_time` of the sign-in that started it. So `signIns` counts actual
 * sign-ins, which are rare, and `activeDays` counts the UTC days the person
 * opened the site while signed in - the number that says how often they come
 * back. No page addresses, no IPs. Nothing is recorded on autopush, which
 * writes to the production database too. */
export type UserStatsDoc = {
  firstSeenAt: string;
  lastSeenAt: string;
  /** `YYYY-MM-DD`, UTC. */
  lastActiveDay: string;
  activeDays: number;
  signIns: number;
  /** The newest `auth_time`s seen (seconds), so a ping from a browser signed
   * in before another one is not counted twice. */
  recentAuthTimes: number[];
  /** `firebase.sign_in_provider` of the latest sign-in. */
  lastProvider: string | null;
};

export const RECENT_AUTH_TIMES = 20;

// ---------------------------------------------------------------------------
// Access requests

export const accessRequestSources = [
  "pomoc",
  "rozszerzenie",
  "profil",
] as const;
export type AccessRequestSource = (typeof accessRequestSources)[number];

export const accessRequestStatuses = [
  "open",
  "nominated",
  "dismissed",
] as const;
export type AccessRequestStatus = (typeof accessRequestStatuses)[number];

/** `accessRequests/{uid}`: somebody asking for the team's tools (the
 * `datascience` level), which used to be "write by mail or on Slack". One per
 * account; a handled request can be renewed after
 * `ACCESS_REQUEST_COOLDOWN_DAYS`. */
export type AccessRequestDoc = {
  reason: string;
  source: AccessRequestSource;
  createdAt: string;
  status: AccessRequestStatus;
  handledBy: string | null;
  handledAt: string | null;
  handledReason: string | null;
};

export const ACCESS_REQUEST_REASON = { min: 10, max: 1000 } as const;
export const ACCESS_REQUEST_COOLDOWN_DAYS = 7;

export const accessRequestBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(ACCESS_REQUEST_REASON.min)
    .max(ACCESS_REQUEST_REASON.max),
  source: z.enum(accessRequestSources),
});
export type AccessRequestBody = z.input<typeof accessRequestBodySchema>;

export const dismissRequestBodySchema = z.object({
  uid: z.string().min(1).max(128),
  reason: z.string().trim().max(NOMINATION_REASON.max).optional(),
});
export type DismissRequestBody = z.input<typeof dismissRequestBodySchema>;

/** `GET /api/users/access-request`: the caller's own request. */
export type OwnAccessRequest = {
  request: Pick<AccessRequestDoc, "status" | "createdAt" | "source"> | null;
  /** Whether the form may be sent now. */
  canRequest: boolean;
  /** When a handled request may be renewed, if not now. */
  retryAfter: string | null;
  /** The caller already holds the team's tools. */
  hasAccess: boolean;
};

// ---------------------------------------------------------------------------
// Profiles

/** `profiles/{uid}`. */
export type ProfileDoc = {
  handle: string | null;
  /** The `images/<id>` the account's own picture is. The one avatar a public
   * surface may show: Auth `photoURL` and `users/{uid}.photoURL` can both be
   * pointed anywhere from the browser. */
  avatarImageId: string | null;
  /** Set by an administrator; a hidden profile is a 404. */
  hidden: { by: string; at: string; reason: string } | null;
};

/** `profileHandles/{handle}`. */
export type ProfileHandleDoc = { uid: string; createdAt: string };

/** 3-30 characters: lowercase ASCII letters, digits and inner hyphens - what
 * `createSlug` makes of a name. */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;

/** Handles that would read as the site speaking, or collide with a word the
 * site uses. Compared after folding, like every handle. */
export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "administrator",
  "administracja",
  "redakcja",
  "koryta",
  "korytapl",
  "koryta-pl",
  "moderator",
  "moderacja",
  "zespol",
  "wlasciciel",
  "support",
  "pomoc",
  "kontakt",
  "uczestnik",
  "anonim",
  "system",
  "root",
  "null",
  "undefined",
];

export const isValidHandle = (handle: string) =>
  HANDLE_PATTERN.test(handle) &&
  !handle.includes("--") &&
  !RESERVED_HANDLES.includes(handle);

export const profilePath = (handle: string) => `/uczestnik/${handle}`;

export const handleBodySchema = z.object({
  handle: z.string().trim().toLowerCase().refine(isValidHandle, {
    message:
      "Adres profilu: 3-30 znaków, małe litery bez polskich znaków, cyfry i myślniki w środku.",
  }),
});
export type HandleBody = z.input<typeof handleBodySchema>;

/** `GET /api/users/profile`: the caller's own profile settings. */
export type OwnProfileSettings = {
  /** The `publicProfile` switch on `users/{uid}`, which also turns the public
   * profile on. */
  publicProfile: boolean;
  handle: string | null;
  /** `/uczestnik/<handle>` when the profile can be opened by others. */
  path: string | null;
  hidden: boolean;
  /** `/api/images/<id>` of the account's own picture, if it has one. */
  avatar: string | null;
};

/** `GET /api/profiles/<handle>`: what anybody may see of a contributor who
 * opted in. Counts, never a list: a list of what somebody rated would hand out
 * the uid every rating is stored under, and with it everything they did before
 * they opted in. */
export type PublicProfile = {
  handle: string;
  name: string;
  /** `/api/images/<id>`, or null for initials. */
  avatar: string | null;
  /** `YYYY-MM` the account was created. */
  joined: string | null;
  counts: {
    /** Ratings of people and facts. */
    votes: number;
    notes: number;
    /** Changes proposed by hand. */
    proposals: number;
    /** Of those, accepted by the editors. */
    accepted: number;
  };
};

// ---------------------------------------------------------------------------
// Moderation

export const moderationActions = [
  "removeAvatar",
  "resetName",
  "hideProfile",
  "unhideProfile",
] as const;
export type ModerationAction = (typeof moderationActions)[number];

export const MODERATION_REASON = { min: 3, max: 500 } as const;

export const moderateBodySchema = z.object({
  uid: z.string().min(1).max(128),
  action: z.enum(moderationActions),
  reason: z
    .string()
    .trim()
    .min(MODERATION_REASON.min)
    .max(MODERATION_REASON.max),
});
export type ModerateBody = z.input<typeof moderateBodySchema>;

// ---------------------------------------------------------------------------
// The users page

/** `GET /api/admin/users?zakres=`: `aktywni` (the default) is every account
 * that holds a role, was nominated, asked for access, signed in since sign-ins
 * were recorded, or did anything in the last 90 days; `wszyscy` is every
 * account. */
export const userListScopes = ["aktywni", "wszyscy"] as const;
export type UserListScope = (typeof userListScopes)[number];

export const USER_ACTIVITY_WINDOW_DAYS = 90;

export type AdminUserRow = {
  uid: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  disabled: boolean;
  /** `providerData` ids: `google.com`, `password`. */
  providers: string[];
  /** Auth's, as `/api/users/lookup` hands it to administrators. */
  photoURL: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** Auth's `lastRefreshTime`: the last time a browser refreshed a token, so
   * roughly the last time the site was open. */
  lastRefreshAt: string | null;
  /** From the account's claims, read now - not from anybody's token. */
  current: CurrentRole;
  nomination: {
    desired: RoleState & {
      reason: string;
      by: string;
      byName: string | null;
      at: string;
    };
    /** `desired` differs from `current`: the script has something to do. */
    pending: boolean;
    applyError: { at: string; message: string } | null;
  } | null;
  trialStartedAt: string | null;
  signIns: {
    count: number;
    activeDays: number;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
  /** The last `USER_ACTIVITY_WINDOW_DAYS` days, counted as on
   * /eksploruj/statystyki. */
  activity: {
    counts: ActivityCounts;
    total: number;
    lastActiveAt: string;
  } | null;
  accessRequest: Pick<
    AccessRequestDoc,
    "reason" | "source" | "createdAt" | "status"
  > | null;
  profile: { handle: string | null; public: boolean; hidden: boolean };
  /** A pipeline or migration account rather than a person. */
  robot: boolean;
};

export type AdminUsersResponse = {
  users: AdminUserRow[];
  scope: UserListScope;
  /** The account walk stopped at its bound; some accounts are missing. */
  truncated: boolean;
  generatedAt: string;
};

export type AdminUserDetail = {
  row: AdminUserRow;
  /** Since the account was created, by document. */
  lifetime: {
    votes: number;
    notes: number;
    /** Changes proposed by hand (`update_automatic == false`). */
    revisions: {
      total: number;
      approved: number;
      rejected: number;
      pending: number;
    };
    /** Rows in `audit` this account wrote: approvals, rejections,
     * publications, removals, merges, splits. */
    decisions: number;
    feedback: number;
    qaChecks: number;
    comments: number;
    images: number;
  };
  trial: {
    startedAt: string;
    days: number;
    /** Proposals and decisions since the trial began. */
    revisions: number;
    decisions: number;
  } | null;
  history: (UserActionDoc & { id: string; byName: string | null })[];
  links: {
    /** /admin/rewizje filtered to the account's proposals. */
    revisions: string;
    /** /aktywnosc filtered to the account. */
    activity: string;
    profile: string | null;
  };
};

export const parseRoleLevel = (value: unknown): RoleLevel | null =>
  isRoleLevel(value) ? value : null;
