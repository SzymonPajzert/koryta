import { getAuth } from "firebase-admin/auth";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { H3Event } from "h3";

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
