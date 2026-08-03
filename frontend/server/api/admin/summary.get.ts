import { FieldPath } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import type { Note, NoteEntryKind } from "~~/shared/model";
import { adminFirestore } from "~~/server/utils/firebase";

/** Cap on how many unapproved nodes we inspect to split manual vs automatic.
 * Aggregation gives the exact total cheaply, but deciding "automatic" needs a
 * read of each node's latest revision, so we bound that work. */
const MANUAL_INSPECT_CAP = 300;
const SAMPLE_SIZE = 8;

export type AdminSummary = {
  notes: {
    // Sources an admin has explicitly flagged as unresolved.
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
    // Nodes whose latest revision is not the approved one.
    unapproved: number;
    // Of the inspected unapproved nodes, those whose latest revision was made
    // by a human (not an automatic import) and therefore needs review.
    unapprovedManual: number;
    inspected: number;
    // True when there are more unapproved nodes than we inspected, so
    // `unapprovedManual` is a lower bound.
    truncated: boolean;
    sample: {
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

  const db = adminFirestore();

  // --- Notes needing action -------------------------------------------------
  // Firestore can't query into an array of source objects, so read the notes
  // (only the fields we need) and count sources flagged unresolved.
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
      if (source.adminStatus === "unresolved") {
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

  let unapprovedManual = 0;
  const revisionSampleRaw: { id: string; name: string | null; type: string }[] =
    [];
  for (const doc of nodeDocs) {
    const latestId = latestIdByNode.get(doc.id);
    // If we can't resolve the latest revision, treat it as manual so it isn't
    // silently dropped from the review queue.
    const isAutomatic = latestId
      ? (automaticByRevId.get(latestId) ?? false)
      : false;
    if (!isAutomatic) {
      unapprovedManual++;
      if (revisionSampleRaw.length < SAMPLE_SIZE) {
        revisionSampleRaw.push({
          id: doc.id,
          name: (doc.get("name") as string | undefined) ?? null,
          type: (doc.get("type") as string | undefined) ?? "",
        });
      }
    }
  }

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
    notes: {
      needsAction,
      uncategorized,
      sample: noteSampleRaw.map((n) => ({
        ...n,
        name: names[n.nodeId] ?? null,
      })),
    },
    revisions: {
      unapproved,
      unapprovedManual,
      inspected: nodeDocs.length,
      truncated: unapproved > nodeDocs.length,
      sample: revisionSampleRaw,
    },
  };
});
