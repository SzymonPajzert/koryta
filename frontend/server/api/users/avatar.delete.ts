import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import { providerPhotoURL, setUserPhotoURL } from "~~/server/utils/avatars";
import { deleteImages, imagesOf } from "~~/server/utils/images";

/** Takes the caller's own profile picture down, back to the one of the
 * account they sign in with, or to none.
 *
 * Nothing points at the picture any more before it is deleted, for the same
 * reason as in `avatar.post.ts`. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const db = getFirestore("koryta-pl");
  const previous = await imagesOf(db, `users/${user.uid}`, "avatar");

  const photoURL = await providerPhotoURL(user.uid);
  await setUserPhotoURL(db, user.uid, photoURL);
  await deleteImages(db, previous);

  return { photoURL };
});
