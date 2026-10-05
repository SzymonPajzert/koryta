/** What a signed-in account may do, as one ladder the site and the claims
 * script both read.
 *
 * Roles live in Firebase Auth custom claims, and the only thing that writes
 * them is `data/pipelines/src/set_auth_claims.py`, run by hand by the site's
 * owner. Administrators no longer edit that script to say who should hold
 * what: they nominate on /admin/uzytkownicy, which stores the wish in
 * `roleNominations/{uid}`, and the script reads it from there and asks the
 * owner y/N per account before it writes a claim. So this file describes the
 * same mapping the script applies, and `roleClaims.json` spells the ladder out
 * as data that both this file's tests and the Python tests check against, so
 * the two cannot drift. It is a fixture, not an import: the Cloud Functions
 * build compiles all of `shared/` without JSON modules.
 *
 * The levels are cumulative - each one holds every claim of the one below - and
 * two modifiers sit on top of `admin` only:
 * - `trial` adds `newAdmin`, the administrator on trial whom the established
 *   administrators can watch on /aktywnosc;
 * - `owner` adds `owner`, which opens /admin/zadania. It is never nominated: it
 *   is one constant in the script, so no write to Firestore can make anybody
 *   the owner.
 */
export const roleLevels = [
  "normal",
  "trusted",
  "datascience",
  "admin",
] as const;

export type RoleLevel = (typeof roleLevels)[number];

export const isRoleLevel = (value: unknown): value is RoleLevel =>
  (roleLevels as readonly unknown[]).includes(value);

/** The part of an account's role a nomination can ask for. `trial` means
 * nothing below `admin` and is normalised away there. */
export type RoleState = { level: RoleLevel; trial: boolean };

/** What the claims of one account say, owner included. */
export type CurrentRole = RoleState & { owner: boolean };

/** The claims a level holds on its own, before `newAdmin` and `owner`. Kept
 * equal to `roleClaims.json` by tests/shared/roles.test.ts. */
export const levelClaims: Record<
  RoleLevel,
  Partial<Record<"trusted" | "datascience" | "admin", true>>
> = {
  normal: {},
  trusted: { trusted: true },
  datascience: { trusted: true, datascience: true },
  admin: { trusted: true, datascience: true, admin: true },
};

export function normalizeRoleState(state: RoleState): RoleState {
  return { level: state.level, trial: state.level === "admin" && state.trial };
}

/** The whole claims object an account should hold in `state`.
 *
 * Whole, because `setCustomUserClaims` replaces every claim at once: a run that
 * computed the level alone would strip `newAdmin` and `owner` each time. */
export function claimsFor(
  state: RoleState,
  options: { owner?: boolean } = {},
): Record<string, true> {
  const normal = normalizeRoleState(state);
  const claims: Record<string, true> = { ...levelClaims[normal.level] };
  if (normal.level === "admin") {
    if (normal.trial) claims.newAdmin = true;
    if (options.owner) claims.owner = true;
  }
  return claims;
}

/** Reads a role back off an account's custom claims.
 *
 * The highest level whose own claim is present wins, so an account someone
 * edited by hand into `{admin: true}` without the claims below it still reads
 * as an administrator - which is what every `admin` check on the site treats
 * it as. `newAdmin` and `owner` count only together with `admin`, as in
 * `isNewAdmin` (server/utils/contributors.ts). */
export function roleFromClaims(
  claims: Record<string, unknown> | null | undefined,
): CurrentRole {
  const admin = claims?.admin === true;
  const level: RoleLevel = admin
    ? "admin"
    : claims?.datascience === true
      ? "datascience"
      : claims?.trusted === true
        ? "trusted"
        : "normal";
  return {
    level,
    trial: admin && claims.newAdmin === true,
    owner: admin && claims.owner === true,
  };
}

export function sameRoleState(a: RoleState, b: RoleState): boolean {
  const x = normalizeRoleState(a);
  const y = normalizeRoleState(b);
  return x.level === y.level && x.trial === y.trial;
}

/** Claims that only ever narrow what their holder may do. Losing one takes
 * nothing away, so it is not a loss in `roleLosesClaims`. */
const RESTRICTING_CLAIMS: ReadonlySet<string> = new Set(["newAdmin"]);

/** Whether going from `from` to `to` takes a privilege away - the case in
 * which the script also revokes the account's refresh tokens, so that a
 * session that is still open stops carrying what the account no longer holds.
 *
 * Every claim counts except `newAdmin`, which only restricts: it keeps an
 * administrator off the pages that watch the others. Ending a trial removes it
 * and nothing else, and that is a promotion. Revoking there would sign the
 * graduate out of every open tab - the forced refresh in
 * `refreshIfClaimsChanged` (app/composables/auth.ts) is refused for a revoked
 * account, and Firebase ends the session - seconds after the mail told them
 * the page would update by itself.
 *
 * Gaining `newAdmin` is not a loss either, though it does close the users
 * page: the routes behind it ask the account rather than the token
 * (`requireEstablishedAdmin`), so a trial applies there at once, and the menus
 * follow when the open tab refreshes its token on `claimsChangedAt`.
 *
 * `lost_claims` in data/pipelines/src/set_auth_claims.py is the same rule over
 * the raw claims. */
export function roleLosesClaims(from: CurrentRole, to: CurrentRole): boolean {
  const before = claimsFor(from, { owner: from.owner });
  const after = claimsFor(to, { owner: to.owner });
  return Object.keys(before).some(
    (claim) => !RESTRICTING_CLAIMS.has(claim) && !(claim in after),
  );
}

/** How each level reads in the UI.
 *
 * `trusted` has a name and nothing behind it: the script has granted the claim
 * since it was written, but no page, route or rule reads it yet. It is offered
 * all the same, because the levels are the script's, and the hint says so. */
export const roleLevelLabels: Record<
  RoleLevel,
  { title: string; hint: string }
> = {
  normal: {
    title: "Uczestnik",
    hint: "Konto bez dodatkowych uprawnień: ocenia, notuje, proponuje zmiany.",
  },
  trusted: {
    title: "Zaufany uczestnik",
    hint: "Na razie nic więcej nie odblokowuje - ten poziom czeka na decyzję, co ma dawać.",
  },
  datascience: {
    title: "Zespół",
    hint:
      "Rozszerzenie, ekstrakcje i import danych. Import może publikować " +
      "bez przeglądu, więc to uprawnienie dla osób, którym ufamy jak redakcji.",
  },
  admin: {
    title: "Administrator",
    hint:
      "Przegląda i zatwierdza zmiany, publikuje strony, widzi zgłoszenia. " +
      "Obejmuje uprawnienia zespołu.",
  },
};

export const trialLabel = {
  title: "Okres próbny",
  chip: "okres próbny",
  hint:
    "Administrator na okresie próbnym widzi to, co inni uczestnicy, na stronie " +
    "Aktywność, a jego decyzje są tam widoczne dla administratorów pod " +
    "„Nowi administratorzy”.",
};

export const ownerLabel = "Właściciel serwisu";

/** One line for a role, as a chip or a history entry would print it. */
export function describeRole(role: RoleState & { owner?: boolean }): string {
  if (role.owner) return ownerLabel;
  const title = roleLevelLabels[role.level].title;
  return role.level === "admin" && role.trial
    ? `${title} (${trialLabel.chip})`
    : title;
}
