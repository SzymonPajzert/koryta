import type { Firestore } from "firebase-admin/firestore";
import {
  declarationPeopleSchema,
  type DeclarationPeople,
} from "~~/shared/declarations";

/**
 * Where the declarations stand in people: one document the declarations job
 * rewrites once a night (`DeclarationPeople`). It cannot be counted here: half
 * of it is on predator, where the crawl and the cutter keep what has not been
 * sent, and the site never learns of a person before their crop arrives.
 */
export const PEOPLE_DOC = "declaration_people";

/** The night's snapshot, or null before the first one, or for one that does
 * not read as one: an old shape is left unsaid rather than half drawn. */
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
