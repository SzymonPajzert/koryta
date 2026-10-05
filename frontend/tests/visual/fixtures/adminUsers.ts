import type {
  AdminUserDetail,
  AdminUserRow,
  AdminUsersResponse,
} from "../../../shared/userAdmin";
import { NOW, daysAgo } from "../clock";

/** /api/admin/users and one account's detail for /admin/uzytkownicy's visual
 * test.
 *
 * The list is a walk of Firebase Auth joined with collections the seed does
 * not write - nominations, sign-ins, requests - so it is answered from here.
 * Somebody in every section: a request for access, a nomination waiting for
 * the script, two administrators on trial (one past its review date, which is
 * the row the test opens), the team with the signed-in owner among it, and the
 * rest, a robot last. Every person carries the name and address the row shows,
 * so no chip asks /api/users/lookup about an account that does not exist, and
 * none has a photo, so nothing is fetched from outside. */

const row = (uid: string, fields: Partial<AdminUserRow>): AdminUserRow => ({
  uid,
  displayName: null,
  email: null,
  emailVerified: true,
  disabled: false,
  providers: ["google.com"],
  photoURL: null,
  createdAt: daysAgo(200),
  lastSignInAt: daysAgo(20),
  lastRefreshAt: daysAgo(2),
  current: { level: "normal", trial: false, owner: false },
  nomination: null,
  trialStartedAt: null,
  signIns: null,
  activity: null,
  accessRequest: null,
  profile: { handle: null, public: false, hidden: false },
  robot: false,
  ...fields,
});

const signIns = (count: number, activeDays: number, lastSeen: number) => ({
  count,
  activeDays,
  firstSeenAt: daysAgo(30),
  lastSeenAt: daysAgo(lastSeen),
});

const activity = (vote: number, revision: number, noteSource = 0) => ({
  counts: { vote, revision, noteSource, publication: 0 },
  total: vote + revision + noteSource,
  lastActiveAt: daysAgo(1),
});

/** The administrator on trial for 41 days - past `TRIAL_REVIEW_DAYS`, so
 * flagged - whose row the test opens. */
const longTrial = row("wizu-proba-dluga", {
  displayName: "Katarzyna Przykładowa",
  email: "katarzyna@example.com",
  createdAt: daysAgo(160),
  current: { level: "admin", trial: true, owner: false },
  trialStartedAt: daysAgo(41),
  signIns: signIns(4, 26, 0),
  activity: activity(140, 23, 6),
  profile: { handle: "katarzyna-przykladowa", public: true, hidden: false },
});

const users: AdminUserRow[] = [
  row("wizu-prosba", {
    displayName: "Marta Przykładowa",
    email: "marta@example.com",
    createdAt: daysAgo(70),
    signIns: signIns(2, 9, 1),
    activity: activity(54, 3, 2),
    accessRequest: {
      reason:
        "Dodaję artykuły o radach nadzorczych z mojego powiatu i chcę to robić z rozszerzenia.",
      source: "pomoc",
      createdAt: daysAgo(1),
      status: "open",
    },
  }),
  row("wizu-nominacja", {
    displayName: "Piotr Przykładowy",
    email: "piotr@example.com",
    current: { level: "trusted", trial: false, owner: false },
    signIns: signIns(3, 18, 2),
    activity: activity(88, 12),
    nomination: {
      desired: {
        level: "datascience",
        trial: false,
        reason:
          "Od dwóch miesięcy poprawia dane spółek, prawie wszystko przyjęte.",
        by: "test-admin",
        byName: "Admin User",
        at: daysAgo(2),
      },
      pending: true,
      applyError: null,
    },
  }),
  longTrial,
  row("wizu-proba", {
    displayName: "Tomasz Przykładowy",
    email: "tomasz@example.com",
    current: { level: "admin", trial: true, owner: false },
    trialStartedAt: daysAgo(12),
    signIns: signIns(1, 10, 1),
    activity: activity(40, 8),
  }),
  row("test-admin", {
    displayName: "Admin User",
    email: "admin@koryta.pl",
    providers: ["password"],
    current: { level: "admin", trial: false, owner: true },
    signIns: signIns(6, 30, 0),
    activity: activity(210, 40, 12),
  }),
  row("wizu-zespol", {
    displayName: "Anna Przykładowa",
    email: "anna@example.com",
    current: { level: "datascience", trial: false, owner: false },
    signIns: signIns(2, 14, 5),
    activity: activity(12, 2, 30),
  }),
  row("wizu-uczestnik", {
    displayName: "Jan Przykładowy",
    email: "jan@example.com",
    lastRefreshAt: daysAgo(3),
    signIns: signIns(1, 3, 3),
    activity: activity(17, 1),
  }),
  row("wizu-nowe-konto", {
    email: "nowy@example.com",
    emailVerified: false,
    providers: ["password"],
    createdAt: daysAgo(3),
    lastSignInAt: daysAgo(3),
    lastRefreshAt: daysAgo(3),
  }),
  row("pipeline-wizu", {
    providers: [],
    createdAt: daysAgo(300),
    lastSignInAt: null,
    lastRefreshAt: daysAgo(0),
    current: { level: "datascience", trial: false, owner: false },
    robot: true,
  }),
];

export const adminUsers: AdminUsersResponse = {
  users,
  scope: "aktywni",
  truncated: false,
  generatedAt: NOW.toISOString(),
};

export const adminUserDetails: Record<string, AdminUserDetail> = {
  [longTrial.uid]: {
    row: longTrial,
    lifetime: {
      votes: 612,
      notes: 18,
      revisions: { total: 74, approved: 58, rejected: 9, pending: 7 },
      decisions: 31,
      feedback: 4,
      qaChecks: 22,
      comments: 0,
      images: 2,
    },
    trial: {
      startedAt: daysAgo(41),
      days: 41,
      revisions: 23,
      decisions: 31,
    },
    history: [
      {
        id: "wizu-h1",
        kind: "nominate",
        target: longTrial.uid,
        by: "test-admin",
        byName: "Admin User",
        at: daysAgo(43),
        reason: "Przegląda kolejkę zmian codziennie i dobrze ocenia źródła.",
        from: { level: "datascience", trial: false, owner: false },
        to: { level: "admin", trial: true },
      },
      {
        id: "wizu-h2",
        kind: "apply",
        target: longTrial.uid,
        by: "script:set_auth_claims@predator",
        byName: null,
        at: daysAgo(41),
        from: { level: "datascience", trial: false, owner: false },
        to: { level: "admin", trial: true },
      },
    ],
    links: {
      revisions: `/admin/rewizje?author=${longTrial.uid}&status=all&automatic=all#kolejka`,
      activity: `/aktywnosc?kto=${longTrial.uid}`,
      profile: "/uczestnik/katarzyna-przykladowa",
    },
  },
};
