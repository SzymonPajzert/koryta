/** Every image the site takes from its users, whatever it is for: a
 * screenshot with a report, a profile picture, a photo of a person.
 *
 * All three arrive the same way and are kept the same way. The browser draws
 * each one on a canvas and encodes it again before it leaves the device
 * (`app/utils/screenshotImage.ts`): only the pixels survive that, so the EXIF
 * block a phone photo carries - its GPS position among it - never reaches us,
 * and the image comes down to the size its purpose allows. The server reads the
 * header of what arrived (`sniffImage`), refuses anything else, and stores the
 * bytes as a document of its own, `images/<id>`, which only the admin SDK
 * reads. `/api/images/<id>` hands one back, to whoever `IMAGE_ACCESS` says may
 * see it.
 *
 * Not Cloud Storage: the project's Firebase bucket answers anonymous listings,
 * so it cannot hold anything that is not meant for everybody, and a report's
 * screenshot is as private as its text. A document also keeps one mechanism for
 * the public images: served through the route with a cache header, the CDN in
 * front of App Hosting answers all but the first request for each.
 */
import type { ImageRef } from "./model";

/** Why an image was uploaded, which decides how large it may be and who may
 * see it. */
export type ImagePurpose = "feedback" | "avatar" | "person";

export type ImageLimits = {
  /** Encoded size, the most the stored document may hold. */
  maxBytes: number;
  /** The longest side, in pixels. */
  maxSide: number;
  /** Pixels in all. Larger images are scaled down to this before they are
   * encoded, and the server takes nothing larger: a small file can declare a
   * huge canvas, and decoding it is what would stall whoever opens it. */
  maxPixels: number;
  /** Cropped to a square in the browser, and refused otherwise. */
  square?: boolean;
};

/** A Firestore document holds 1 MiB in all; every limit leaves room for the
 * document's name and its other fields. */
export const IMAGE_LIMITS: Record<ImagePurpose, ImageLimits> = {
  // A screenshot has to stay readable. A full-page capture of a long page is
  // narrow and very tall; 8000 px is also the most an image handed to Claude
  // may have, so an agent reading the report can be shown it. 4096×2048 takes
  // a desktop screenshot at twice its CSS size, 3840×2160, whole.
  feedback: { maxBytes: 1_000_000, maxSide: 8000, maxPixels: 4096 * 2048 },
  // Drawn at 40 px beside a name and at 80 px on /profil, so 512 is sharp on
  // any screen and a few dozen kilobytes.
  avatar: {
    maxBytes: 200_000,
    maxSide: 512,
    maxPixels: 512 * 512,
    square: true,
  },
  // A portrait on a person's page, and large enough for a social card.
  person: { maxBytes: 500_000, maxSide: 1600, maxPixels: 1600 * 1600 },
};

/** Who may be handed an image back.
 *
 * - `admin`: admins alone. A report's screenshot.
 * - `public`: anybody. A profile picture, which the user chose to show - one
 *   replaced or removed is deleted, so only the current one resolves.
 * - `subject`: anybody while it is the approved photo of a published page,
 *   admins otherwise. Read off the page itself at every request, so a photo
 *   that is replaced, or whose page is taken down, stops being public with no
 *   bookkeeping of its own. Before approval only the reviewers see it.
 */
export const IMAGE_ACCESS: Record<
  ImagePurpose,
  "admin" | "public" | "subject"
> = {
  feedback: "admin",
  avatar: "public",
  person: "subject",
};

/** Per report. Enough for a before and an after, and a bound on the request. */
export const MAX_FEEDBACK_SCREENSHOTS = 3;

/** Spelled out in `shared/model.ts`, which the Cloud Functions build compiles
 * and this file is not part of. */
export type ImageType = ImageRef["contentType"];

/** What the browser's canvas writes. WebP where it can, JPEG in Safari, which
 * reads WebP but cannot write it; PNG is what any canvas falls back to. Never
 * SVG, which is a document that can carry script rather than an image. */
export const IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const satisfies readonly ImageType[];

export const isImageType = (value: unknown): value is ImageType =>
  (IMAGE_TYPES as readonly unknown[]).includes(value);

/** The longest `data:` url an image for `purpose` can arrive as: the base64 of
 * the largest one allowed, and its prefix. Checked before anything is
 * decoded. */
export const maxDataUrlLength = (purpose: ImagePurpose) =>
  Math.ceil(IMAGE_LIMITS[purpose].maxBytes / 3) * 4 + 32;

/** Where an image is served from, relative to the site. */
export const imagePath = (imageId: string) => `/api/images/${imageId}`;

/** An image id, as Firestore makes them. Checked wherever one arrives from a
 * client, so it can never name a document outside `images`. */
export const IMAGE_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/** `images/<id>`: one image and what it is for. */
export type StoredImage = {
  data: Uint8Array;
  contentType: ImageType;
  width: number;
  height: number;
  /** `data.length`, kept so a listing need not read the image to know it. */
  bytes: number;
  purpose: ImagePurpose;
  /** The document it belongs to, as a path: the report it came with
   * (`feedback/<id>`), the user whose picture it is (`users/<uid>`), the person
   * it shows (`nodes/<id>`). */
  subject: string;
  /** Who sent it. Absent for an anonymous report. */
  uploadedBy?: string;
  createdAt: string;
};

export type ImageInfo = {
  contentType: ImageType;
  width: number;
  height: number;
};

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  [...text].every((char, i) => bytes[start + i] === char.charCodeAt(0));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return null;
  // The first chunk is always IHDR, and it opens with the size.
  if (!ascii(bytes, 12, "IHDR")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    contentType: "image/png",
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

/** Start-of-frame markers, which carry the size: C0-CF except C4 (Huffman
 * tables), C8 (reserved) and CC (arithmetic coding conditions). */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 &&
  marker <= 0xcf &&
  marker !== 0xc4 &&
  marker !== 0xc8 &&
  marker !== 0xcc;

function jpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // Padding before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers that stand alone, with no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // The scan, or the end, before any frame said how big it is.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (at + 8 >= bytes.length) return null;
      return {
        contentType: "image/jpeg",
        height: (bytes[at + 5]! << 8) | bytes[at + 6]!,
        width: (bytes[at + 7]! << 8) | bytes[at + 8]!,
      };
    }
    at += 2 + length;
  }
  return null;
}

function webp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) return null;
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return null;
  const b = (i: number) => bytes[i]!;
  // Lossy: a frame tag, the start code, then two 14-bit sizes.
  if (ascii(bytes, 12, "VP8 ")) {
    if (b(23) !== 0x9d || b(24) !== 0x01 || b(25) !== 0x2a) return null;
    return {
      contentType: "image/webp",
      width: (b(26) | (b(27) << 8)) & 0x3fff,
      height: (b(28) | (b(29) << 8)) & 0x3fff,
    };
  }
  // Lossless: a signature byte, then both sizes less one, 14 bits each.
  if (ascii(bytes, 12, "VP8L")) {
    if (b(20) !== 0x2f) return null;
    return {
      contentType: "image/webp",
      width: 1 + (b(21) | ((b(22) & 0x3f) << 8)),
      height: 1 + ((b(22) >> 6) | (b(23) << 2) | ((b(24) & 0x0f) << 10)),
    };
  }
  // Extended, which a canvas writes for an image with transparency: the
  // canvas size less one, 24 bits each.
  if (ascii(bytes, 12, "VP8X")) {
    return {
      contentType: "image/webp",
      width: 1 + (b(24) | (b(25) << 8) | (b(26) << 16)),
      height: 1 + (b(27) | (b(28) << 8) | (b(29) << 16)),
    };
  }
  return null;
}

/** What an image's own header says it is and how big, or null for anything
 * that is not a PNG, JPEG or WebP.
 *
 * Read from the bytes rather than taken from the `data:` url or a file name:
 * the image is served back with this type, and a type the client chose could
 * make a browser treat an HTML file as a page. Only the header is read -
 * nothing here decodes the pixels. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}

/** Whether a size is one the browser could have sent for `purpose`. */
export function fitsImageLimits(
  { width, height }: { width: number; height: number },
  purpose: ImagePurpose,
): boolean {
  const limits = IMAGE_LIMITS[purpose];
  return (
    width >= 1 &&
    height >= 1 &&
    Math.max(width, height) <= limits.maxSide &&
    width * height <= limits.maxPixels &&
    (!limits.square || width === height)
  );
}
