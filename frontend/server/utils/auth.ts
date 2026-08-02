import { getAuth } from "firebase-admin/auth";
import type { H3Event } from "h3";

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
