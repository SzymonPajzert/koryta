import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import {
  IMAGE_ACCESS,
  IMAGE_LIMITS,
  fitsImageLimits,
  isImageType,
  maxDataUrlLength,
  sniffImage,
  type ImageInfo,
  type ImagePurpose,
  type StoredImage,
} from "~~/shared/images";
import { pageIsPublic, type ImageRef, type PersonPhoto } from "~~/shared/model";

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

/** The ids of the images `subject` owns for `purpose`. Read without the
 * bytes, and on one field, which needs no composite index. */
export async function imagesOf(
  db: Firestore,
  subject: string,
  purpose: ImagePurpose,
): Promise<string[]> {
  const snap = await db
    .collection("images")
    .where("subject", "==", subject)
    .select("purpose")
    .get();
  return snap.docs
    .filter((doc) => doc.get("purpose") === purpose)
    .map((doc) => doc.id);
}

export async function deleteImages(db: Firestore, ids: readonly string[]) {
  if (ids.length === 0) return;
  const batch = db.batch();
  for (const id of ids) batch.delete(db.collection("images").doc(id));
  await batch.commit();
}

/** A photo as a proposal names it, before it is checked. */
export type PhotoProposal = Pick<
  PersonPhoto,
  "imageId" | "source" | "author" | "license"
>;

/** A proposed photo, checked against the image it names and completed from it.
 *
 * The image has to be a photo uploaded for this very page. Approving the
 * proposal is what makes it public, so a report's screenshot or somebody's
 * avatar named here would be published by a reviewer who only meant to accept
 * a portrait - and a photo uploaded for one person must not turn up on
 * another's page. Its type and size come from the stored image, never from the
 * proposal. */
export async function photoFromUpload(
  db: Firestore,
  proposal: PhotoProposal,
  nodeId: string | undefined,
): Promise<PersonPhoto> {
  if (!nodeId) {
    throw createError({
      statusCode: 400,
      message: "Zdjęcie można dodać do wpisu, który już istnieje.",
    });
  }
  // Without the bytes: only what the photo records about the image is needed.
  const [snap] = await db.getAll(
    db.collection("images").doc(proposal.imageId),
    {
      fieldMask: [
        "purpose",
        "subject",
        "contentType",
        "width",
        "height",
        "bytes",
      ],
    },
  );
  const image = snap?.data() as Partial<StoredImage> | undefined;
  if (
    !image ||
    image.purpose !== "person" ||
    image.subject !== `nodes/${nodeId}` ||
    !isImageType(image.contentType)
  ) {
    throw createError({
      statusCode: 400,
      message: "To zdjęcie nie zostało dodane do tej osoby.",
    });
  }
  return {
    imageId: proposal.imageId,
    contentType: image.contentType,
    width: image.width ?? 0,
    height: image.height ?? 0,
    bytes: image.bytes ?? 0,
    source: proposal.source,
    ...(proposal.author ? { author: proposal.author } : {}),
    ...(proposal.license ? { license: proposal.license } : {}),
  };
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
