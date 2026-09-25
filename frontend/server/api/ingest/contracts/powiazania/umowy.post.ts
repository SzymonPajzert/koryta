import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { settledBulkWriter, throwIfFailed } from "~~/server/utils/bulkWrites";
import { purgeContractLinkCaches } from "~~/server/utils/cache";
import { CONTRACT_LINK_CONTRACT_COLLECTION } from "~~/server/utils/contractLinks";
import {
  cruContractSchema,
  resolveNodeIds,
  toContractDoc,
} from "~~/server/utils/contracts";
import { contractDocumentId } from "~~/shared/contracts";

/** The pipeline's way in for the contracts behind the findings
 * (`koryta_uploader --type contract-link-contract`): the register payloads
 * `/api/ingest/contracts` takes, mapped by the same `toContractDoc` and joined
 * by the same `resolveNodeIds`, but stored in `contractLinkContracts` - which
 * nothing reads but /api/contracts/powiazania/<id>, past its gate
 * (`CONTRACT_LINK_CONTRACT_COLLECTION` says why not `contracts`).
 *
 * So there is no `skipUnlinked`: every contract a finding joins is kept, since
 * a finding's contracts are for the most part the ones no company here touches.
 * Nor are their companies published, as `/api/ingest/contracts` does - a page
 * published because a gated finding's contract reached it would say which
 * firm is behind the gate.
 *
 * The last call of a run carries `final.keep`, every register id (`id_umowy`)
 * the run sent, and the contracts not among them are deleted: a finding the
 * review has since rejected takes its contracts with it. A write or a delete
 * that did not go through is a 500, and a final call whose writes failed
 * prunes nothing.
 */

const requestSchema = z.object({
  contracts: z.array(cruContractSchema).max(500).default([]),
  final: z
    .object({ keep: z.array(z.string().min(1).max(80)).max(50000) })
    .optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    requestSchema.parse(body),
  );
  requireDatascience(await getUser(event));

  const db = getFirestore(getApp(), "koryta-pl");
  const collection = db.collection(CONTRACT_LINK_CONTRACT_COLLECTION);
  const idOf = (sourceId: string) => contractDocumentId("cru", sourceId);

  const docs = body.contracts.map(toContractDoc);
  // The same join the public contracts get, so that a row on the expanded
  // card links to the company page where there is one.
  await resolveNodeIds(db, docs);

  // Purged however the call ends: the anonymous detail of a public finding is
  // cached with its contracts.
  try {
    const writer = settledBulkWriter(db);
    for (const doc of docs) writer.set(collection.doc(idOf(doc.sourceId)), doc);
    const written = await writer.close();
    throwIfFailed(written.failed, "contracts were not written");

    let deleted = 0;
    if (body.final) {
      const keep = new Set(
        [...body.final.keep, ...docs.map((doc) => doc.sourceId)].map(idOf),
      );
      const all = await collection.select().get();
      const pruner = settledBulkWriter(db);
      for (const doc of all.docs) {
        if (!keep.has(doc.id)) pruner.delete(doc.ref);
      }
      const pruned = await pruner.close();
      throwIfFailed(pruned.failed, "stale contracts were not deleted");
      deleted = pruned.done;
    }

    return {
      written: written.done,
      deleted,
      linked: docs.filter((doc) => doc.linked).length,
    };
  } finally {
    await purgeContractLinkCaches();
  }
});
