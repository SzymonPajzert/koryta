import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  cruContractSchema,
  resolveNodeIds,
  toContractDoc,
} from "~~/server/utils/contracts";
import { contractDocumentId } from "~~/shared/contracts";

/** The pipeline's way in: a batch of CRU contracts, mapped and stored.
 *
 * Never cached and never public - `requireDatascience` is the same gate every
 * other /api/ingest route uses. A plain `defineEventHandler` because a POST
 * has nothing to cache.
 *
 * Idempotent by construction: the document id is derived from the register and
 * its own contract id, so re-running the pipeline lands on the document it
 * already wrote. `.set()` and not `.set(..., {merge:true})` - a merge would
 * leave a corrected value beside the `valueSort` computed from the old one,
 * and every money-sorted view orders on `valueSort`.
 */

const requestSchema = z.object({
  contracts: z.array(cruContractSchema).max(500),
  /** Store only the contracts with at least one end on a company this site
   * describes.
   *
   * The register's first six-week window is 149 683 contracts and 13 333 of
   * them touch a company here, so the default would ship 136 350 rows nobody
   * can join to anything - a mirror of somebody else's register, and 136 350
   * documents of index storage. With this set the handler resolves the join
   * first and writes only what resolved, which is how the pipeline makes that
   * decision without holding a copy of the site's NIP list.
   *
   * Default false: /umowy's „wszystkie" scope is the whole register on
   * purpose, and defaulting to our slice would silently rename it. Whoever
   * turns this on is choosing to publish a page about our 8.91%.
   */
  skipUnlinked: z.boolean().default(false),
});

/** Publish the company pages a stored contract points at.
 *
 * The owner's rule for this feature is that a submitted contract is shown „same
 * for the company that was the recipient of it", and the register is what makes
 * that safe: a contract is a public record that this institution exists and
 * took public money, which is a stronger warrant than the one most pages are
 * published on.
 *
 * Small in practice and not in principle. 823 of the 825 companies the first
 * window touches are already published, so this moves two pages today - but
 * every later ingest reaches companies added since, and without it a contract
 * would link to a page a logged out reader gets a 404 for.
 *
 * Three kinds of draft are left alone, because each is unpublished on purpose
 * and a register entry says nothing about any of them: a `deleted` tombstone, a
 * page `merged_into` another, and one flagged `needs_split` as two people or
 * two institutions nobody has separated. `pageIsPublic` already refuses the
 * first; the other two are checked here.
 *
 * No revision is written, for the reason `create-region-nodes.ts` gives: this
 * is not a claim anybody argues about, and a revision per company would bury
 * the queue reviewers actually read. `published` is a node-owned field, so it
 * is set with `update` rather than through a revision that would replace the
 * document.
 */
async function publishRecipients(
  db: FirebaseFirestore.Firestore,
  contracts: { nodeIds: string[] }[],
): Promise<number> {
  const nodeIds = Array.from(
    new Set(contracts.flatMap((contract) => contract.nodeIds)),
  );
  if (nodeIds.length === 0) return 0;

  const toPublish: string[] = [];
  for (let at = 0; at < nodeIds.length; at += 100) {
    const refs = nodeIds
      .slice(at, at + 100)
      .map((id) => db.collection("nodes").doc(id));
    for (const snap of await db.getAll(...refs, {
      fieldMask: ["published", "deleted", "merged_into", "needs_split"],
    })) {
      if (!snap.exists) continue;
      const node = snap.data() ?? {};
      if (node.published === true) continue;
      if (node.deleted === true) continue;
      if (node.merged_into) continue;
      if (node.needs_split) continue;
      toPublish.push(snap.id);
    }
  }
  if (toPublish.length === 0) return 0;

  const writer = db.bulkWriter();
  for (const id of toPublish) {
    // `stats.isApproved` mirrors `published` and is what /api/nodes filters
    // list views on, so a page published without it is live on its own url and
    // absent from every listing. `onNodeWritten` maintains it, but functions
    // deploy by hand here, so it is set alongside rather than relied on.
    writer.update(db.collection("nodes").doc(id), {
      published: true,
      "stats.isApproved": true,
    });
  }
  await writer.close();

  // The public list of contracts is cached for 60 s and the company pages are
  // cached for six hours; a page that has just become reachable should not
  // 404 for the rest of the afternoon.
  await useStorage("cache").clear("nitro:handlers");

  return toPublish.length;
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    requestSchema.parse(body),
  );
  requireDatascience(await getUser(event));

  const db = getFirestore(getApp(), "koryta-pl");

  const docs = body.contracts.map(toContractDoc);
  // One pass over the batch rather than per contract: a batch of 500 carries
  // at most ~1 000 identifiers, which is 34 `in` queries, against 500 point
  // lookups.
  const summary = await resolveNodeIds(db, docs);

  const kept = body.skipUnlinked ? docs.filter((doc) => doc.linked) : docs;

  const writer = db.bulkWriter();
  for (const doc of kept) {
    writer.set(
      db.collection("contracts").doc(contractDocumentId("cru", doc.sourceId)),
      doc,
    );
  }
  await writer.close();

  const published = await publishRecipients(db, kept);

  return {
    written: kept.length,
    skipped: docs.length - kept.length,
    published,
    linked: kept.filter((doc) => doc.linked).length,
    bothLinked: kept.filter((doc) => doc.bothLinked).length,
    // Which institutions the site still lacks, in the pipeline's own join key.
    // The measured recall of the NIP join is 8.91% of contracts and 825 of the
    // register's 12 858 institutions, so this list is the backlog, and the
    // pipeline is the only thing positioned to read it.
    unresolvedNips: summary.unresolvedNips,
  };
});
