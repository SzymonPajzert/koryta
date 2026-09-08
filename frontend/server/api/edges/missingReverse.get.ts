import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { resolveEdgeEndpoints } from "~~/server/utils/edgePublication";
import {
  edgeScanQuery,
  scanEdges,
  type ScannedEdges,
} from "~~/server/utils/edgeScan";
import { relationNeedsReverse } from "~~/shared/relations";

export type MissingReverseRow = {
  id: string;
  /** What the relation says read source -> target. Never blank: a relation
   * with no word at all reads the same from both ends and is not in this
   * queue. */
  name: string;
  sourceId: string;
  sourceName: string | null;
  targetId: string;
  targetName: string | null;
  content: string | null;
  /** Whether the relation is on the public site already, which is what decides
   * how urgent the row is: a published one is printing the wrong word at
   * somebody right now. */
  published: boolean;
};

export type MissingReverseEdges = ScannedEdges<MissingReverseRow>;

/** The relations that say what they are in one direction only.
 *
 * Every `connection` written before `Edge.reverse_name` existed is one of
 * these, and each of them prints its single word on both people's pages: Anna
 * is Jan's "żona" and, on her page, so is he. Nothing else would ever tell a
 * reviewer which relations are in that state, because from either page alone
 * the row looks perfectly ordinary.
 *
 * A scan, over `scanEdges`: Firestore cannot be asked for a field that is
 * absent - a missing field matches no filter, `== null` included - so the only
 * query the index can serve is every `connection` there is, and the rest is
 * done here.
 *
 * Admin-only, like the other edge queues. What comes back is a work list, not
 * a view of the site.
 */
export default defineEventHandler(
  async (event): Promise<MissingReverseEdges> => {
    const query = await getValidatedQuery(event, (q) => edgeScanQuery.parse(q));
    await requireAdmin(event);

    const db = getFirestore(getApp(), "koryta-pl");

    const { rows, nextCursor, scanned, truncated } =
      await scanEdges<MissingReverseRow>(
        db,
        {
          field: "type",
          value: "connection",
          limit: query.limit,
          cursor: query.cursor,
        },
        async (batch) => {
          const incomplete = batch.filter(
            (edge) =>
              edge.deleted !== true &&
              !!edge.source &&
              !!edge.target &&
              relationNeedsReverse(edge),
          );
          const endpoints = await resolveEdgeEndpoints(db, incomplete);
          const wanted = new Set(incomplete.map((edge) => edge.id));

          return (edge) => {
            if (!wanted.has(edge.id)) return null;
            const state = endpoints.get(edge.id);
            return {
              id: edge.id,
              name: edge.name!,
              sourceId: edge.source,
              sourceName: state?.sourceName ?? null,
              targetId: edge.target,
              targetName: state?.targetName ?? null,
              content: edge.content || null,
              published: edge.published === true,
            };
          };
        },
      );

    return { edges: rows, nextCursor, scanned, truncated };
  },
);
