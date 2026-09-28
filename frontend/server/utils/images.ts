import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import {
  IMAGE_ACCESS,
  IMAGE_LIMITS,
  fitsImageLimits,
  maxDataUrlLength,
  sniffImage,
  type ImageInfo,
  type ImagePurpose,
  type StoredImage,
} from "~~/shared/images";
import { pageIsPublic, type ImageRef } from "~~/shared/model";

export type DecodedImage = { data: Buffer; info: ImageInfo };

/** The image in a `data:` url, or null when it is not one the browser could
 * have prepared for `purpose`: not base64, not a PNG, JPEG or WebP, labelled
 * as one format while being another, or outside the purpose's limits.
 *
 * A mislabelled image is refused rather than relabelled. The browser never
 * sends one, so something else did. */
export function decodeImage(
  dataUrl: string,
  purpose: ImagePurpose,
): DecodedImage | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const declared = /^data:(image\/[a-z]+);base64$/.exec(
    dataUrl.slice(0, comma),
  )?.[1];
  if (!declared) return null;

  const data = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (data.length === 0 || data.length > IMAGE_LIMITS[purpose].maxBytes) {
    return null;
  }

  const info = sniffImage(data);
  if (!info || info.contentType !== declared) return null;
  if (!fitsImageLimits(info, purpose)) return null;

  return { data, info };
}

/** A field of a request body carrying an image for `purpose` as a `data:`
 * url, decoded and checked as the body is parsed - so a request with an image
 * the browser could not have prepared is refused whole, like any other field
 * that fails. */
export const imageField = (purpose: ImagePurpose, message: string) =>
  z
    .string()
    .max(maxDataUrlLength(purpose))
    .transform((dataUrl, ctx) => {
      const image = decodeImage(dataUrl, purpose);
      if (!image) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return image;
    });

/** A new `images` document for a decoded image, not yet written, and what the
 * document it belongs to records about it. The caller writes both in one batch,
 * so an image never exists without its owner pointing at it for long. */
export function newImage(
  db: Firestore,
  { data, info }: DecodedImage,
  owner: { purpose: ImagePurpose; subject: string; uploadedBy?: string },
) {
  const ref = db.collection("images").doc();
  const doc: StoredImage = {
    data,
    ...info,
    bytes: data.length,
    purpose: owner.purpose,
    subject: owner.subject,
    ...(owner.uploadedBy ? { uploadedBy: owner.uploadedBy } : {}),
    createdAt: new Date().toISOString(),
  };
  const imageRef: ImageRef = {
    imageId: ref.id,
    ...info,
    bytes: data.length,
  };
  return { ref, doc, imageRef };
}

/** Whether anybody may be handed this image, admin or not - see
 * `IMAGE_ACCESS`. A person's photo is public while its page is, and while it
 * is still the photo that page shows: both read off the node, which only ever
 * holds what an admin approved. */
export async function imageIsPublic(
  db: Firestore,
  imageId: string,
  image: Pick<StoredImage, "purpose" | "subject">,
): Promise<boolean> {
  switch (IMAGE_ACCESS[image.purpose]) {
    case "public":
      return true;
    case "subject": {
      const [collection, subjectId, ...rest] = image.subject.split("/");
      if (collection !== "nodes" || !subjectId || rest.length > 0) {
        return false;
      }
      const node = (await db.collection("nodes").doc(subjectId).get()).data();
      const photo = node?.photo as { imageId?: unknown } | undefined;
      return !!node && pageIsPublic(node) && photo?.imageId === imageId;
    }
    default:
      return false;
  }
}
