import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import type { Note } from "~~/shared/model";

const bodyValidator = z.object({
  noteId: z.string().min(1),
  sourceIndex: z.number().int().min(0),
  // `undefined` leaves the field untouched, `null`/"" clears it.
  adminStatus: z.enum(["resolved", "unresolved"]).nullable().optional(),
  adminType: z.string().nullable().optional(),
});

/** Admin-only triage of an individual note source.
 *
 * Firestore rules only let a user write their own notes, so admins can't
 * annotate other users' notes from the client. This runs with the admin SDK
 * (which bypasses rules) after verifying the caller's admin claim.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));

  const db = getFirestore("koryta-pl");
  const noteRef = db.collection("notes").doc(body.noteId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(noteRef);
    if (!snap.exists) {
      throw createError({ statusCode: 404, message: "Notatka nie istnieje." });
    }

    const note = snap.data() as Note;
    const sources = note.sources ?? [];
    const source = sources[body.sourceIndex];
    if (!source) {
      throw createError({ statusCode: 404, message: "Źródło nie istnieje." });
    }

    if (body.adminStatus !== undefined) {
      if (body.adminStatus) source.adminStatus = body.adminStatus;
      else delete source.adminStatus;
    }
    if (body.adminType !== undefined) {
      if (body.adminType) source.adminType = body.adminType;
      else delete source.adminType;
    }

    tx.update(noteRef, { sources });
  });

  return { ok: true };
});
