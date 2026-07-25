import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser } from "~~/server/utils/auth";

const queryValidator = z.object({
  // Comma separated list of user ids.
  uids: z.string().min(1),
});

export type LookedUpUser = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

/** Resolve user ids to their display data. Admin only, since it exposes
 * emails of arbitrary users. */
export default defineEventHandler(async (event) => {
  const caller = await getUser(event);
  if (!caller.admin) {
    throw createError({
      statusCode: 403,
      message: "Tylko administratorzy mogą wyszukiwać użytkowników.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const uids = [...new Set(query.uids.split(",").filter(Boolean))];
  if (uids.length > 100) {
    throw createError({ statusCode: 400, message: "Zbyt wiele id naraz." });
  }

  const result = await getAuth().getUsers(uids.map((uid) => ({ uid })));

  const users: Record<string, LookedUpUser> = {};
  for (const user of result.users) {
    users[user.uid] = {
      displayName: user.displayName ?? null,
      email: user.email ?? null,
      photoURL: user.photoURL ?? null,
    };
  }

  return { users };
});
