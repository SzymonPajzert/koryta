import { getFirestore } from "firebase-admin/firestore";
import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseHeaders,
} from "h3";
import { getOptionalUser } from "~~/server/utils/auth";
import { imageIsPublic } from "~~/server/utils/images";
import {
  IMAGE_ACCESS,
  IMAGE_ID_PATTERN,
  isImageType,
  type StoredImage,
} from "~~/shared/images";

/** How long a public image may be kept, by the CDN in front of App Hosting and
 * by browsers. An image never changes under its id, but it can stop being
 * public - a photo replaced, a page taken down - and this is how long that
 * takes to reach everyone who has it. */
const PUBLIC_MAX_AGE = 60 * 60 * 24;

/** One image from `images`, to whoever may see it - see `IMAGE_ACCESS`.
 *
 * Admins may see every image. They fetch with their token and show the image
 * from an object url, since an `<img src>` cannot carry one; a public image is
 * an ordinary `<img src="/api/images/<id>">`.
 */
export default defineEventHandler(async (event) => {
  const notFound = () => {
    // Never cached: an image that is not public yet may be one tomorrow.
    setResponseHeader(event, "Cache-Control", "no-store");
    return createError({ statusCode: 404, message: "Nie ma takiego obrazu." });
  };

  const id = getRouterParam(event, "id") ?? "";
  if (!IMAGE_ID_PATTERN.test(id)) throw notFound();

  const db = getFirestore("koryta-pl");
  const image = (await db.collection("images").doc(id).get()).data() as
    Partial<StoredImage> | undefined;
  if (
    !image ||
    !Buffer.isBuffer(image.data) ||
    !isImageType(image.contentType) ||
    !image.purpose ||
    !(image.purpose in IMAGE_ACCESS) ||
    typeof image.subject !== "string"
  ) {
    throw notFound();
  }

  const isPublic = await imageIsPublic(db, id, {
    purpose: image.purpose,
    subject: image.subject,
  });
  // Not found rather than forbidden for anybody but an admin: whether a
  // report came with a screenshot, or a person has a photo waiting for review,
  // is not theirs to learn either.
  if (!isPublic && (await getOptionalUser(event))?.admin !== true) {
    throw notFound();
  }

  setResponseHeaders(event, {
    // The type the server read off the bytes when it took them, so an image is
    // only ever served as the image it is.
    "Content-Type": image.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": isPublic
      ? `public, max-age=${PUBLIC_MAX_AGE}`
      : "private, max-age=86400",
  });
  return image.data;
});
