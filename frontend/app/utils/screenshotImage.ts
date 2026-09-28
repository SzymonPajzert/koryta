import {
  MAX_FEEDBACK_SCREENSHOT_BYTES,
  MAX_FEEDBACK_SCREENSHOT_PIXELS,
  MAX_FEEDBACK_SCREENSHOT_SIDE,
} from "~~/shared/feedbackScreenshots";

/** An image ready to go with a report. */
export type PreparedScreenshot = {
  /** What is sent, and what the dialog previews: a `data:` url. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
};

/** A reason the reporter can act on - the dialog shows the message as is. */
export class ScreenshotError extends Error {}

/** The size to draw an image at: within the limits, the same shape, and
 * `shrink` times smaller again when an attempt came out too heavy. */
export function fitScreenshot(
  width: number,
  height: number,
  shrink = 1,
): { width: number; height: number } {
  const scale =
    Math.min(
      1,
      MAX_FEEDBACK_SCREENSHOT_SIDE / Math.max(width, height),
      Math.sqrt(MAX_FEEDBACK_SCREENSHOT_PIXELS / (width * height)),
    ) * shrink;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** Each attempt draws the image this much smaller than it may be, until one
 * fits in `MAX_FEEDBACK_SCREENSHOT_BYTES`. A screenshot fits on the first; a
 * photo from a phone takes a step or two. */
const SHRINK_STEPS = [1, 0.8, 0.64, 0.5, 0.4, 0.3];

type Decoded = { source: CanvasImageSource; width: number; height: number };

async function decode(file: Blob): Promise<{
  image: Decoded;
  release: () => void;
}> {
  // An image element rather than createImageBitmap: it applies the EXIF
  // orientation in every browser, so a phone photo is not drawn on its side.
  const url = URL.createObjectURL(file);
  const element = new Image();
  element.src = url;
  try {
    await element.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ScreenshotError(
      "Nie udało się odczytać tego pliku jako obrazu. Spróbuj PNG albo JPG.",
    );
  }
  return {
    image: {
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
    },
    release: () => URL.revokeObjectURL(url),
  };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** The image drawn at `size`, as WebP, or as JPEG where the browser cannot
 * write WebP. */
async function encode(
  image: Decoded,
  size: { width: number; height: number },
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new ScreenshotError(
        "Ta przeglądarka nie potrafi zmniejszyć obrazu.",
      );
    }
    // Transparent areas turn white, as they were on the page: JPEG has no
    // transparency, and they would come out black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, 0, 0, size.width, size.height);

    const webp = await toBlob(canvas, "image/webp", 0.9);
    // Safari hands back a PNG when asked for WebP, several times the size of
    // a JPEG of the same picture.
    if (webp?.type === "image/webp") return webp;
    const jpeg = await toBlob(canvas, "image/jpeg", 0.9);
    if (!jpeg) throw new ScreenshotError("Nie udało się zapisać obrazu.");
    return jpeg;
  } finally {
    // Safari caps the memory all canvases may hold; let this one go now.
    canvas.width = 0;
    canvas.height = 0;
  }
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** An image the reporter picked, pasted or dropped, made fit to send.
 *
 * Drawn onto a canvas and encoded again, which is what keeps the reporter's
 * metadata at home: a canvas holds pixels and nothing else, so the EXIF block
 * of a phone photo - the place it was taken among it - is not in what leaves.
 * It is also what brings the image under the size one Firestore document can
 * hold, scaling it down a step at a time until it fits.
 */
export async function prepareScreenshot(
  file: Blob,
): Promise<PreparedScreenshot> {
  const { image, release } = await decode(file);
  try {
    if (image.width === 0 || image.height === 0) {
      throw new ScreenshotError("Ten obraz jest pusty.");
    }
    for (const shrink of SHRINK_STEPS) {
      const size = fitScreenshot(image.width, image.height, shrink);
      const blob = await encode(image, size);
      if (blob.size <= MAX_FEEDBACK_SCREENSHOT_BYTES) {
        return {
          dataUrl: await readAsDataUrl(blob),
          ...size,
          bytes: blob.size,
        };
      }
    }
    throw new ScreenshotError("Ten obraz jest za duży, nawet po zmniejszeniu.");
  } finally {
    release();
  }
}
