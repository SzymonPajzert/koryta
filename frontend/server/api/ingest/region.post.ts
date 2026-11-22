import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { sameStoredValue } from "~~/server/utils/revisions";
import { regionRequestSchema } from "#shared/api";
import { isValidNip, isValidRegon } from "#shared/identifiers";
import {
  indexOffices,
  isOfficeName,
  officesOn,
  type RegionOffice,
} from "#shared/offices";

/** Firestore's ceiling for the writes of one batch. */
const BATCH_LIMIT = 500;

/** How many of the regions, rows or names an answer counts it also names. */
const NAMED = 20;

/** Put each region's urzędy on its node, from the LocalGovernmentOffices table.
 *
 * `koryta_uploader --type region` sends the whole table, and every region node
 * gets the rows the relation dialog answers it with (`officesOn`): its own
 * urząd, a town's or the villages' half of a gmina the gmina's, a powiat its
 * gminy's as well. They are kept on the nodes rather than shipped with the
 * site (decision on 2026-11-22). Only a node whose rows changed is written; a
 * region the table has no row for keeps what it has, and is counted.
 *
 * A row whose REGON or NIP fails its check digit is left out, since a place
 * proposed from it would be refused as well. A name `isOfficeName` does not
 * know is counted: the person page would show that urząd without its „Urząd"
 * chip.
 *
 * The same gate as the other ingests. No revision: the urzędy are the
 * register's, not a claim anybody argues about, and `offices` is one of the
 * fields a revision leaves alone (INTERNAL_FIELDS).
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
  const unnamed = accepted
    .filter((office) => !isOfficeName(office.name))
    .map((office) => `${office.teryt} ${office.name}`);
  const index = indexOffices(accepted);

  const db = getFirestore(getApp(), "koryta-pl");
  const regions = await db
    .collection("nodes")
    .where("type", "==", "region")
    .select("teryt", "offices", "deleted")
    .get();

  let updated = 0;
  let unchanged = 0;
  const without: string[] = [];
  let batch = db.batch();
  let pending = 0;
  for (const doc of regions.docs) {
    const node = doc.data();
    if (node.deleted === true) continue;
    const teryt = typeof node.teryt === "string" ? node.teryt : "";
    const offices = teryt ? officesOn(index, teryt) : [];
    if (offices.length === 0) {
      without.push(teryt || doc.id);
      continue;
    }
    if (sameStoredValue(node.offices, offices)) {
      unchanged++;
      continue;
    }
    batch.update(doc.ref, { offices });
    updated++;
    pending++;
    if (pending === BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  return {
    rows: body.offices.length,
    regions: regions.size,
    updated,
    unchanged,
    without: { count: without.length, named: without.slice(0, NAMED) },
    refused: { count: refused.length, named: refused.slice(0, NAMED) },
    unnamed: { count: unnamed.length, named: unnamed.slice(0, NAMED) },
  };
});
