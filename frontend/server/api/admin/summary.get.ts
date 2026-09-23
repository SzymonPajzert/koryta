import { getFirestore, FieldPath } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import { noteNeedsAction } from "~~/shared/model";
import { compareNewest, isQueued, OPEN_CAP } from "~~/shared/feedbackQueue";
import type {
  Feedback,
  FeedbackKind,
  Note,
  NoteEntryKind,
} from "~~/shared/model";

/** Cap on how many unapproved nodes we inspect to split manual vs automatic.
 * Aggregation gives the exact total cheaply, but deciding "automatic" needs a
 * read of each node's latest revision, so we bound that work. */
const MANUAL_INSPECT_CAP = 300;
const SAMPLE_SIZE = 8;

export type AdminSummary = {
  feedback: {
    // Reports nobody has triaged yet: still "nowe", and not given a place in
    // the work queue on /admin/opinie either.
    needsAction: number;
    sample: {
      id: string;
      kind: FeedbackKind;
      message: string;
      route: string;
      pageTitle: string | null;
      createdAt: string;
    }[];
  };
  notes: {
    // Entries waiting on an admin: the ones flagged unresolved by hand, plus
    // every correction nobody has settled yet. See `noteNeedsAction`.
    needsAction: number;
    // Sources nobody has given a type yet, minus the ones a reviewer handed
    // back to the table view - i.e. the length of the phone queue at
    // /admin/notatki/kategoryzacja.
    uncategorized: number;
    sample: {
      noteId: string;
      nodeId: string;
      name: string | null;
      url: string | null;
      note: string;
      kind: NoteEntryKind;
      adminType: string | null;
    }[];
  };
  revisions: {
    // Nodes whose latest revision is not the approved one, plus edge revisions
    // nobody has settled. Counted per node but per *revision* for edges: an
    // edge carries no `has_unapproved` flag, and /admin/rewizje-krawedzi - where
    // this number sends a reviewer - lists one row per revision too.
    unapproved: number;
    // Of those, the ones a human filed rather than an automatic import, and
    // which therefore need review. For edges that is a reader proposing a
    // relation; the ingest's own proposals are automatic and live at
    // /admin/rewizje-krawedzi rather than being counted here.
    unapprovedManual: number;
    inspected: number;
    // True when there was more of either kind than we inspected, so
    // `unapprovedManual` is a lower bound.
    truncated: boolean;
    sample: {
      // Which queue the entry belongs to, so the dashboard can link to the
      // screen that can act on it.
      kind: "node" | "edge";
      id: string;
      name: string | null;
      type: string;
    }[];
  };
};

/** Dashboard summary for the admin panel. Admin-only: uses the admin SDK
 * (bypasses Firestore rules) after verifying the caller's admin claim. */
export default defineEventHandler(async (event): Promise<AdminSummary> => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const db = getFirestore("koryta-pl");

  // --- Notes needing action -------------------------------------------------
  // Firestore can't query into an array of source objects, so read the notes
  // (only the fields we need) and count the entries waiting on somebody.
  const notesSnap = await db
    .collection("notes")
    .select("sources", "nodeId")
    .get();

  let needsAction = 0;
  let uncategorized = 0;
  const noteSampleRaw: {
    noteId: string;
    nodeId: string;
    url: string | null;
    note: string;
    kind: NoteEntryKind;
    adminType: string | null;
  }[] = [];

  for (const doc of notesSnap.docs) {
    const data = doc.data() as Note;
    for (const source of data.sources || []) {
      if (!source.adminType && !source.adminTypeDeferred) uncategorized++;
      if (noteNeedsAction(source)) {
        needsAction++;
        if (noteSampleRaw.length < SAMPLE_SIZE) {
          noteSampleRaw.push({
            noteId: doc.id,
            nodeId: data.nodeId,
            url: source.url ?? null,
            note: source.note,
            kind: source.kind ?? "source",
            adminType: source.adminType ?? null,
          });
        }
      }
    }
  }

  // --- Untriaged feedback ---------------------------------------------------
  // Putting a report in the queue is triage too, and a missing field is not
  // something a query can filter on - so the new reports are read and the
  // queued ones taken off the count. The read is capped: anybody can write a
  // report, and a flood of them should not turn every visit to /admin into
  // thousands of reads. Past the cap the count is an upper bound.
  const newFeedbackQuery = db
    .collection("feedback")
    .where("adminStatus", "==", "new");

  const [newFeedbackCountSnap, newFeedbackSnap] = await Promise.all([
    newFeedbackQuery.count().get(),
    newFeedbackQuery.orderBy("createdAt", "desc").limit(OPEN_CAP).get(),
  ]);

  const inspectedFeedback = newFeedbackSnap.docs.map((doc) => ({
    ...(doc.data() as Feedback),
    id: doc.id,
  }));
  const untriagedFeedback = inspectedFeedback
    .filter((report) => !isQueued(report))
    .sort(compareNewest);
  const queuedNewFeedback = inspectedFeedback.length - untriagedFeedback.length;

  const feedbackSample = untriagedFeedback.slice(0, SAMPLE_SIZE).map((data) => {
    return {
      id: data.id,
      kind: data.kind,
      message: data.message.slice(0, 200),
      route: data.context.route,
      pageTitle: data.context.pageTitle ?? null,
      createdAt: data.createdAt,
    };
  });

  // --- Unapproved revisions -------------------------------------------------
  const unapprovedQuery = db
    .collection("nodes")
    .where("revisions.has_unapproved", "==", true);

  const [unapprovedCountSnap, unapprovedNodesSnap] = await Promise.all([
    unapprovedQuery.count().get(),
    unapprovedQuery.limit(MANUAL_INSPECT_CAP).get(),
  ]);
  const unapproved = unapprovedCountSnap.data().count;

  const nodeDocs = unapprovedNodesSnap.docs;

  // Resolve each unapproved node's latest revision to learn if it was
  // automatic. `latest_id` is a revision doc id (occasionally a path).
  const latestIdByNode = new Map<string, string>();
  for (const doc of nodeDocs) {
    const latestId = doc.get("revisions.latest_id");
    if (typeof latestId === "string" && latestId) {
      latestIdByNode.set(doc.id, latestId.split("/").pop() as string);
    }
  }

  const revisionRefs = [...new Set(latestIdByNode.values())].map((id) =>
    db.collection("revisions").doc(id),
  );
  const automaticByRevId = new Map<string, boolean>();
  if (revisionRefs.length > 0) {
    const revSnaps = await db.getAll(...revisionRefs);
    for (const snap of revSnaps) {
      automaticByRevId.set(snap.id, snap.get("update_automatic") === true);
    }
  }

  let manualNodes = 0;
  const nodeSample: AdminSummary["revisions"]["sample"] = [];
  for (const doc of nodeDocs) {
    const latestId = latestIdByNode.get(doc.id);
    // If we can't resolve the latest revision, treat it as manual so it isn't
    // silently dropped from the review queue.
    const isAutomatic = latestId
      ? (automaticByRevId.get(latestId) ?? false)
      : false;
    if (!isAutomatic) {
      manualNodes++;
      if (nodeSample.length < SAMPLE_SIZE) {
        nodeSample.push({
          kind: "node",
          id: doc.id,
          name: (doc.get("name") as string | undefined) ?? null,
          type: (doc.get("type") as string | undefined) ?? "",
        });
      }
    }
  }

  // --- Unsettled edge revisions ---------------------------------------------
  // Edges have no `has_unapproved` flag to query - that field is maintained on
  // the node document - so the proposals themselves are the queue. Same query
  // as /api/revisions/pendingEdges, and the same composite index.
  const {
    total: unapprovedEdges,
    manual: manualEdges,
    inspected: inspectedEdges,
    sample: edgeSample,
  } = await summariseEdgeRevisions(db);

  // --- Resolve node names for the notes sample ------------------------------
  const sampleNodeIds = [...new Set(noteSampleRaw.map((n) => n.nodeId))];
  const names: Record<string, string> = {};
  if (sampleNodeIds.length > 0) {
    const namesSnap = await db
      .collection("nodes")
      .where(FieldPath.documentId(), "in", sampleNodeIds)
      .get();
    for (const doc of namesSnap.docs) {
      names[doc.id] = doc.data().name;
    }
  }

  return {
    feedback: {
      needsAction: newFeedbackCountSnap.data().count - queuedNewFeedback,
      sample: feedbackSample,
    },
    notes: {
      needsAction,
      uncategorized,
      sample: noteSampleRaw.map((n) => ({
        ...n,
        name: names[n.nodeId] ?? null,
      })),
    },
    revisions: {
      unapproved: unapproved + unapprovedEdges,
      unapprovedManual: manualNodes + manualEdges,
      inspected: nodeDocs.length + inspectedEdges,
      truncated:
        unapproved > nodeDocs.length || unapprovedEdges > inspectedEdges,
      // Neither kind is squeezed out of the list by the other having more:
      // each is guaranteed half the slots and may spread into what the other
      // leaves unused.
      sample: mergeSamples(nodeSample, edgeSample),
    },
  };
});

/** How many edge proposals are waiting, how many of them a human filed, and a
 * few to show. Mirrors the node half above: an exact total from aggregation,
 * and a bounded read to split manual from automatic.
 *
 * Counted per revision rather than per edge. An edge can carry more than one
 * proposal - they are addressed by what they assert, so the ingest can file a
 * second about a different field - and the screen this sends a reviewer to
 * lists them one per row, so a per-edge count would not match what they find.
 */
async function summariseEdgeRevisions(db: Firestore): Promise<{
  total: number;
  manual: number;
  inspected: number;
  sample: AdminSummary["revisions"]["sample"];
}> {
  const pending = db
    .collection("revisions")
    .where("collection", "==", "edges")
    .where("status", "==", "pending");

  const [countSnap, snapshot] = await Promise.all([
    pending.count().get(),
    pending.orderBy("update_time", "desc").limit(MANUAL_INSPECT_CAP).get(),
  ]);

  // A reader adding a relation leaves `update_automatic` unset; the ingest sets
  // it. Same rule as the node half, so one number can cover both.
  const manualDocs = snapshot.docs.filter(
    (doc) => doc.get("update_automatic") !== true,
  );
  const sampleDocs = manualDocs.slice(0, SAMPLE_SIZE);

  const result = {
    total: countSnap.data().count,
    manual: manualDocs.length,
    inspected: snapshot.docs.length,
    sample: [] as AdminSummary["revisions"]["sample"],
  };
  if (sampleDocs.length === 0) return result;

  // Both ends of each sampled edge, so the list reads as "Jan Kowalski ->
  // Powiat kaliski" rather than as a revision id. Bounded by SAMPLE_SIZE, so
  // this is a handful of reads however long the queue is.
  const edgeIds = [
    ...new Set(sampleDocs.map((doc) => String(doc.get("node_id") ?? ""))),
  ].filter(Boolean);
  const edges = new Map<string, Record<string, unknown>>();
  if (edgeIds.length > 0) {
    for (const doc of await db.getAll(
      ...edgeIds.map((id) => db.collection("edges").doc(id)),
    )) {
      if (doc.exists) edges.set(doc.id, doc.data() ?? {});
    }
  }

  const endpointIds = new Set<string>();
  for (const edge of edges.values()) {
    for (const end of [edge.source, edge.target]) {
      if (typeof end === "string" && end) endpointIds.add(end);
    }
  }
  const endpointNames = new Map<string, string>();
  if (endpointIds.size > 0) {
    for (const doc of await db.getAll(
      ...[...endpointIds].map((id) => db.collection("nodes").doc(id)),
    )) {
      const name = doc.get("name");
      if (typeof name === "string") endpointNames.set(doc.id, name);
    }
  }

  for (const doc of sampleDocs) {
    const edgeId = String(doc.get("node_id") ?? "");
    const edge = edges.get(edgeId);
    // The edge was deleted after the proposal was filed. It still counts as
    // waiting - /admin/rewizje-krawedzi is where that gets sorted out - but
    // there is no pair to name it by.
    const ends = edge
      ? [edge.source, edge.target].map((end) =>
          typeof end === "string" ? (endpointNames.get(end) ?? end) : "?",
        )
      : null;
    result.sample.push({
      kind: "edge",
      id: doc.id,
      name: ends ? `${ends[0]} → ${ends[1]}` : edgeId || null,
      type: typeof edge?.type === "string" ? edge.type : "",
    });
  }

  return result;
}

function mergeSamples(
  nodes: AdminSummary["revisions"]["sample"],
  edges: AdminSummary["revisions"]["sample"],
): AdminSummary["revisions"]["sample"] {
  const half = Math.floor(SAMPLE_SIZE / 2);
  const fromNodes = Math.min(
    nodes.length,
    Math.max(half, SAMPLE_SIZE - edges.length),
  );
  return [
    ...nodes.slice(0, fromNodes),
    ...edges.slice(0, SAMPLE_SIZE - fromNodes),
  ];
}
