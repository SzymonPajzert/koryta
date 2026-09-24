import { z } from "zod";
import {
  getFirestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { describeRevisions } from "~~/server/utils/revisionQueue";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import type { Proposal } from "~~/shared/proposals";

const queryValidator = z.object({ nodeId: z.string().min(1) });

export type NodeRevisionHistory = {
  /** Newest first. */
  revisions: Proposal[];
  approvedRevisionId: string | null;
  published: boolean;
  /** Whether the node exists at all - a suggestion for a node that was never
   * created has revisions but nothing to approve them onto. */
  exists: boolean;
};

/**
 * Every revision of one entry, as rows a reviewer can read: who filed it, what
 * it changes, where it stands.
 *
 * `/api/revisions/byNode` answers the same question with raw documents, which
 * is what the side-by-side table on `/admin/rewizje/[id]` draws from and all a
 * table of snapshots needs. A list that says "Anna Nowak changed the
 * description" needs the join `describeRevisions` already does for the queue:
 * the author resolved to a name, the status reconciled with what the entry is
 * actually serving (so an overtaken approval reads `Zastąpiona`, not
 * `Oczekuje`), and the change as a diff against the approved version. Doing it
 * here keeps the history and the queue from ever describing one revision two
 * ways.
 *
 * Any signed-in reader may ask - the revisions themselves are world-readable in
 * the rules, and the entry's page links contributors here - but only an admin
 * gets names and emails back, on the same terms as `/api/users/lookup`.
 *
 * Both spellings of the target field are queried, as `byNode` does: the older
 * documents say `nodeId`, and a history that dropped them would start partway
 * through. Sorted in memory rather than by `orderBy`, which would silently drop
 * a revision with no `update_time`; one entry has a handful of revisions (eight
 * at most in the 2026-09-23 export), so there is nothing to page.
 */
export default defineEventHandler(
  async (event): Promise<NodeRevisionHistory> => {
    const caller = await getUser(event);
    const { nodeId } = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    const db = getFirestore("koryta-pl");

    // Uids, emails and display names for an admin. Never cached, never shared.
    setResponseHeader(event, "Cache-Control", "private, no-store");

    const [byUnderscore, byCamel, node] = await Promise.all([
      db.collection("revisions").where("node_id", "==", nodeId).get(),
      db.collection("revisions").where("nodeId", "==", nodeId).get(),
      db.collection("nodes").doc(nodeId).get(),
    ]);

    const docs = new Map<string, QueryDocumentSnapshot>();
    for (const doc of [...byUnderscore.docs, ...byCamel.docs]) {
      if (!docs.has(doc.id)) docs.set(doc.id, doc);
    }

    const revisions = await describeRevisions(db, [...docs.values()], {
      withAuthors: caller.admin === true,
      allChanges: true,
    });

    const nodeData = node.data() ?? {};
    return {
      revisions: revisions.sort(
        (a, b) => timeOf(b.updateTime) - timeOf(a.updateTime),
      ),
      approvedRevisionId: approvedRevisionId(nodeData.revision_id) ?? null,
      published: pageIsPublic(nodeData),
      exists: node.exists,
    };
  },
);

/** A revision with no time sorts last: it is the oldest thing there is. */
function timeOf(iso: string | null): number {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time) ? -Infinity : time;
}
