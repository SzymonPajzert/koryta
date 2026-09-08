import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { requireAdmin } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  revisionChangesNothing,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { EDGE_PUBLISH_CHUNK } from "~~/server/utils/edgePublication";

const bodyValidator = z.object({
  /** Capped at the batch size a single commit can carry, so a request either
   * fits or is refused rather than being silently half-applied - the same cap
   * /api/edges/publish takes its selection in. */
  updates: z
    .array(
      z.object({
        edge_id: z.string().min(1),
        reverse_name: z.string().min(1),
      }),
    )
    .min(1)
    .max(EDGE_PUBLISH_CHUNK),
});

export type ReverseNamesWritten = {
  /** The relations this actually changed. */
  updated: string[];
  /** Relations that already said exactly this, so nothing was written. */
  unchanged: string[];
  /** Ids that are not `connection` relations, or are gone. Reported rather than
   * refused: the queue is read a page at a time and somebody else deleting a
   * row between the read and the save is ordinary, not an error worth losing
   * the other ninety-nine writes over. */
  skipped: { edge_id: string; reason: string }[];
};

/** Fills in the missing half of a batch of personal relations.
 *
 * The queue behind /admin/relacje, in one round trip per screenful. Doing it
 * through `/api/edges/update` one row at a time would be a request and a
 * transaction each, and this queue starts out as every `connection` the site
 * has ever stored - see `Edge.reverse_name`.
 *
 * Admin-only and applied at once, which is the same verdict `/api/edges/update`
 * reaches for an admin: the write is an approved revision carrying who made it,
 * `published` is passed through untouched so completing a live relation cannot
 * take it off the site, and a reviewer reading the history afterwards sees
 * exactly what the single-row path would have written.
 *
 * Only `reverse_name` is settable here. Everything else a relation says has a
 * form of its own, and a bulk endpoint that could rewrite a whole edge is a
 * much larger thing to hand a table of checkboxes.
 */
export default defineEventHandler(
  async (event): Promise<ReverseNamesWritten> => {
    const body = await readValidatedBody(event, (raw) =>
      bodyValidator.parse(raw),
    );

    const user = await requireAdmin(event);
    const db = getFirestore(getApp(), "koryta-pl");

    // Last write wins on a duplicated id, rather than two revisions of the same
    // document racing inside one batch.
    const wanted = new Map(
      body.updates.map((update) => [update.edge_id, update.reverse_name]),
    );
    const ids = Array.from(wanted.keys());
    const refs = ids.map((id) => db.collection("edges").doc(id));
    const snaps = await db.getAll(...refs);

    const updated: string[] = [];
    const unchanged: string[] = [];
    const skipped: { edge_id: string; reason: string }[] = [];
    const batch = db.batch();

    for (const snap of snaps) {
      const reverse_name = wanted.get(snap.id)!;
      if (!snap.exists) {
        skipped.push({
          edge_id: snap.id,
          reason: "Nie ma takiego powiązania.",
        });
        continue;
      }

      const stored = snap.data() ?? {};
      if (stored.deleted === true) {
        skipped.push({ edge_id: snap.id, reason: "Powiązanie usunięte." });
        continue;
      }
      // The word only means anything on a person-to-person tie, and letting it
      // land on an `employed` would put a second job title on the document that
      // nothing reads and every diff would then carry.
      if (stored.type !== "connection") {
        skipped.push({
          edge_id: snap.id,
          reason: "To nie jest powiązanie osobiste.",
        });
        continue;
      }

      // A revision is a complete snapshot, so everything the relation already
      // says has to come off the stored document or the write would delete it.
      const data = { ...withoutInternalFields(stored), reverse_name };
      const published = stored.published === true;

      if (
        revisionChangesNothing(snap.ref, data, {
          stored,
          published,
          approve: true,
        })
      ) {
        unchanged.push(snap.id);
        continue;
      }

      createRevisionTransaction(db, batch, user, snap.ref, data, {
        stored,
        approve: true,
        // Passed through rather than decided here: completing a live relation
        // must not take it off the site, and completing a draft must not
        // publish it.
        published,
      });
      updated.push(snap.id);
    }

    if (updated.length > 0) {
      await batch.commit();
      // The entity and graph endpoints are cached per handler for six hours, so
      // the corrected labels would otherwise not reach the pages they are about
      // until tomorrow. Same clear as /api/edges/update.
      await useStorage("cache").clear("nitro:handlers");
    }

    return { updated, unchanged, skipped };
  },
);
