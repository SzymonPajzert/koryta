import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import {
  ACCESS_REQUEST_COOLDOWN_DAYS,
  type AccessRequestDoc,
  type OwnAccessRequest,
} from "~~/shared/userAdmin";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the caller already holds the team's tools - the `datascience`
 * claim, which is what the extension, the extractions and the ingest check
 * (`requireDatascience`).
 *
 * The token is asked first, and the account only when the token says no. A
 * token keeps the claims it was issued with for up to an hour, so somebody the
 * script promoted a minute ago still carries the old one; asked of the token
 * alone, this would hand them the form again and put a request for tools they
 * already have in front of the administrators. A token that does carry the
 * claim is taken at its word: the account may have lost it since, but then
 * every tool still opens to that token for the same hour, and the request can
 * wait until it no longer does.
 *
 * An account that is gone is a 404 rather than "no access": a request filed
 * for it would sit in a queue no administrator can act on.
 */
export async function holdsTeamTools(user: DecodedIdToken): Promise<boolean> {
  if (user.datascience === true) return true;
  try {
    const account = await getAuth().getUser(user.uid);
    return account.customClaims?.datascience === true;
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") {
      throw createError({
        statusCode: 404,
        message: "Nie znaleźliśmy Twojego konta. Zaloguj się ponownie.",
      });
    }
    throw error;
  }
}

/** When a handled request may be renewed, or null for one still open.
 *
 * Counted from the answer, not from the request: somebody turned down the day
 * after they asked waits the same week as somebody turned down a month later,
 * which is the point of a cooldown - a "no" is not an invitation to ask again
 * tomorrow. A handled request with no `handledAt` (written by hand, or by an
 * older version of the page) falls back to when it was made.
 */
export function renewableAt(request: AccessRequestDoc): Date | null {
  if (request.status === "open") return null;
  const answered = Date.parse(request.handledAt ?? request.createdAt);
  if (Number.isNaN(answered)) return null;
  return new Date(answered + ACCESS_REQUEST_COOLDOWN_DAYS * DAY_MS);
}

/** The caller's own request as the page shows it.
 *
 * Only the status, the date and the page it came from go back. The reason is
 * theirs and they wrote it; who handled it and the administrator's note are
 * the administrators' - the note is written for the next administrator to
 * read, not as a reply, and naming who turned somebody down invites the
 * argument to move to that person. The page says "nie przyznaliśmy", in the
 * site's voice, the way a rejected proposal's mail comes from `redakcja`.
 */
export function describeOwnRequest(
  request: AccessRequestDoc | undefined,
  options: { hasAccess: boolean; robot?: boolean; now?: Date },
): OwnAccessRequest {
  const now = options.now ?? new Date();
  const renewable = request ? renewableAt(request) : null;
  const retryAfter =
    renewable && renewable > now ? renewable.toISOString() : null;
  return {
    request: request
      ? {
          status: request.status,
          createdAt: request.createdAt,
          source: request.source,
        }
      : null,
    canRequest:
      !options.hasAccess &&
      !options.robot &&
      request?.status !== "open" &&
      retryAfter === null,
    retryAfter,
    hasAccess: options.hasAccess,
  };
}
