import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { resolveEdgeEndpoints } from "~~/server/utils/edgePublication";
import {
  edgeScanQuery,
  scanEdges,
  type ScannedEdges,
} from "~~/server/utils/edgeScan";
import type { EdgeType } from "~~/shared/model";

export type UnpublishedEdgeRow = {
  id: string;
  type: EdgeType;
  name: string | null;
  sourceId: string;
  sourceName: string | null;
  targetId: string;
  targetName: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type UnpublishedEdges = ScannedEdges<UnpublishedEdgeRow>;

/** Relations that are ready to go live: not published themselves, but with
 * published pages at both ends.
 *
 * This is the queue the publish rule creates. An edge added next to a draft
 * cannot be published, so it waits; the moment somebody publishes that draft
 * the edge becomes eligible and nothing else would ever tell a reviewer that
 * it had.
 */
export default defineEventHandler(async (event): Promise<UnpublishedEdges> => {
  const query = await getValidatedQuery(event, (q) => edgeScanQuery.parse(q));
  await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");

  // Firestore cannot join, so "unpublished edge between two published nodes" is
  // a scan plus a lookup - see `scanEdges`, which is also what bounds it.
  const { rows, nextCursor, scanned, truncated } =
    await scanEdges<UnpublishedEdgeRow>(
      db,
      {
        field: "published",
        value: false,
        limit: query.limit,
        cursor: query.cursor,
      },
      async (batch) => {
        const endpoints = await resolveEdgeEndpoints(
          db,
          batch.filter((edge) => edge.source && edge.target),
        );

        return (edge) => {
          if (edge.deleted === true || !edge.source || !edge.target)
            return null;

          const state = endpoints.get(edge.id);
          if (state?.publishable !== true) return null;
          return {
            id: edge.id,
            type: edge.type,
            name: typeof edge.name === "string" && edge.name ? edge.name : null,
            sourceId: edge.source,
            sourceName: state.sourceName,
            targetId: edge.target,
            targetName: state.targetName,
            start_date: edge.start_date ?? null,
            end_date: edge.end_date ?? null,
          };
        };
      },
    );

  return { edges: rows, nextCursor, scanned, truncated };
});
