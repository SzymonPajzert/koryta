import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { fetchOptionsValidator, paginate } from "~~/server/utils/fetch";
import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { nodeTypes, pageIsPublic } from "~~/shared/model";
import { normalizeUpdateTime } from "~~/shared/revisions";

const queryValidator = z.object({
  ...fetchOptionsValidator.shape,
  type: z.enum(nodeTypes).optional(),
  status: z.enum(["unapproved", "approved"]).optional(),
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

/** Pages with their revision state, a page of them at a time, for the
 * „Strony” section of /admin/rewizje.
 *
 * Whole node documents, drafts among them, so signed in readers only - the
 * page that reads this is behind the same login, and until 2026-10-14 the
 * route was not, which put every unpublished page a curl away.
 */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const db = getFirestore("koryta-pl");
  let fsQuery: FirebaseFirestore.Query = db.collection("nodes");

  if (query.type) {
    fsQuery = fsQuery.where("type", "==", query.type);
  }

  // An equality on the field the "Zaakceptowane" column reads. Either value
  // drops the nodes with no `revisions` map at all, which is what the page
  // wants both ways round: a node nobody has ever revised is neither waiting
  // for approval nor approved, and there are far more of those than of either.
  if (query.status) {
    fsQuery = fsQuery.where(
      "revisions.has_unapproved",
      "==",
      query.status === "unapproved",
    );
  }

  if (query.sortBy) {
    const direction = query.sortDesc === "true" ? "desc" : "asc";
    fsQuery = fsQuery.orderBy(query.sortBy, direction);
  }

  // Paginate
  const paginatedQuery = paginate(fsQuery, query);

  const [snap, countSnap] = await Promise.all([
    paginatedQuery.get(),
    fsQuery.count().get(),
  ]);

  const nodesArray = snap.docs.map((doc) => {
    const data = doc.data();
    if (data.revision_id) {
      if (typeof data.revision_id.path === "string") {
        data.revision_id = data.revision_id.path;
      } else if (
        data.revision_id._path &&
        Array.isArray(data.revision_id._path.segments)
      ) {
        data.revision_id = data.revision_id._path.segments.join("/");
      }
    }
    if (data.revisions?.latest_time) {
      data.revisions.latest_time = normalizeUpdateTime(
        data.revisions.latest_time,
      );
    }
    return { id: doc.id, ...data, visibility: pageIsPublic(data) };
  });

  const nodesRecord: Record<string, unknown> = {};
  for (const node of nodesArray) {
    nodesRecord[node.id] = node;
  }

  return { nodes: nodesRecord, total: countSnap.data().count };
});
