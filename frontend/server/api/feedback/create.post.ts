import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getOptionalUser } from "~~/server/utils/auth";
import {
  decodeScreenshot,
  feedbackScreenshotRef,
} from "~~/server/utils/feedbackScreenshots";
import {
  MAX_FEEDBACK_SCREENSHOTS,
  MAX_FEEDBACK_SCREENSHOT_DATA_URL_LENGTH,
} from "~~/shared/feedbackScreenshots";
import type { Feedback } from "~~/shared/model";

const bodyValidator = z.object({
  kind: z.enum(["bug", "idea", "data", "other"]),
  message: z.string().trim().min(1).max(4000),
  // Only ever shown to us, and only if the reporter chose to leave it.
  contact: z.string().trim().max(200).optional(),
  // Hidden in the form, so only a bot filling every input reaches this.
  website: z.string().max(200).optional(),
  context: z.object({
    // Must be a site-relative path. The admin panel turns this into a link,
    // so anything else is a way for an anonymous reporter to hand an admin a
    // `javascript:` URL or a convincing phishing destination. A single leading
    // slash, never two, which would make it protocol-relative.
    route: z
      .string()
      .max(500)
      .regex(/^\/(?!\/)/, "Ścieżka musi być względna."),
    nodeId: z.string().max(200).optional(),
    pageTitle: z.string().max(300).optional(),
    viewport: z
      .object({
        width: z.number().int().positive().max(20000),
        height: z.number().int().positive().max(20000),
      })
      .optional(),
    // Present when the report was written on /qa. The title is taken as the
    // client sends it rather than looked up in the changelog: it is what the
    // reporter actually had in front of them, and an entry edited or dropped
    // since should not turn their report into a dangling id.
    qa: z
      .object({
        itemId: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(300),
        status: z.enum(["ok", "issue"]),
      })
      .optional(),
  }),
  // Images the dialog has already re-encoded, as `data:` urls - see
  // shared/feedbackScreenshots.ts. Each is decoded and checked here, so a
  // report with one that is not an image is refused whole, like any other
  // field that fails.
  screenshots: z
    .array(
      z
        .string()
        .max(MAX_FEEDBACK_SCREENSHOT_DATA_URL_LENGTH)
        .transform((dataUrl, ctx) => {
          const screenshot = decodeScreenshot(dataUrl);
          if (!screenshot) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Zrzut ekranu nie jest obrazem, który przyjmujemy.",
            });
            return z.NEVER;
          }
          return screenshot;
        }),
    )
    .max(MAX_FEEDBACK_SCREENSHOTS)
    .optional(),
});

/** Ceiling on reports accepted in a day, far above any plausible real volume.
 * Breaching it does not reject the report - it saves it and suppresses the
 * Slack forward, so an abuser can flood the admin queue but cannot flood the
 * team's channel, and a real reporter is never turned away. */
const DAILY_SLACK_CAP = 500;

/** Ceiling on screenshots kept in a day, on the same terms: past it a report
 * is still saved, without its images, so a flood of them cannot fill the
 * database. A megabyte each, a hundred a day, is far more than people send. */
const DAILY_SCREENSHOT_CAP = 100;

/** Counts the report, and its screenshots if they fit, against the day's
 * allowances. */
async function claimDailyAllowance(
  db: ReturnType<typeof getFirestore>,
  screenshots: number,
): Promise<{ forwardToSlack: boolean; keepScreenshots: boolean }> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection("feedbackLimits").doc(day);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get("count") as number | undefined) ?? 0;
    const kept = (snap.get("screenshots") as number | undefined) ?? 0;
    const keepScreenshots =
      screenshots > 0 && kept + screenshots <= DAILY_SCREENSHOT_CAP;
    tx.set(
      ref,
      {
        count: count + 1,
        day,
        ...(keepScreenshots ? { screenshots: kept + screenshots } : {}),
      },
      { merge: true },
    );
    return { forwardToSlack: count < DAILY_SLACK_CAP, keepScreenshots };
  });
}

/** Accept a piece of user feedback.
 *
 * Deliberately open to signed-out visitors: the whole point is to lower the
 * bar for telling us something is wrong. Writes go through the admin SDK so
 * `feedback` stays closed to the client SDK entirely.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));
  const user = await getOptionalUser(event);

  // A filled honeypot means a bot walked the form. Answer as if it worked -
  // telling a spammer which of their submissions were dropped is how they
  // learn to get past this.
  if (body.website) return { id: null };

  const db = getFirestore("koryta-pl");
  const attached = body.screenshots ?? [];
  const { forwardToSlack, keepScreenshots } = await claimDailyAllowance(
    db,
    attached.length,
  );
  const screenshots = keepScreenshots ? attached : [];
  const dropped = attached.length - screenshots.length;

  const doc: Feedback = {
    kind: body.kind,
    message: body.message,
    context: {
      ...body.context,
      // Read from the request rather than the body: the client has no reason
      // to be trusted about this, and it is the same string either way.
      userAgent: getRequestHeader(event, "user-agent")?.slice(0, 500),
    },
    createdAt: new Date().toISOString(),
    adminStatus: "new",
    ...(user ? { userUid: user.uid } : {}),
    ...(body.contact ? { contact: body.contact } : {}),
    ...(screenshots.length > 0
      ? {
          screenshots: screenshots.map(({ data, info }) => ({
            ...info,
            bytes: data.length,
          })),
        }
      : {}),
    ...(dropped > 0 ? { screenshotsDropped: dropped } : {}),
    // Marking it already-handled is what stops the trigger forwarding it.
    ...(forwardToSlack
      ? {}
      : { slack: { state: "failed" as const, error: "daily_cap" } }),
  };

  // One batch, so a report and its images are saved together or not at all:
  // the trigger that forwards the report fires as soon as it exists, and the
  // panel must never list an image that is not there.
  const ref = db.collection("feedback").doc();
  const batch = db.batch();
  batch.set(ref, doc);
  screenshots.forEach(({ data, info }, index) => {
    batch.set(feedbackScreenshotRef(db, ref.id, index), {
      data,
      contentType: info.contentType,
      createdAt: doc.createdAt,
    });
  });
  await batch.commit();

  return {
    id: ref.id,
    ...(dropped > 0 ? { screenshotsDropped: dropped } : {}),
  };
});
