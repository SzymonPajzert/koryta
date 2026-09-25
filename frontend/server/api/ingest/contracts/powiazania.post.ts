import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { settledBulkWriter, throwIfFailed } from "~~/server/utils/bulkWrites";
import { purgeContractLinkCaches } from "~~/server/utils/cache";
import {
  contractLinkPayloadSchema,
  readContractLinkSummaryInputs,
  toContractLinkDoc,
  writeContractLinkSummary,
  type ContractLinkSummaryInput,
} from "~~/server/utils/contractLinks";
import {
  CONTRACT_LINK_COLLECTION,
  contractLinkDocumentId,
  type ContractLinkSummary,
} from "~~/shared/contractLinks";

/** The pipeline's way in for the findings (`koryta_uploader --type
 * contract-link`): a batch of them, each stored whole at `cru_<nip>`.
 *
 * `.set()` rather than a merge, so a re-run replaces a finding outright - a
 * merge would keep a researched tie the new run dropped, or a `public` the
 * owner has since taken back in the pipeline.
 *
 * The last call of a run carries `final.keep`, every id the run wrote. The
 * findings not among them are deleted - a finding the review has since
 * rejected must stop being served, not linger - and `stats/powiazania` is
 * recomputed over what is left.
 *
 * `rank` has to be unique across the collection: it is the list's cursor and
 * what `ukryte_<rank>` resolves to, and two findings on one rank would page
 * past each other. A batch is checked on the way in; the whole run, once it is
 * complete, by the final call - which answers 409 when two findings share a
 * rank, after writing everything else, so the run fails where it can be seen.
 *
 * A write or a delete that did not go through is a 500, and the final call
 * neither prunes after a failed write nor recounts after a failed delete: the
 * uploader prunes only after every batch answered 200, and a 200 over a
 * finding that was never written would have it prune the rest regardless.
 */

const requestSchema = z.object({
  links: z
    .array(contractLinkPayloadSchema)
    .max(100)
    .default([])
    .superRefine((links, context) => {
      const seen = new Set<number>();
      for (const [index, link] of links.entries()) {
        if (seen.has(link.rank)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "rank"],
            message: `rank ${link.rank} appears twice in this batch`,
          });
        }
        seen.add(link.rank);
      }
    }),
  final: z
    .object({ keep: z.array(z.string().regex(/^cru_\d{10}$/)).max(20000) })
    .optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    requestSchema.parse(body),
  );
  requireDatascience(await getUser(event));

  const db = getFirestore(getApp(), "koryta-pl");
  const collection = db.collection(CONTRACT_LINK_COLLECTION);
  const now = new Date().toISOString();

  // Purged however the call ends: a failed batch may still have written the
  // rest, and the anonymous list is cached, as is the page that embeds it - a
  // finding that has just been gated must stop being named there now, not in
  // a minute.
  try {
    const writer = settledBulkWriter(db);
    for (const payload of body.links) {
      writer.set(
        collection.doc(contractLinkDocumentId(payload.nip)),
        toContractLinkDoc(payload, now),
      );
    }
    const written = await writer.close();
    throwIfFailed(written.failed, "findings were not written");

    let deleted = 0;
    let summary: ContractLinkSummary | null = null;
    const sharedRanks = new Set<number>();
    if (body.final) {
      const keep = new Set([
        ...body.final.keep,
        ...body.links.map((link) => contractLinkDocumentId(link.nip)),
      ]);
      const all = await readContractLinkSummaryInputs(db, ["rank"]);
      const pruner = settledBulkWriter(db);
      const kept: ContractLinkSummaryInput[] = [];
      const ranks = new Set<number>();
      for (const doc of all) {
        if (keep.has(doc.id)) {
          const data = doc.data() as ContractLinkSummaryInput & {
            rank: number;
          };
          kept.push(data);
          if (ranks.has(data.rank)) sharedRanks.add(data.rank);
          ranks.add(data.rank);
        } else {
          pruner.delete(doc.ref);
        }
      }
      const pruned = await pruner.close();
      throwIfFailed(pruned.failed, "stale findings were not deleted");
      deleted = pruned.done;
      summary = await writeContractLinkSummary(db, kept, now);
    }

    if (sharedRanks.size) {
      throw createError({
        statusCode: 409,
        message: `Findings share a rank: ${[...sharedRanks].sort((a, b) => a - b).join(", ")}.`,
      });
    }
    return { written: written.done, deleted, summary };
  } finally {
    await purgeContractLinkCaches();
  }
});
