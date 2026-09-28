import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { setUserPhotoURL } from "~~/server/utils/avatars";
import {
  deleteImages,
  imageField,
  imagesOf,
  newImage,
} from "~~/server/utils/images";
import { imagePath } from "~~/shared/images";

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
 * The new picture is stored before anything points at it, and the old one is
 * deleted only after nothing does, so a failure half way leaves an unused
 * image behind rather than a picture that does not load. Deleting the old one
 * is also what keeps a user to one stored picture however often they change
 * it.
 *
 * The url is absolute because Auth takes nothing else, and it is the site's
 * own: the picture is served by `/api/images/<id>`, which lets anybody see an
 * avatar. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const { image } = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const db = getFirestore("koryta-pl");
  const subject = `users/${user.uid}`;
  const previous = await imagesOf(db, subject, "avatar");

  const created = newImage(db, image, {
    purpose: "avatar",
    subject,
    uploadedBy: user.uid,
  });
  await created.ref.set(created.doc);

  const photoURL = `${useRuntimeConfig(event).public.siteUrl}${imagePath(created.ref.id)}`;
  await setUserPhotoURL(db, user.uid, photoURL);
  await deleteImages(db, previous);

  return { photoURL, image: created.imageRef };
});
