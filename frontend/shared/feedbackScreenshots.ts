/** Screenshots a reporter attaches to a report from the "Zgłoś" dialog.
 *
 * The browser re-encodes every image before it leaves the reporter's device
 * (`app/composables/feedbackScreenshots.ts`). Only the pixels survive that, so
 * the EXIF block a phone photo carries - its GPS position included - never
 * reaches us, and the image comes down to a size one Firestore document holds.
 * The server then checks that the bytes are the image they claim to be
 * (`sniffImage`) and stores each one as a document of its own under the report,
 * `feedback/<id>/screenshots/<n>`, which only the admin SDK reads.
 *
 * Not Cloud Storage: the project's Firebase bucket is readable and listable by
 * anybody, and a report's screenshot is as private as its text.
 */
import type { FeedbackScreenshot } from "./model";

/** Per report. Enough for a before and an after, and a bound on the request. */
export const MAX_FEEDBACK_SCREENSHOTS = 3;

/** Per image, as stored. A Firestore document holds 1 MiB in all, and this
 * leaves room for its name and its other fields. */
export const MAX_FEEDBACK_SCREENSHOT_BYTES = 1_000_000;

/** The longest side, in pixels. A full-page capture of a long page is narrow
 * and very tall, and still has to be read. Under the 8000 px an image handed to
 * Claude may have, so an agent reading the report can be shown it. */
export const MAX_FEEDBACK_SCREENSHOT_SIDE = 8000;

/** Pixels in all: a desktop screenshot at twice its CSS size, 3840×2160, fits
 * whole. Larger images are scaled down to this before they are encoded. */
export const MAX_FEEDBACK_SCREENSHOT_PIXELS = 4096 * 2048;

/** Spelled out in `shared/model.ts`, which the Cloud Functions build compiles
 * and this file is not part of. */
export type FeedbackScreenshotType = FeedbackScreenshot["contentType"];

/** What the browser's canvas writes. WebP where it can, JPEG in Safari, which
 * reads WebP but cannot write it; PNG is what any canvas falls back to. Never
 * SVG, which is a document that can carry script rather than an image. */
export const FEEDBACK_SCREENSHOT_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const satisfies readonly FeedbackScreenshotType[];

/** The longest `data:` url a screenshot can arrive as: the base64 of the
 * largest image allowed, and its prefix. Checked before anything is decoded. */
export const MAX_FEEDBACK_SCREENSHOT_DATA_URL_LENGTH =
  Math.ceil(MAX_FEEDBACK_SCREENSHOT_BYTES / 3) * 4 + 32;

export const isFeedbackScreenshotType = (
  value: unknown,
): value is FeedbackScreenshotType =>
  (FEEDBACK_SCREENSHOT_TYPES as readonly unknown[]).includes(value);

export type ImageInfo = {
  contentType: FeedbackScreenshotType;
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
 * the admin panel serves the image back with this type, and a type the client
 * chose could make a browser treat an HTML file as a page. Only the header is
 * read - nothing here decodes the pixels, which is the admin's browser's job. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}

/** Whether a size is one the dialog could have sent. The server takes nothing
 * larger: a small file can declare a huge canvas, and decoding it is what
 * would stall the admin's tab. */
export const fitsFeedbackScreenshotLimits = ({
  width,
  height,
}: {
  width: number;
  height: number;
}) =>
  width >= 1 &&
  height >= 1 &&
  Math.max(width, height) <= MAX_FEEDBACK_SCREENSHOT_SIDE &&
  width * height <= MAX_FEEDBACK_SCREENSHOT_PIXELS;
