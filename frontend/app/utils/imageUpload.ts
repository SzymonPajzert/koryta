import { IMAGE_LIMITS, type ImagePurpose } from "~~/shared/images";

/** An image ready to be sent for one purpose. */
export type PreparedImage = {
  /** What is sent, and what a form can preview: a `data:` url. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
};

/** A reason the person uploading can act on - forms show the message as is. */
export class ImageUploadError extends Error {}

/** The part of an image that is kept: all of it, or for a purpose that wants a
 * square, the largest one in its middle. */
export function cropFor(
  width: number,
  height: number,
  purpose: ImagePurpose,
): { x: number; y: number; width: number; height: number } {
  if (!IMAGE_LIMITS[purpose].square) return { x: 0, y: 0, width, height };
  const side = Math.min(width, height);
  return {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

/** The size to draw a crop at: within the purpose's limits, the same shape,
 * and `shrink` times smaller again when an attempt came out too heavy. */
export function fitImage(
  width: number,
  height: number,
  purpose: ImagePurpose,
  shrink = 1,
): { width: number; height: number } {
  const limits = IMAGE_LIMITS[purpose];
  const scale =
    Math.min(
      1,
      limits.maxSide / Math.max(width, height),
      Math.sqrt(limits.maxPixels / (width * height)),
    ) * shrink;
  const fitted = {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
  // Rounding each side on its own could leave a square a pixel off one.
  if (limits.square) fitted.height = fitted.width;
  return fitted;
}

/** Each attempt draws the image this much smaller than it may be, until one
 * fits in the purpose's `maxBytes`. A screenshot fits on the first; a photo
 * from a phone takes a step or two. */
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
    throw new ImageUploadError(
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

/** `crop` of the image drawn at `size`, as WebP, or as JPEG where the browser
 * cannot write WebP. */
async function encode(
  image: Decoded,
  crop: ReturnType<typeof cropFor>,
  size: { width: number; height: number },
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new ImageUploadError(
        "Ta przeglądarka nie potrafi zmniejszyć obrazu.",
      );
    }
    // Transparent areas turn white, as they were on the page: JPEG has no
    // transparency, and they would come out black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image.source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      size.width,
      size.height,
    );

    const webp = await toBlob(canvas, "image/webp", 0.9);
    // Safari hands back a PNG when asked for WebP, several times the size of
    // a JPEG of the same picture.
    if (webp?.type === "image/webp") return webp;
    const jpeg = await toBlob(canvas, "image/jpeg", 0.9);
    if (!jpeg) throw new ImageUploadError("Nie udało się zapisać obrazu.");
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

/** An image somebody picked, pasted or dropped, made fit to send for
 * `purpose` - see `IMAGE_LIMITS`.
 *
 * Drawn onto a canvas and encoded again, which is what keeps the sender's
 * metadata at home: a canvas holds pixels and nothing else, so the EXIF block
 * of a phone photo - the place it was taken among it - is not in what leaves.
 * It is also what brings the image to the size its purpose allows, cropping it
 * to a square where that is wanted and scaling it down a step at a time until
 * it fits.
 */
export async function prepareImage(
  file: Blob,
  purpose: ImagePurpose,
): Promise<PreparedImage> {
  const { image, release } = await decode(file);
  try {
    if (image.width === 0 || image.height === 0) {
      throw new ImageUploadError("Ten obraz jest pusty.");
    }
    const crop = cropFor(image.width, image.height, purpose);
    for (const shrink of SHRINK_STEPS) {
      const size = fitImage(crop.width, crop.height, purpose, shrink);
      const blob = await encode(image, crop, size);
      if (blob.size <= IMAGE_LIMITS[purpose].maxBytes) {
        return {
          dataUrl: await readAsDataUrl(blob),
          ...size,
          bytes: blob.size,
        };
      }
    }
    throw new ImageUploadError(
      "Ten obraz jest za duży, nawet po zmniejszeniu.",
    );
  } finally {
    release();
  }
}
