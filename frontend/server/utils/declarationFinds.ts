import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { EXTRACTS, READER_FINDS, unitOf } from "~~/server/utils/declarations";
import { resolveMergedNode } from "~~/server/utils/merge";
import {
  FOUND_LIST_LIMIT,
  type DeclarationFind,
  type DeclarationFinds,
} from "~~/shared/declarations";
import { pageIsPublic } from "~~/shared/model";

/**
 * The people a reader found (`creditFinds`), for the list the tally links a
 * signed-in reader to: the newest `FOUND_LIST_LIMIT`, each with the
 * declaration whose crop found them. A page merged since is listed as the
 * page it went into, once; one that is gone, removed or no longer a person is
 * left out, and stays in `total` only.
 *
 * Drafts are listed with their names. The crop came with the link to the
 * whole declaration, which names the person, and any signed-in reader may
 * open a draft (`wantsLatest`). That is the promise the tally makes a reader
 * without an account: sign in, and see whom you found.
 */
export async function findsOf(
  db: Firestore,
  uid: string,
): Promise<DeclarationFinds> {
  const mine = db.collection(READER_FINDS).where("uid", "==", uid);
  const [newest, total] = await Promise.all([
    mine.orderBy("at", "desc").limit(FOUND_LIST_LIMIT).get(),
    mine.count().get(),
  ]);
  const finds = newest.docs.map((doc) => doc.data());
  if (finds.length === 0) return { people: [], total: total.data().count };

  const extractIds = finds.map((find) => String(find.extractId ?? ""));
  // Each crop once, and none at all for no crop: `getAll` wants one at least.
  const extractRefs = [...new Set(extractIds.filter(Boolean))].map((id) =>
    db.collection(EXTRACTS).doc(id),
  );
  const [pages, extracts] = await Promise.all([
    Promise.all(
      finds.map((find) => resolveMergedNode(db, String(find.personId))),
    ),
    extractRefs.length > 0 ? db.getAll(...extractRefs) : [],
  ]);
  const extractById = new Map(
    extracts.map((extract) => [extract.id, extract.data()]),
  );

  const people = new Map<string, DeclarationFind>();
  pages.forEach(({ id, snapshot }, i) => {
    const page = snapshot?.data();
    if (!page || page.type !== "person" || page.deleted === true) return;
    if (people.has(id)) return;
    people.set(id, {
      id,
      name: String(page.name ?? ""),
      published: pageIsPublic(page),
      ...declarationOf(extractById.get(extractIds[i]!)),
    });
  });
  return { people: [...people.values()], total: total.data().count };
}

function declarationOf(
  extract: DocumentData | undefined,
): Pick<DeclarationFind, "unit" | "office" | "declarationYear"> {
  if (!extract) return { unit: "", office: null, declarationYear: null };
  return {
    ...unitOf(extract),
    declarationYear:
      typeof extract.declarationYear === "number"
        ? extract.declarationYear
        : null,
  };
}
