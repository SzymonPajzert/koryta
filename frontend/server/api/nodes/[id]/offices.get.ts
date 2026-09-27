import {
  getFirestore,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { approvedRevisionId } from "~~/shared/model";
import {
  indexOffices,
  officeChoices,
  parseOffices,
  type RegionOffice,
  type RegionOffices,
} from "~~/shared/offices";

/** Where the table is, among the assets nitro bundles from `server/assets`. */
const TABLE = "local_government_offices.jsonl";

let table: Promise<Map<string, RegionOffice[]>> | undefined;

/** The table, read once a process: it changes with a deploy, not in between.
 *
 * `getItemRaw` because what the storage hands back depends on where it runs -
 * a Buffer from the file under `nuxt dev`, bytes inlined into the bundle in a
 * build, since nitro inlines a `.jsonl` as binary - and plain `getItem` would
 * also try to parse the text as a single JSON value. A failed read is not
 * kept, so the next request tries again. */
function officeTable(): Promise<Map<string, RegionOffice[]>> {
  table ??= useStorage("assets:server")
    .getItemRaw(TABLE)
    .then((raw) => {
      const text =
        typeof raw === "string"
          ? raw
          : raw instanceof Uint8Array || raw instanceof ArrayBuffer
            ? new TextDecoder().decode(raw)
            : "";
      if (!text) throw new Error(`${TABLE} is missing from the server assets`);
      return indexOffices(parseOffices(text));
    })
    .catch((error) => {
      table = undefined;
      throw error;
    });
  return table;
}

/** The urząd that runs a region, and the place already on the site for it.
 *
 * What the relation dialog asks once a contributor has said somebody worked
 * "in" a region: the answer is never the region, it is the office - so this
 * names it, with the REGON a new place for it would carry, and looks that
 * REGON up among the places so that the second person to be given a post in
 * Wejherowo is filed under the same urząd as the first. For a powiat it names
 * the urzędy of the gminy in it as well - see `officeChoices` - and says for
 * each where a place proposed for it would be seated.
 *
 * Signed in only, like the dialog. Not cached: a place proposed a minute ago
 * has to be found now, or the next contributor proposes it again.
 */
export default defineEventHandler(async (event): Promise<RegionOffices> => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const region = await db.collection("nodes").doc(id).get();
  const data = region.data();
  if (!region.exists || data?.type !== "region") {
    throw createError({ statusCode: 404, message: "Nie ma takiego regionu." });
  }

  const teryt = typeof data.teryt === "string" ? data.teryt : "";
  const choices = officeChoices(await officeTable(), teryt);
  if (choices.length === 0) return { offices: [] };

  // The region's own offices are seated in it, so only the codes a powiat's
  // list reaches beyond it - and the gmina of a town's half - are looked up.
  const codes = new Set(choices.map(({ office }) => office.teryt));
  codes.delete(teryt);
  const [places, regions] = await Promise.all([
    placesByRegon(
      db,
      choices.map(({ office }) => office.regon),
    ),
    regionsByTeryt(db, [...codes]),
  ]);

  return {
    offices: choices.map(({ office, gmina }) => ({
      ...office,
      node: places.get(office.regon) ?? null,
      gmina,
      // Most gminy have no node, and a place seated nowhere is found by no
      // region filter - the powiat around it is the nearest thing there is.
      seatId: regions.get(office.teryt) ?? id,
    })),
  };
});

/** Firestore's ceiling for the values of one `in`. */
const IN_LIMIT = 30;

function slices<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += IN_LIMIT) {
    result.push(values.slice(i, i + IN_LIMIT));
  }
  return result;
}

/** The place on the site for each REGON, where there is one a post can be
 * recorded against. */
async function placesByRegon(
  db: Firestore,
  regons: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const candidates: { id: string; place: DocumentData }[] = [];
  for (const slice of slices(regons)) {
    const snapshot = await db
      .collection("nodes")
      .where("regonNumber", "in", slice)
      .get();
    for (const doc of snapshot.docs) {
      const place = doc.data();
      // A removed page, or a duplicate folded into another, is not somewhere
      // to record a post - the merge left the survivor carrying the same REGON.
      if (place.type !== "place" || place.deleted === true) continue;
      candidates.push({ id: doc.id, place });
    }
  }

  // A proposal nobody has looked at yet is somewhere to record a post: it is
  // what the last contributor proposed a minute ago, and the post waits in the
  // same queue. One that was turned down is not. Rejecting only marks the
  // revision, so the draft stays - unpublished for good, and every post filed
  // under it with it. Only a place nobody has published or approved can be one
  // of those, so the revisions are read for those alone, and for a region
  // whose urzędy are all live pages that is no query at all.
  const drafts = candidates
    .filter(
      ({ place }) =>
        place.published !== true && !approvedRevisionId(place.revision_id),
    )
    .map(({ id }) => id);
  const standing = await withStandingRevision(db, drafts);

  const byRegon = new Map<string, { id: string; name: string }>();
  for (const { id, place } of candidates) {
    if (drafts.includes(id) && !standing.has(id)) continue;
    const regon = String(place.regonNumber);
    // Two live places with one REGON are a duplicate nobody has merged yet;
    // the published one is the one a reader would find.
    if (byRegon.has(regon) && place.published !== true) continue;
    byRegon.set(regon, { id, name: String(place.name ?? "") });
  }
  return byRegon;
}

/** Which of these nodes have a revision nobody has turned down - one still
 * waiting for a reviewer, or one approved. */
async function withStandingRevision(
  db: Firestore,
  nodeIds: string[],
): Promise<Set<string>> {
  const standing = new Set<string>();
  for (const slice of slices(nodeIds)) {
    const snapshot = await db
      .collection("revisions")
      .where("node_id", "in", slice)
      .get();
    for (const doc of snapshot.docs) {
      const revision = doc.data();
      if (revision.status !== "rejected") {
        standing.add(String(revision.node_id));
      }
    }
  }
  return standing;
}

/** The region node for each TERYT code, where the site has one. */
async function regionsByTeryt(
  db: Firestore,
  codes: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const slice of slices(codes)) {
    const snapshot = await db
      .collection("nodes")
      .where("teryt", "in", slice)
      .get();
    for (const doc of snapshot.docs) {
      const node = doc.data();
      if (node.type !== "region" || node.deleted === true) continue;
      const code = String(node.teryt);
      if (found.has(code) && node.published !== true) continue;
      found.set(code, doc.id);
    }
  }
  return found;
}
