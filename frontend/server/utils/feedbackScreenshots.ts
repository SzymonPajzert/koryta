import type { Firestore } from "firebase-admin/firestore";
import {
  MAX_FEEDBACK_SCREENSHOT_BYTES,
  fitsFeedbackScreenshotLimits,
  sniffImage,
  type ImageInfo,
} from "~~/shared/feedbackScreenshots";

export type DecodedScreenshot = { data: Buffer; info: ImageInfo };

/** The image in a `data:` url from the feedback dialog, or null when it is not
 * one the dialog could have produced: not base64, not a PNG, JPEG or WebP,
 * labelled as one format while being another, or over the size limits.
 *
 * A mislabelled image is refused rather than relabelled. The dialog never
 * sends one, so something else did. */
export function decodeScreenshot(dataUrl: string): DecodedScreenshot | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const declared = /^data:(image\/[a-z]+);base64$/.exec(
    dataUrl.slice(0, comma),
  )?.[1];
  if (!declared) return null;

  const data = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (data.length === 0 || data.length > MAX_FEEDBACK_SCREENSHOT_BYTES) {
    return null;
  }

  const info = sniffImage(data);
  if (!info || info.contentType !== declared) return null;
  if (!fitsFeedbackScreenshotLimits(info)) return null;

  return { data, info };
}

/** Where the `index`th image of a report is kept: a document of its own under
 * the report, so listing reports never reads an image, and the rule that shuts
 * the client SDK out of `feedback` is spelled out for it too. */
export const feedbackScreenshotRef = (
  db: Firestore,
  feedbackId: string,
  index: number,
) =>
  db
    .collection("feedback")
    .doc(feedbackId)
    .collection("screenshots")
    .doc(String(index));
