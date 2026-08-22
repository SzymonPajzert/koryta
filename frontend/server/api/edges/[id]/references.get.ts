import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { wantsLatest } from "~~/server/utils/handlers";
import { pageIsPublic } from "~~/shared/model";

/** `references` as it comes back from Firestore. A list written from inside an
 * array by `sanitizeFirestoreData` is stored as a map with numbered keys, so
 * the field has to be read tolerantly - `asArray` in `server/utils/nodeFilters`
 * says the same thing, and is not imported here because that module pulls in
 * the whole node fetching layer.
 */
function referenceIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/** One article a relation rests on, as the sources dialog lists it. */
export type EdgeSource = {
  id: string;
  /** Null when the id in `references` resolves to no node at all. Kept rather
   * than dropped: it is a citation to a page that is gone, and the dialog is
   * the only place anybody can see it is there and detach it. */
  name: string | null;
  sourceURL: string | null;
  published: boolean;
};

export type EdgeSources = {
  id: string;
  sources: EdgeSource[];
};

/** The articles one relation cites.
 *
 * The other direction of /api/edges/byReference, and the read half of the POST
 * next to it. `Edge.references` holds ids alone, so every surface that wants to
 * name them - the sources dialog on an entity page above all - would otherwise
 * fetch each node itself.
 *
 * Uncached on purpose. It is read when somebody opens the dialog and again the
 * moment they add a source, and a cached answer would show them their own write
 * missing. It is two Firestore reads, and nothing asks for them until somebody
 * opens the dialog on one relation.
 */
export default defineEventHandler(async (event): Promise<EdgeSources> => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const edgeSnap = await db.collection("edges").doc(id).get();
  if (!edgeSnap.exists) {
    throw createError({ statusCode: 404, message: "Nie ma takiej relacji." });
  }

  const references = Array.from(
    new Set(referenceIds(edgeSnap.data()?.references)),
  );
  const snaps = references.length
    ? await db.getAll(
        ...references.map((nodeId) => db.collection("nodes").doc(nodeId)),
      )
    : [];
  const nodes = new Map(snaps.map((snap) => [snap.id, snap.data()]));

  const sources = references
    .map((nodeId): EdgeSource => {
      const node = nodes.get(nodeId);
      return {
        id: nodeId,
        name: typeof node?.name === "string" ? node.name : null,
        sourceURL: typeof node?.sourceURL === "string" ? node.sourceURL : null,
        published: !!node && pageIsPublic(node),
      };
    })
    // A draft article, and an id pointing at nothing, are both editors' business
    // rather than a reader's - the same rule the rest of the app applies.
    .filter((source) => (includeDrafts ? true : source.published))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pl"));

  return { id, sources };
});
