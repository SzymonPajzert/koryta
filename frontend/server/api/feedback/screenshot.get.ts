import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeaders } from "h3";
import { requireAdmin } from "~~/server/utils/auth";
import { feedbackScreenshotRef } from "~~/server/utils/feedbackScreenshots";
import {
  MAX_FEEDBACK_SCREENSHOTS,
  isFeedbackScreenshotType,
} from "~~/shared/feedbackScreenshots";

const queryValidator = z.object({
  id: z.string().regex(/^[^/]{1,200}$/),
  /** The image's position in the report's `screenshots`. */
  n: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_FEEDBACK_SCREENSHOTS - 1),
});

/** One image attached to a report, for the admin panel.
 *
 * Admin-only, like the list the report comes from: a screenshot is as private
 * as the text it came with, and often says more about who took it. The panel
 * fetches it with the admin's token and shows it from an object url, since an
 * `<img src>` cannot carry one.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { id, n } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );

  const snap = await feedbackScreenshotRef(
    getFirestore("koryta-pl"),
    id,
    n,
  ).get();
  const data: unknown = snap.get("data");
  const contentType: unknown = snap.get("contentType");
  if (!Buffer.isBuffer(data) || !isFeedbackScreenshotType(contentType)) {
    throw createError({
      statusCode: 404,
      message: "Nie ma takiego zrzutu ekranu.",
    });
  }

  setResponseHeaders(event, {
    // The type the server read off the bytes when it took them, so an image is
    // only ever served as the image it is.
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    // A report's images are written once, with the report, and never change.
    "Cache-Control": "private, max-age=86400, immutable",
  });
  return data;
});
