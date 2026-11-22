import {
  getFirestore,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  sameStoredValue,
  withSeededNodeStats,
} from "~~/server/utils/revisions";
import { regionRequestSchema } from "#shared/api";
import { isValidNip, isValidRegon } from "#shared/identifiers";
import {
  indexOffices,
  isOfficeName,
  officesFor,
  type RegionOffice,
} from "#shared/offices";

/** Firestore's ceiling for the writes of one batch. */
const BATCH_LIMIT = 500;

/** How many documents one `getAll` asks for. */
const GET_ALL_LIMIT = 300;

/** How many of the regions, rows or names an answer counts it also names. */
const NAMED = 20;

type RegionPayload = {
  node_id: string;
  name: string;
  teryt: string;
  edge?: { source: string };
  replaces?: string[];
};

/** A region node as this reads it, and as it stands once this has written. */
type StoredRegion = {
  id: string;
  ref: DocumentReference;
  teryt: string;
  name: unknown;
  offices: unknown;
  deleted: boolean;
};

const named = (items: string[]) => ({
  count: items.length,
  named: items.slice(0, NAMED),
});

/** Writes in the batches Firestore takes, each committed as it fills. */
function batchWriter(db: Firestore) {
  let batch = db.batch();
  let pending = 0;
  const added = async () => {
    pending++;
    if (pending < BATCH_LIMIT) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };
  return {
    async set(ref: DocumentReference, data: Record<string, unknown>) {
      batch.set(ref, data);
      await added();
    },
    async update(ref: DocumentReference, data: Record<string, unknown>) {
      batch.update(ref, data);
      await added();
    },
    async flush() {
      if (pending === 0) return;
      await batch.commit();
      batch = db.batch();
      pending = 0;
    },
  };
}
type BatchWriter = ReturnType<typeof batchWriter>;

/** Keep the site's regions in step with TERYT, and put on each the urzędy the
 * relation dialog answers it with.
 *
 * `koryta_uploader --type region` sends `RegionPayloads` and the
 * LocalGovernmentOffices table, either or both:
 *
 * - A region the site lacks is created, with the `owns` edge from the region
 *   above, as scripts/migrate/create-region-nodes.ts did. Every gmina is one
 *   since 2026-11-22: a gmina reached only through its powiat made a second
 *   tier of them (decision on 2026-11-22). A region already there is matched
 *   by its TERYT code and kept as it is, except a gmina whose name is the one
 *   its payload `replaces` - one another gmina of its powiat shares, such as
 *   two "Gmina Wejherowo" - which takes the name with its kind.
 * - Every region node gets the urząd that runs it (`officesFor`): its own,
 *   or for a town's or the villages' half of a gmina the gmina's. They are
 *   kept on the nodes rather than shipped with the site (decision on
 *   2026-11-22). Only a node whose rows changed is written; a region the
 *   table has no row for keeps what it has, and is counted. A row whose
 *   REGON or NIP fails its check digit is left out, since a place proposed
 *   from it would be refused, and a name `isOfficeName` does not know is
 *   counted: the person page would show that urząd without its „Urząd"
 *   chip.
 *
 * The same gate as the other ingests. No revision: a region and its urzędy
 * are TERYT's and the register's, not a claim anybody argues about, and
 * `offices` is one of the fields a revision leaves alone (INTERNAL_FIELDS).
 */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const body = await readValidatedBody(event, (body) =>
    regionRequestSchema.parse(body),
  );

  const accepted: RegionOffice[] = [];
  const refused: string[] = [];
  for (const office of body.offices) {
    const valid =
      isValidRegon(office.regon) &&
      (office.nip === null || isValidNip(office.nip));
    if (valid) accepted.push(office);
    else refused.push(`${office.teryt} ${office.name}`);
  }
  const index = indexOffices(accepted);

  const db = getFirestore(getApp(), "koryta-pl");
  const snapshot = await db
    .collection("nodes")
    .where("type", "==", "region")
    .select("teryt", "name", "offices", "deleted")
    .get();
  const stored: StoredRegion[] = snapshot.docs.map((doc) => {
    const node = doc.data();
    return {
      id: doc.id,
      ref: doc.ref,
      teryt: typeof node.teryt === "string" ? node.teryt : "",
      name: node.name,
      offices: node.offices,
      deleted: node.deleted === true,
    };
  });

  const writer = batchWriter(db);
  const regions =
    body.regions.length > 0
      ? await placeRegions(db, writer, body.regions, stored, index)
      : undefined;
  const offices =
    body.offices.length > 0
      ? await placeOffices(writer, stored, index)
      : undefined;
  await writer.flush();

  return {
    regions,
    offices: offices && {
      rows: body.offices.length,
      ...offices,
      refused: named(refused),
      unnamed: named(
        accepted
          .filter((office) => !isOfficeName(office.name))
          .map((office) => `${office.teryt} ${office.name}`),
      ),
    },
  };
});

/** Create the regions the site lacks, and rename the gminy whose shared name
 * their payload replaces. A region created here carries its urzędy already,
 * and joins `stored`. */
async function placeRegions(
  db: Firestore,
  writer: BatchWriter,
  payloads: RegionPayload[],
  stored: StoredRegion[],
  index: Map<string, RegionOffice[]>,
) {
  const byTeryt = new Map<string, StoredRegion>();
  for (const region of stored) {
    if (!region.teryt) continue;
    const seen = byTeryt.get(region.teryt);
    if (!seen || (seen.deleted && !region.deleted)) {
      byTeryt.set(region.teryt, region);
    }
  }

  // Parents first: a gmina's powiat may be created by this same upload.
  const ordered = [...payloads].sort((a, b) => a.teryt.length - b.teryt.length);
  const occupied = await existingNodeIds(
    db,
    ordered.filter((p) => !byTeryt.has(p.teryt)).map((p) => p.node_id),
  );

  const created: string[] = [];
  const renamed: string[] = [];
  const removed: string[] = [];
  const taken: string[] = [];
  const orphaned: string[] = [];
  let unchanged = 0;
  let edges = 0;
  for (const payload of ordered) {
    const region = byTeryt.get(payload.teryt);
    if (region?.deleted) {
      // Taken down on purpose; recreating it is somebody's decision.
      removed.push(payload.teryt);
      continue;
    }
    if (region) {
      const name = typeof region.name === "string" ? region.name : "";
      if (name !== payload.name && payload.replaces?.includes(name)) {
        await writer.update(region.ref, { name: payload.name });
        region.name = payload.name;
        renamed.push(`${payload.teryt} ${payload.name}`);
      } else {
        unchanged++;
      }
      continue;
    }
    if (occupied.has(payload.node_id)) {
      // Something else is filed under the id; it is not overwritten.
      taken.push(payload.node_id);
      continue;
    }

    const ref = db.collection("nodes").doc(payload.node_id);
    const offices = officesFor(index, payload.teryt);
    await writer.set(
      ref,
      withSeededNodeStats({
        name: payload.name,
        type: "region",
        teryt: payload.teryt,
        published: true,
        ...(offices.length > 0 ? { offices } : {}),
      }),
    );
    const placed: StoredRegion = {
      id: ref.id,
      ref,
      teryt: payload.teryt,
      name: payload.name,
      offices: offices.length > 0 ? offices : undefined,
      deleted: false,
    };
    stored.push(placed);
    byTeryt.set(payload.teryt, placed);
    created.push(`${payload.teryt} ${payload.name}`);

    if (!payload.edge) continue;
    const parent = byTeryt.get(payload.edge.source.slice("teryt".length));
    if (!parent || parent.deleted) {
      orphaned.push(payload.teryt);
      continue;
    }
    await writer.set(
      db.collection("edges").doc(`edge_${parent.id}_${ref.id}_owns`),
      { source: parent.id, target: ref.id, type: "owns", published: true },
    );
    edges++;
  }

  return {
    sent: payloads.length,
    created: named(created),
    renamed: named(renamed),
    unchanged,
    edges,
    orphaned: named(orphaned),
    removed: named(removed),
    taken: named(taken),
  };
}

/** Which of these node ids a document already has. */
async function existingNodeIds(
  db: Firestore,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += GET_ALL_LIMIT) {
    const refs = ids
      .slice(i, i + GET_ALL_LIMIT)
      .map((id) => db.collection("nodes").doc(id));
    for (const doc of await db.getAll(...refs)) {
      if (doc.exists) found.add(doc.id);
    }
  }
  return found;
}

/** Give every region node the rows the dialog answers it with. */
async function placeOffices(
  writer: BatchWriter,
  stored: StoredRegion[],
  index: Map<string, RegionOffice[]>,
) {
  let updated = 0;
  let unchanged = 0;
  const without: string[] = [];
  for (const region of stored) {
    if (region.deleted) continue;
    const offices = region.teryt ? officesFor(index, region.teryt) : [];
    if (offices.length === 0) {
      without.push(region.teryt || region.id);
      continue;
    }
    if (sameStoredValue(region.offices, offices)) {
      unchanged++;
      continue;
    }
    await writer.update(region.ref, { offices });
    region.offices = offices;
    updated++;
  }
  return {
    regions: stored.length,
    updated,
    unchanged,
    without: named(without),
  };
}
