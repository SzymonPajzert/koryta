import { getAuth } from "firebase-admin/auth";
import type { H3Event } from "h3";

export async function getUser(event: H3Event) {
  const authHeader = getRequestHeader(event, "Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized: Missing or invalid token",
    });
  }

  const token = authHeader.substring(7);
  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized: Invalid token",
    });
  }
}
