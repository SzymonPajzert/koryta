import { reactive, ref } from "vue";
import { authRequest } from "~/composables/auth";
import { describeRole, roleLevels, type RoleLevel } from "~~/shared/roles";
import {
  TRIAL_REVIEW_DAYS,
  type AdminUserDetail,
  type AdminUserRow,
  type AdminUsersResponse,
  type DismissRequestBody,
  type ModerateBody,
  type ModerationAction,
  type NominateBody,
  type UserListScope,
  type WithdrawBody,
} from "~~/shared/userAdmin";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Where a row goes

/** The sections of /admin/uzytkownicy, top to bottom: what is waiting on an
 * administrator first, then what is waiting on the script, then the trials
 * somebody has to decide, and only then the accounts that are simply there. */
export const userSectionKeys = [
  "requests",
  "pending",
  "trials",
  "team",
  "others",
] as const;

export type UserSectionKey = (typeof userSectionKeys)[number];

/** The one section an account is listed in - the first that wants it.
 *
 * One, not every one that applies: an administrator on trial who has already
 * been nominated to the end of it is something the script has to do, not
 * something to decide again, so a decision moves the row on. A robot is never
 * anybody's decision - the server refuses to nominate one - so it goes to the
 * bottom whatever its claims say, greyed out. */
export function userSectionOf(row: AdminUserRow): UserSectionKey {
  if (row.robot) return "others";
  if (row.accessRequest?.status === "open") return "requests";
  if (row.nomination?.pending) return "pending";
  if (row.current.level === "admin" && row.current.trial) return "trials";
  if (row.current.level !== "normal") return "team";
  return "others";
}

/** Whole days from `iso` to `now`, or null for a date nobody recorded. */
export function daysSince(
  iso: string | null | undefined,
  now: Date,
): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

/** How long an administrator has been on trial, or null when they are not on
 * one or nobody recorded when it began. A trial the script cannot date - one
 * granted by hand before `trialStartedAt` existed and missed by the seed - is
 * shown without a number rather than as "0 dni", which would read as new. */
export function trialDays(row: AdminUserRow, now: Date): number | null {
  if (row.current.level !== "admin" || !row.current.trial) return null;
  return daysSince(row.trialStartedAt, now);
}

/** A trial old enough that somebody should end it one way or the other. */
export function trialDue(row: AdminUserRow, now: Date): boolean {
  const days = trialDays(row, now);
  return days !== null && days >= TRIAL_REVIEW_DAYS;
}

/** When the account last had the site open, as near as anything says.
 *
 * Two clocks, and either can be missing or behind. Auth's `lastRefreshTime`
 * moves whenever a browser refreshes a token, which an open tab does every
 * hour, but it only exists for accounts Auth has seen refresh. `userStats`
 * counts from the day sign-ins started being recorded, at most once a day per
 * browser. The later of the two is the best answer to "is this person still
 * around". */
export function lastSeenAt(row: AdminUserRow): string | null {
  let latest: string | null = null;
  for (const at of [row.lastRefreshAt, row.signIns?.lastSeenAt]) {
    if (!at || Number.isNaN(Date.parse(at))) continue;
    if (!latest || Date.parse(at) > Date.parse(latest)) latest = at;
  }
  return latest;
}

/** The name a row is sorted and searched by: what the account calls itself,
 * or the address, or failing both the uid - as `UserChip` labels it. */
export const userLabel = (row: AdminUserRow) =>
  row.displayName || row.email || row.uid;

const byLabel = (a: AdminUserRow, b: AdminUserRow) =>
  userLabel(a).localeCompare(userLabel(b), "pl");

/** Compares two dates with the missing ones last, whichever way it sorts:
 * a request or a trial nobody can date is not the oldest one, and an account
 * nobody has seen is not the most recent. */
function compareTimes(
  a: string | null | undefined,
  b: string | null | undefined,
  order: "oldest" | "newest",
): number {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
  }
  return order === "oldest" ? x - y : y - x;
}

const levelRank = (row: AdminUserRow) => roleLevels.indexOf(row.current.level);

/** The order inside one section.
 *
 * The three that are queues - requests, nominations waiting for the script,
 * trials - go oldest first, as any queue does: what has waited longest is what
 * somebody should look at next, and a trial past `TRIAL_REVIEW_DAYS` days
 * comes before one that is not. The team goes by rank, administrators first,
 * and the rest by who was here last, so the people still around are at the top
 * of a list that, with "Pokaż wszystkie konta", runs into the thousands. */
export function sortUserSection(
  key: UserSectionKey,
  rows: AdminUserRow[],
): AdminUserRow[] {
  const sorted = [...rows];
  switch (key) {
    case "requests":
      return sorted.sort(
        (a, b) =>
          compareTimes(
            a.accessRequest?.createdAt,
            b.accessRequest?.createdAt,
            "oldest",
          ) || byLabel(a, b),
      );
    case "pending":
      return sorted.sort(
        (a, b) =>
          compareTimes(
            a.nomination?.desired.at,
            b.nomination?.desired.at,
            "oldest",
          ) || byLabel(a, b),
      );
    case "trials":
      return sorted.sort(
        (a, b) =>
          compareTimes(a.trialStartedAt, b.trialStartedAt, "oldest") ||
          byLabel(a, b),
      );
    case "team":
      return sorted.sort(
        (a, b) =>
          levelRank(b) - levelRank(a) ||
          Number(b.current.owner) - Number(a.current.owner) ||
          compareTimes(lastSeenAt(a), lastSeenAt(b), "newest") ||
          byLabel(a, b),
      );
    case "others":
      return sorted.sort(
        (a, b) =>
          Number(a.robot) - Number(b.robot) ||
          compareTimes(lastSeenAt(a), lastSeenAt(b), "newest") ||
          compareTimes(a.createdAt, b.createdAt, "newest") ||
          byLabel(a, b),
      );
  }
}

/** Every row in its section, each section in its own order. Empty sections are
 * kept, so the page decides what an empty one shows. */
export function userSections(
  rows: AdminUserRow[],
): Record<UserSectionKey, AdminUserRow[]> {
  const sections = Object.fromEntries(
    userSectionKeys.map((key) => [key, [] as AdminUserRow[]]),
  ) as Record<UserSectionKey, AdminUserRow[]>;
  for (const row of rows) sections[userSectionOf(row)].push(row);
  for (const key of userSectionKeys) {
    sections[key] = sortUserSection(key, sections[key]);
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Filters

/** Lowercase, without Polish diacritics, so „łukasz” finds „Łukasz” and
 * „lukasz” finds both: an address is usually typed without them, and a name
 * typed into a search field often is too. `ł` has no decomposition, hence the
 * extra replace. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l");
}

/** Whether a row matches what was typed in the search field: a part of the
 * name, the address or the uid. All on the client - the list is already here,
 * and a uid pasted from a log should find its row without a round trip. */
export function matchesUserSearch(row: AdminUserRow, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return [row.displayName, row.email, row.uid].some(
    (value) => !!value && fold(value).includes(needle),
  );
}

/** How a level is written in the address bar - `?poziom=zespol` - in Polish
 * like every other query value on the site, rather than the claim names the
 * code uses. */
export const levelSlugs: Record<RoleLevel, string> = {
  normal: "uczestnik",
  trusted: "zaufany",
  datascience: "zespol",
  admin: "administrator",
};

export const levelFromSlug = (slug: string | null | undefined) =>
  roleLevels.find((level) => levelSlugs[level] === slug) ?? null;

// ---------------------------------------------------------------------------
// Detail

/** Accepted out of decided, as a whole percentage, or null while nothing has
 * been decided - a proposal still waiting says nothing about whether this
 * person's proposals are good. */
export function acceptanceRate(revisions: {
  approved: number;
  rejected: number;
}): number | null {
  const decided = revisions.approved + revisions.rejected;
  return decided ? Math.round((revisions.approved / decided) * 100) : null;
}

/** A role before and after, as a history line prints it. */
export function describeRoleChange(
  from: Parameters<typeof describeRole>[0] | null | undefined,
  to: Parameters<typeof describeRole>[0] | null | undefined,
): string | null {
  if (!from && !to) return null;
  if (!from) return describeRole(to!);
  if (!to) return describeRole(from);
  return `${describeRole(from)} → ${describeRole(to)}`;
}

/** Who did something to an account, wherever the page prints it - the history
 * and the nomination on the open row alike.
 *
 * A person by name. The claims script and the one-time seed by what they are:
 * their "uid" is a label (`script:set_auth_claims@<host>`,
 * `migration:set_auth_claims`) that the server has no name for, and printed as
 * it is it reads like a fault rather than like "the script did this". The seed
 * is the case that matters most - `set_auth_claims --seed` writes a nomination
 * for every account that already holds a role, so without this every
 * administrator's open row would be signed `migration:set_auth_claims`. A uid
 * nobody can name any more, an account since deleted, is left as it is: it is
 * still the one thing that says who it was. */
export function actorLabel(actor: {
  by: string;
  byName?: string | null;
}): string {
  if (actor.byName) return actor.byName;
  if (actor.by.startsWith("script:")) return "skrypt uprawnień";
  if (actor.by.startsWith("migration:")) return "migracja";
  return actor.by;
}

// ---------------------------------------------------------------------------
// Requests

export type UserAction =
  | { kind: "nominate"; body: NominateBody }
  | { kind: "withdraw"; body: WithdrawBody }
  | { kind: "dismiss"; body: DismissRequestBody }
  | { kind: "moderate"; body: ModerateBody };

const ACTION_ROUTES: Record<UserAction["kind"], string> = {
  nominate: "/api/admin/users/nominate",
  withdraw: "/api/admin/users/withdraw",
  dismiss: "/api/admin/users/dismiss-request",
  moderate: "/api/admin/users/moderate",
};

const MODERATION_DONE: Record<ModerationAction, string> = {
  removeAvatar: "Zdjęcie profilowe usunięte.",
  resetName: "Nazwa użytkownika usunięta.",
  hideProfile: "Profil ukryty.",
  unhideProfile: "Profil przywrócony.",
};

/** What the snackbar says once a request went through. A nomination says
 * when it will take effect, because nothing on the page changes role when it
 * is saved - only the "czeka na skrypt" chip appears. */
function doneText(action: UserAction): string {
  switch (action.kind) {
    case "nominate":
      return "Nominacja zapisana. Zacznie działać, gdy właściciel uruchomi skrypt.";
    case "withdraw":
      return "Nominacja wycofana.";
    case "dismiss":
      return "Prośba o dostęp odrzucona.";
    case "moderate":
      return MODERATION_DONE[action.body.action];
  }
}

/** What the server said went wrong, in its own words where it gave some - the
 * routes refuse in Polish ("Nie możesz nominować samego siebie."), and that
 * sentence is more use to the reader than a status code. */
function failureText(error: unknown): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  if (data?.message) return data.message;
  return error instanceof Error ? error.message : String(error);
}

/** The row an action answered with, if it answered with one. Every write
 * route returns the account's updated row, read live - moderation too, which
 * matters most there: the list comes out of a five-minute memo of Auth, and
 * asking for it again would bring back the name or picture just taken down.
 * A partial row merged in would be a row that lies about the fields it left
 * out, so anything short of a whole row still means "ask again". */
export function rowFromResponse(response: unknown): AdminUserRow | null {
  const looksLikeRow = (value: unknown): value is AdminUserRow => {
    const row = value as Partial<AdminUserRow> | null | undefined;
    return (
      !!row &&
      typeof row.uid === "string" &&
      !!row.current &&
      typeof row.current === "object" &&
      !!row.profile &&
      "nomination" in row
    );
  };
  if (looksLikeRow(response)) return response;
  const nested = (response as { row?: unknown } | null | undefined)?.row;
  return looksLikeRow(nested) ? nested : null;
}

/** One account's open row: what `GET /api/admin/users/<uid>` answered, while
 * it is being asked, and why it failed. */
export type UserDetailState = {
  data: AdminUserDetail | null;
  loading: boolean;
  error: string;
};

/** The users page's data: the list, each opened account's detail, and the
 * writes - nominate, withdraw, dismiss a request, moderate.
 *
 * A refresh that fails keeps the list it had, as `useOpsJobs` does: the page is
 * one an administrator works through, and a list that blanked at the first
 * dropped request would lose their place in it. The detail of an account is
 * fetched the first time its row is opened and kept for as long as the page
 * is, because closing and reopening a row should not cost six `count()`
 * queries again; a write to the account fetches it afresh, since its history
 * is what the write changed. */
export function useAdminUsers() {
  const data = ref<AdminUsersResponse | null>(null);
  const loading = ref(false);
  const error = ref("");
  const details = reactive<Record<string, UserDetailState>>({});
  /** Accounts with a write in flight, so their buttons wait for it. */
  const busy = reactive(new Set<string>());

  const snackbar = ref(false);
  const snackbarText = ref("");
  const snackbarColor = ref<"success" | "error">("success");

  const notify = (text: string, color: "success" | "error") => {
    snackbarText.value = text;
    snackbarColor.value = color;
    snackbar.value = true;
  };

  let scope: UserListScope = "aktywni";
  /** Joins a load of the same scope that is still out, so the switch and the
   * deep link landing together send one request. */
  let inFlight: { scope: UserListScope; promise: Promise<void> } | null = null;
  /** Counts loads, so an answer for a scope the page has since left - the
   * switch flipped twice while the slow `wszyscy` walk was out - is dropped
   * rather than drawn over the newer one. */
  let generation = 0;

  function load(
    next: UserListScope = scope,
    options: { fresh?: boolean } = {},
  ): Promise<void> {
    if (!options.fresh && inFlight && inFlight.scope === next) {
      return inFlight.promise;
    }
    scope = next;
    const mine = ++generation;
    loading.value = true;
    const promise = (async () => {
      try {
        const response = await authRequest<AdminUsersResponse>(
          "/api/admin/users",
          { method: "GET", query: { zakres: next } },
        );
        if (mine !== generation) return;
        data.value = response;
        error.value = "";
      } catch (failure) {
        if (mine !== generation) return;
        error.value = data.value
          ? `Nie udało się odświeżyć listy kont: ${failureText(failure)}`
          : `Nie udało się wczytać listy kont: ${failureText(failure)}`;
      } finally {
        if (mine === generation) {
          loading.value = false;
          inFlight = null;
        }
      }
    })();
    inFlight = { scope: next, promise };
    return promise;
  }

  /** Puts a fresher copy of a row in the list, where the list has it. */
  function replaceRow(row: AdminUserRow) {
    const users = data.value?.users;
    if (!users) return;
    const index = users.findIndex((user) => user.uid === row.uid);
    if (index >= 0) users.splice(index, 1, row);
  }

  const detailRequests = new Map<string, number>();

  async function loadDetail(uid: string, options: { force?: boolean } = {}) {
    const known = details[uid];
    if (known && !options.force && (known.loading || known.data)) return;
    if (!known) details[uid] = { data: null, loading: false, error: "" };
    // Read back through the reactive record: the object assigned above is the
    // raw one, and writes to it would not redraw anything.
    const state = details[uid]!;
    const mine = (detailRequests.get(uid) ?? 0) + 1;
    detailRequests.set(uid, mine);
    state.loading = true;
    try {
      const detail = await authRequest<AdminUserDetail>(
        `/api/admin/users/${encodeURIComponent(uid)}`,
        { method: "GET" },
      );
      if (detailRequests.get(uid) !== mine) return;
      state.data = detail;
      state.error = "";
      // Read fresh, so it is the newest copy of the row there is.
      replaceRow(detail.row);
    } catch (failure) {
      if (detailRequests.get(uid) !== mine) return;
      state.error = `Nie udało się wczytać szczegółów konta: ${failureText(failure)}`;
    } finally {
      if (detailRequests.get(uid) === mine) state.loading = false;
    }
  }

  /** Sends one write and says whether it went through, so the form or dialog
   * that asked can clear itself on success and keep what was typed on a
   * failure. The failure itself goes to the snackbar in the server's words. */
  async function act(action: UserAction): Promise<boolean> {
    const uid = action.body.uid;
    busy.add(uid);
    try {
      const response = await authRequest<unknown>(ACTION_ROUTES[action.kind], {
        method: "POST",
        body: action.body,
      });
      const row = rowFromResponse(response);
      if (row) replaceRow(row);
      else await load(scope, { fresh: true });
      if (details[uid]) void loadDetail(uid, { force: true });
      notify(doneText(action), "success");
      return true;
    } catch (failure) {
      notify(failureText(failure), "error");
      return false;
    } finally {
      busy.delete(uid);
    }
  }

  // One route each, named for the callers that know which write they make.
  const nominate = (body: NominateBody) => act({ kind: "nominate", body });
  const withdraw = (body: WithdrawBody) => act({ kind: "withdraw", body });
  const dismissRequest = (body: DismissRequestBody) =>
    act({ kind: "dismiss", body });
  const moderate = (body: ModerateBody) => act({ kind: "moderate", body });

  return {
    data,
    loading,
    error,
    details,
    busy,
    load,
    loadDetail,
    act,
    nominate,
    withdraw,
    dismissRequest,
    moderate,
    snackbar,
    snackbarText,
    snackbarColor,
  };
}

export type AdminUsers = ReturnType<typeof useAdminUsers>;
