import type { Firestore } from "firebase-admin/firestore";
import {
  declarationPeopleSchema,
  type DeclarationPeople,
} from "~~/shared/declarations";

/**
 * Where the declarations stand in people: one document (`DeclarationPeople`)
 * the site counts whole from the facts the night sends, and moves during the
 * day for the people an event touches (server/utils/declarationPeopleCount.ts).
 */
export const PEOPLE_DOC = "declaration_people";

/** The snapshot, or null before the first count, or for one that does not
 * read as one: an old shape is left unsaid rather than half drawn. */
export async function readDeclarationPeople(
  db: Firestore,
): Promise<DeclarationPeople | null> {
  const snap = await db.collection("stats").doc(PEOPLE_DOC).get();
  if (!snap.exists) return null;
  const parsed = declarationPeopleSchema.safeParse(snap.data());
  if (!parsed.success) {
    console.error(
      `stats/${PEOPLE_DOC} does not read as a people snapshot:`,
      parsed.error.issues.slice(0, 3),
    );
    return null;
  }
  return parsed.data;
}
