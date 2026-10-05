import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import { removeUserAvatar } from "~~/server/utils/avatars";

/** Takes the caller's own profile picture down, back to the one of the
 * account they sign in with, or to none.
 *
 * Open to every signed-in account, confirmed address or not: taking a picture
 * down is never the risk that putting one up is. Answers with where the
 * picture now points, for the page to show until its cached account catches
 * up. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const { photoURL } = await removeUserAvatar(
    getFirestore("koryta-pl"),
    user.uid,
  );
  return { photoURL };
});
