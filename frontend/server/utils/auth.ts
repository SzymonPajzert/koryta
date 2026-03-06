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
  if (token === "test-token" && process.env.USE_EMULATORS) {
    return {
      uid: "test-user-uid",
      email: "test@example.com",
      name: "Test User",
    };
  }
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
