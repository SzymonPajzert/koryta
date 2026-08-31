import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {
  getFirestore,
  FieldValue,
  type Firestore,
} from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { computeEdgeStats } from "./stats";
import { bodyIsPaidPost } from "./companyBodies";
import type { Edge } from "./model";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
}

/**
 * Nodes whose `stats.edges` no longer matches their edges, one document per
 * node, keyed by node id.
 *
 * `onEdgeWritten` used to recompute inline, which is quadratic in a node's
 * out-degree: writing a node's E edges re-read all E of them E times over, plus
 * a `getAll` of every target each pass. Warszawa has 584 edges, so re-ingesting
 * it alone cost around 700,000 reads - the whole of the 30 August spike, which
 * was 6.7M reads against flat user traffic. Marking the node instead is one
 * write and no reads, and the sweep below recomputes it once however many edges
 * moved.
 *
 * Not matched in `firestore.rules`, so it is default-deny to clients; only the
 * Admin SDK in these functions touches it.
 */
const DIRTY_COLLECTION = "edgeStatsDirty";

/** Edge types that carry a region up into the source node's `targetNodeIds`:
 * a seat does it exactly as ownership does. One query rather than two, so the
 * read count does not double. */
const TRANSITIVE_EDGE_TYPES = ["owns", "seat"] as const;

/** Firestore expands a query to disjunctive normal form and rejects more than
 * 30 clauses. */
const MAX_DISJUNCTIONS = 30;

/**
 * Targets per transitive-ownership query.
 *
 * `target in (N values)` AND `type in (M values)` normalises to N*M
 * disjunctions, so this is a hard ceiling rather than a tuning choice - and it
 * is derived rather than written down because the last time it was a literal
 * (30, against two types) every node with more than 15 distinct targets threw
 * INVALID_ARGUMENT. The catch below swallowed it, so `stats.edges` was silently
 * never written for exactly the nodes that matter most: 385 such failures
 * across 85 nodes in the week to 31 August 2026, Warszawa and Krakow among
 * them. Their stats only looked right because the ingest pipeline writes the
 * field too. Adding a third type now narrows the chunk instead of breaking it.
 */
const TARGETS_PER_QUERY = Math.floor(
  MAX_DISJUNCTIONS / TRANSITIVE_EDGE_TYPES.length,
);

/** Nodes one sweep will claim. Bounded so a bulk re-ingest that dirties
 * thousands of nodes drains over several runs instead of hitting the timeout
 * and losing the whole batch's work. */
const SWEEP_BATCH = 500;

/** Recomputes running at once inside a sweep. Each is a handful of sequential
 * round-trips, so a little concurrency is most of the wall-clock win. */
const SWEEP_CONCURRENCY = 10;

/** Firestore's gRPC status codes, for the two we treat as ordinary control
 * flow rather than as failures. */
const NOT_FOUND = 5;
const FAILED_PRECONDITION = 9;

function statusCode(error: unknown): number | undefined {
  return (error as { code?: number } | null)?.code;
}

export const onEdgeWritten = onDocumentWritten(
  {
    document: "edges/{edgeId}",
    database: "koryta-pl",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeSource = before?.exists
      ? (before.data()?.source as string | undefined)
      : undefined;
    const afterSource = after?.exists
      ? (after.data()?.source as string | undefined)
      : undefined;

    // Both ends, not just the current one: re-pointing an edge at a different
    // source leaves the node it came from counting an edge it no longer has.
    const sources = [
      ...new Set([beforeSource, afterSource].filter(Boolean) as string[]),
    ];

    if (sources.length === 0) {
      logger.warn(
        `Could not determine source nodeId for edge doc: ${event.params.edgeId}`,
      );
      return;
    }

    const db = getFirestore("koryta-pl");
    await Promise.all(
      sources.map((sourceId) =>
        db
          .collection(DIRTY_COLLECTION)
          .doc(sourceId)
          .set({ at: FieldValue.serverTimestamp() }),
      ),
    );
  },
);

/**
 * Recalculate and store `stats.edges` for one node.
 *
 * Returns false if the node itself is gone, so the caller drops the marker
 * rather than retrying a node that will never exist again.
 */
export async function recomputeEdgeStats(
  db: Firestore,
  sourceId: string,
): Promise<boolean> {
  // Fetch all edges for the source node to accurately recalculate the metrics
  const edgesSnapshot = await db
    .collection("edges")
    .where("source", "==", sourceId)
    .get();
  const allEdges = edgesSnapshot.docs.map((doc) => doc.data() as Edge);

  const targetIds = [
    ...new Set(allEdges.map((e) => e.target).filter(Boolean)),
  ] as string[];
  const transitiveTargets: Record<string, string[]> = {};
  const publicPlaceIds = new Set<string>();
  const unpaidSeatPlaceIds = new Set<string>();

  if (targetIds.length > 0) {
    // Determine which of the targets are public places, so that experience
    // in non-public places is excluded from the stats.
    const targetNodes = await db.getAll(
      ...targetIds.map((id) => db.collection("nodes").doc(id)),
      // The three fields the loop below reads. Billed the same either way, but
      // a region with 584 targets is a lot of document to ship in to look at
      // three fields of it.
      { fieldMask: ["type", "isPublic", "supervisoryBody"] },
    );
    for (const doc of targetNodes) {
      const node = doc.data();
      if (node?.type !== "place") continue;
      // Confirmed public only - `false` and absent both mean the ownership
      // is unknown, not that it is private. See `Company.isPublic`.
      if (node.isPublic === true) {
        publicPlaceIds.add(doc.id);
      }
      // ...and of those, the ones whose supervisory organ nobody is paid to
      // sit on, so a rada społeczna seat at an SPZOZ is left out too. Read
      // from the same documents this loop already has, so it costs no reads.
      if (!bodyIsPaidPost(node.supervisoryBody)) {
        unpaidSeatPlaceIds.add(doc.id);
      }
    }

    for (let i = 0; i < targetIds.length; i += TARGETS_PER_QUERY) {
      const chunk = targetIds.slice(i, i + TARGETS_PER_QUERY);
      const ownsEdgesSnapshot = await db
        .collection("edges")
        .where("target", "in", chunk)
        .where("type", "in", [...TRANSITIVE_EDGE_TYPES])
        .get();

      for (const doc of ownsEdgesSnapshot.docs) {
        const edge = doc.data() as Edge;
        if (edge.source && edge.target) {
          if (!transitiveTargets[edge.target]) {
            transitiveTargets[edge.target] = [];
          }
          // Ideally we would verify edge.source is a region here.
          // Assuming all 'owns' edges targeting a company are from regions/parent companies.
          // For now, any 'owns' source will be included.
          transitiveTargets[edge.target].push(edge.source);
        }
      }
    }
  }

  const edgeStats = computeEdgeStats(
    allEdges,
    publicPlaceIds,
    transitiveTargets,
    unpaidSeatPlaceIds,
  );

  try {
    await db
      .collection("nodes")
      .doc(sourceId)
      .update({ "stats.edges": edgeStats });
  } catch (error) {
    if (statusCode(error) === NOT_FOUND) {
      logger.warn(
        `Edge stats computed for a node that no longer exists: ${sourceId}`,
      );
      return false;
    }
    throw error;
  }

  return true;
}

export const sweepEdgeStats = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "europe-west1",
    timeoutSeconds: 540,
    memory: "512MiB",
    // One sweep at a time, so two runs cannot claim the same marker and
    // recompute the same node twice.
    maxInstances: 1,
  },
  async () => {
    const db = getFirestore("koryta-pl");

    // Oldest first, so a node dirtied during a long backlog is not starved.
    const pending = await db
      .collection(DIRTY_COLLECTION)
      .orderBy("at")
      .limit(SWEEP_BATCH)
      .get();

    if (pending.empty) return;

    const queue = [...pending.docs];
    let recomputed = 0;
    let rewritten = 0;
    let failed = 0;

    const worker = async () => {
      for (let doc = queue.shift(); doc; doc = queue.shift()) {
        try {
          const nodeExists = await recomputeEdgeStats(db, doc.id);
          try {
            // Drop the marker only if nothing rewrote it while we were
            // recomputing - otherwise an edge that landed mid-recompute would
            // be folded into no one's stats. The precondition fails instead,
            // and the next sweep picks the node up again. A node that has gone
            // away has no such race and no work left, so its marker goes
            // unconditionally rather than retrying every minute forever.
            await doc.ref.delete(
              nodeExists ? { lastUpdateTime: doc.updateTime } : undefined,
            );
            recomputed++;
          } catch (error) {
            if (statusCode(error) !== FAILED_PRECONDITION) throw error;
            rewritten++;
          }
        } catch (error) {
          // Leave the marker in place; the next sweep retries it.
          failed++;
          logger.error(
            `Error recalculating edge stats for node: ${doc.id}`,
            error,
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: SWEEP_CONCURRENCY }, () => worker()),
    );

    logger.info(
      `Edge stats sweep: ${recomputed} recomputed, ${rewritten} rewritten mid-sweep, ${failed} failed, of ${pending.size} claimed`,
    );
  },
);
