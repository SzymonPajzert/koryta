import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  OPEN_CAP,
  OPEN_STATUSES,
  SETTLED_STATUSES,
} from "~~/shared/feedbackQueue";
import type { Feedback } from "~~/shared/model";

const queryValidator = z.object({
  /** How many settled reports to return, newest first. Open ones are always
   * returned in full - see below. */
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** One report to return whatever its age, for a link that points straight
   * at it (Slack's "Otwórz w panelu" lands on `#fb-<id>`). */
  include: z
    .string()
    .regex(/^[^/]{1,200}$/)
    .optional()
    .catch(undefined),
});

const toFeedback = (doc: { id: string; data: () => unknown }): Feedback => ({
  id: doc.id,
  ...(doc.data() as Feedback),
});

/** Admin-only listing of feedback. `feedback` has no Firestore rules block, so
 * the client SDK cannot read it — this route is the only way in.
 *
 * Every open report comes back, however old: the page orders them into the
 * team's work queue, and a queue with its oldest entries cut off by a limit
 * would quietly lose them. Settled reports are history, so only the newest
 * `limit` of those. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const db = getFirestore("koryta-pl");
  const collection = db.collection("feedback");

  const [openSnap, settledSnap, includedSnap] = await Promise.all([
    // No orderBy: the page sorts, and an `in` alone needs no composite index.
    // Past the cap that makes the cut arbitrary, which the page says rather
    // than pretending the list is whole.
    collection
      .where("adminStatus", "in", [...OPEN_STATUSES])
      .limit(OPEN_CAP + 1)
      .get(),
    // Served by the (adminStatus, createdAt DESC) index.
    collection
      .where("adminStatus", "in", [...SETTLED_STATUSES])
      .orderBy("createdAt", "desc")
      .limit(query.limit)
      .get(),
    query.include ? collection.doc(query.include).get() : null,
  ]);

  const openDocs: QueryDocumentSnapshot[] = openSnap.docs.slice(0, OPEN_CAP);
  const feedback = [...openDocs, ...settledSnap.docs].map(toFeedback);

  if (
    includedSnap?.exists &&
    !feedback.some((report) => report.id === includedSnap.id)
  ) {
    feedback.push(toFeedback(includedSnap));
  }

  return {
    feedback,
    openTruncated: openSnap.docs.length > OPEN_CAP,
  };
});
