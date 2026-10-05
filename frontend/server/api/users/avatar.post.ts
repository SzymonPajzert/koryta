import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { setUserAvatar } from "~~/server/utils/avatars";
import { imageField } from "~~/server/utils/images";

const bodyValidator = z.object({
  // A square the browser has already cropped and re-encoded - see
  // shared/images.ts.
  image: imageField(
    "avatar",
    "To nie jest zdjęcie profilowe, które przyjmujemy.",
  ),
});

/** Sets the caller's own profile picture.
 *
 * Only for an account whose address is confirmed. A picture is public the
 * moment it is stored (`IMAGE_ACCESS`), at an address on koryta.pl, and an
 * account costs nothing to open with any address at all - so without the
 * check, anybody could host an image on the site from a throwaway account.
 * The token's `email_verified` is enough: a user who has just confirmed gets
 * a fresh token from /profil before uploading.
 *
 * The rest - the record, the mirrors, the old picture and a race with another
 * upload - is `setUserAvatar`'s. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (user.email_verified !== true) {
    throw createError({
      statusCode: 403,
      message: "Potwierdź adres e-mail, zanim dodasz zdjęcie profilowe.",
    });
  }
  const { image } = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  return await setUserAvatar(getFirestore("koryta-pl"), user.uid, image);
});
