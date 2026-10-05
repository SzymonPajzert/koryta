import type {
  AdminUserDetail,
  AdminUserRow,
  AdminUsersResponse,
} from "../../../../shared/userAdmin";

/** The users page's tests build their accounts from here: a plain account
 * with nothing to its name, which each test turns into the case it is about.
 * Dates are fixed rather than relative, and the tests that age them freeze
 * the clock at `NOW`. */
export const NOW = new Date("2026-10-05T10:00:00.000Z");

export const daysBefore = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

export const userRow = (
  uid: string,
  overrides: Partial<AdminUserRow> = {},
): AdminUserRow => ({
  uid,
  displayName: `Osoba ${uid}`,
  email: `${uid}@example.com`,
  emailVerified: true,
  disabled: false,
  providers: ["google.com"],
  photoURL: null,
  createdAt: daysBefore(100),
  lastSignInAt: daysBefore(10),
  lastRefreshAt: daysBefore(2),
  current: { level: "normal", trial: false, owner: false },
  nomination: null,
  trialStartedAt: null,
  signIns: null,
  activity: null,
  accessRequest: null,
  profile: { handle: null, public: false, hidden: false },
  robot: false,
  ...overrides,
});

export const usersResponse = (
  users: AdminUserRow[],
  overrides: Partial<AdminUsersResponse> = {},
): AdminUsersResponse => ({
  users,
  scope: "aktywni",
  truncated: false,
  generatedAt: NOW.toISOString(),
  ...overrides,
});

export const userDetail = (
  row: AdminUserRow,
  overrides: Partial<AdminUserDetail> = {},
): AdminUserDetail => ({
  row,
  lifetime: {
    votes: 120,
    notes: 7,
    revisions: { total: 20, approved: 12, rejected: 4, pending: 4 },
    decisions: 0,
    feedback: 2,
    qaChecks: 5,
    comments: 0,
    images: 1,
  },
  trial: null,
  history: [],
  links: {
    revisions: `/admin/rewizje?author=${row.uid}&status=all&automatic=all#kolejka`,
    activity: `/aktywnosc?kto=${row.uid}`,
    profile: null,
  },
  ...overrides,
});
