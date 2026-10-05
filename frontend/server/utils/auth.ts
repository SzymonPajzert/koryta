import { getAuth } from "firebase-admin/auth";
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";
import type { H3Event } from "h3";
import { roleFromClaims } from "~~/shared/roles";

/** The same user, once they are in the datascience group.
 *
 * Being logged in is not enough to reach an ingest endpoint. They write nodes,
 * edges and revisions on the scrapers' behalf, and they take the caller's word
 * for how far to trust a payload: `autoapprove` publishes what the request
 * creates, and `party_from_committee` writes a change through to a candidacy
 * the request did not create. The capture path additionally writes to the
 * shared crawled bucket and spends LLM calls. Every other write path in the app
 * proposes a revision and waits for a reviewer.
 *
 * Split from `getUser` rather than folded into it so it stays a pure check on a
 * decoded token, which is what lets a test exercise the ingest with a mocked
 * `getUser` and still run this for real.
 */
export function requireDatascience(user: DecodedIdToken): DecodedIdToken {
  if (user.datascience !== true) {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden",
      message: "You need to be a member of the datascience group",
    });
  }
  return user;
}

/** Like `getUser`, but for routes that serve signed-in and signed-out callers
 * alike: a missing or unusable token yields null instead of a 401. */
export async function getOptionalUser(event: H3Event) {
  const authHeader = getRequestHeader(event, "Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    return await getAuth().verifyIdToken(authHeader.substring(7));
  } catch {
    return null;
  }
}

export async function getUser(event: H3Event) {
  const authHeader = getRequestHeader(event, "Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw createError({
      statusCode: 401,
      message: "Błąd uwierzytelniania: brak tokenu. Proszę się zalogować.",
    });
  }

  const token = authHeader.substring(7);
  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken;
  } catch {
    throw createError({
      statusCode: 401,
      message:
        "Błąd uwierzytelniania: nieważny token. Proszę zalogować się ponownie.",
    });
  }
}

/** The signed in user, refused unless they are the site's owner.
 *
 * Narrower than `requireAdmin`: the owner's task list (/admin/zadania) names
 * rules holes, prod credentials to set up and research about people, and the
 * other administrators, trial ones included, have no business reading it. The
 * claim is set by data/pipelines/src/set_auth_claims.py.
 */
export async function requireOwner(event: H3Event) {
  const user = await getUser(event);
  if (user.owner !== true) {
    throw createError({
      statusCode: 403,
      message: "Ta strona jest dostępna tylko dla właściciela serwisu.",
    });
  }
  return user;
}

/** The signed in user, refused unless they carry the `admin` claim.
 *
 * Deciding what the public sees - approving a revision, publishing a page - is
 * the one thing that is not open to everyone, so the check lives here rather
 * than being spelled out again at each endpoint that needs it.
 */
export async function requireAdmin(event: H3Event) {
  const user = await getUser(event);
  if (user.admin !== true) {
    throw createError({
      statusCode: 403,
      message: "Ta operacja jest dostępna tylko dla administratorów.",
    });
  }
  return user;
}

/** The signed in user, refused unless they are an established administrator
 * right now: `admin` without `newAdmin`, read from the account rather than the
 * token, on an account that is enabled and whose sessions were not revoked
 * after this one began.
 *
 * For the pages that watch the other administrators and decide who holds what
 * - /admin/uzytkownicy lists every account's address and activity, takes
 * nominations and moderates profiles. An administrator on trial is the person
 * those pages exist to keep an eye on, so they are refused, the way /aktywnosc
 * gives them the contributor view. The token is checked first only to turn
 * everybody else away without a call to the auth service; the decision is the
 * live read, so a trial or a demotion made a minute ago already applies, as it
 * does for `isEstablishedAdmin` (server/utils/contributors.ts).
 *
 * The same read also answers what `verifyIdToken(token, true)` would (see
 * `sessionEnded`), which the rest of the site does not ask: everywhere else a
 * disabled account or a revoked session keeps working until its ID token
 * expires, up to an hour. Here that hour would be enough to download every
 * address and to reset names and avatars across accounts, none of which waits
 * for the owner's y/N the way a nomination does. Asking `verifyIdToken` to
 * check would fetch the same account a second time, so one record serves
 * both. A session that is over is a 401, like a token that does not verify at
 * all: signing in again is the way back, where there is one.
 */
export async function requireEstablishedAdmin(event: H3Event) {
  const user = await getUser(event);
  const refuse = () =>
    createError({
      statusCode: 403,
      message:
        "Ta strona jest dostępna tylko dla administratorów po okresie próbnym.",
    });
  if (user.admin !== true) throw refuse();

  // An account that no longer exists is nobody's administrator.
  const account = await accountOf(user.uid);
  if (!account) throw refuse();

  if (sessionEnded(user, account)) {
    throw createError({
      statusCode: 401,
      message:
        "Błąd uwierzytelniania: sesja wygasła. Proszę zalogować się ponownie.",
    });
  }

  const role = roleFromClaims(account.customClaims);
  if (role.level !== "admin" || role.trial) throw refuse();
  return user;
}

/** The account behind `uid`, or null when there is none. Anything else the
 * auth service fails with is passed on: an outage is a 500, not a verdict on
 * the caller. */
async function accountOf(uid: string): Promise<UserRecord | null> {
  try {
    return await getAuth().getUser(uid);
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") {
      return null;
    }
    throw error;
  }
}

/** Whether the session `token` belongs to is over by the account's own say:
 * the account is disabled, or its sessions were revoked after this one signed
 * in. It is the check `verifyIdToken(token, true)` makes in firebase-admin
 * (`verifyDecodedJWTNotRevokedOrDisabled`), with the same comparison: both
 * times are whole seconds, and a sign-in in the very second of the revocation
 * counts as after it.
 *
 * Stricter in one way. Firebase lets a token with no readable `auth_time`
 * through, because a comparison with NaN is false. Every real ID token
 * carries one, and a token that cannot be shown to postdate the revocation is
 * not one this gate takes. */
function sessionEnded(token: DecodedIdToken, account: UserRecord): boolean {
  if (account.disabled) return true;
  if (!account.tokensValidAfterTime) return false;
  const validSince = Date.parse(account.tokensValidAfterTime);
  const signedIn = Number(token.auth_time) * 1000;
  return (
    !Number.isFinite(validSince) ||
    !Number.isFinite(signedIn) ||
    signedIn < validSince
  );
}
