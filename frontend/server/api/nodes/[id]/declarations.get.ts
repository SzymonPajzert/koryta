import { getFirestore } from "firebase-admin/firestore";
import { getRouterParam } from "h3";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { resolveMergedNode } from "~~/server/utils/merge";
import { pageIsPublic } from "~~/shared/model";
import type { LocalOffice, PersonDeclarations } from "~~/shared/declarations";

/** The asset declarations a published person's page links, and whether the
 * site published the page itself because of one.
 *
 * Only public facts: the declaration's address on BIP, its year, the unit and
 * office. Never the crops, never what readers typed.
 *
 * A 404, never an empty answer, for a page that is not public or has nothing
 * to show. Nitro does not cache a 404, so the note appears the moment a page
 * goes live; an empty 200 would be cached for six hours and outlive the
 * publication it is about.
 */
export default authCachedEventHandler(
  async (event): Promise<PersonDeclarations> => {
    const id = getRouterParam(event, "id");
    if (!id) throw createError({ statusCode: 400, message: "Missing id" });

    const db = getFirestore("koryta-pl");
    const { id: personId, snapshot } = await resolveMergedNode(db, id);
    const person = snapshot?.data();
    if (!person || person.type !== "person" || !pageIsPublic(person)) {
      throw createError({ statusCode: 404, message: `No page ${id}` });
    }

    const record = (
      await db.collection("declarationPublications").doc(personId).get()
    ).data();
    const shown =
      record?.status === "published" || record?.status === "confirmed";
    const declarations = (
      Array.isArray(record?.declarations) ? record.declarations : []
    ).filter(
      (declaration: { url?: unknown }) =>
        typeof declaration.url === "string" &&
        /^https?:\/\//.test(declaration.url),
    );
    if (!shown || declarations.length === 0) {
      throw createError({ statusCode: 404, message: `No declarations ${id}` });
    }

    return {
      autoPublished:
        record.status === "published" && record.autoPublished === true
          ? { at: isoOf(record.publishedAt) }
          : null,
      declarations: declarations.map(
        (declaration: {
          url: string;
          year?: number | null;
          unit?: string | null;
          office?: LocalOffice | null;
        }) => ({
          url: declaration.url,
          year: declaration.year ?? null,
          unit: declaration.unit ?? "",
          office: declaration.office ?? null,
        }),
      ),
    };
  },
);

/** A stored instant as ISO: a Firestore Timestamp, a Date or a string. */
function isoOf(value: unknown): string {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}
