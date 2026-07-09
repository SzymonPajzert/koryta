import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { fetchOptionsValidator, paginate } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";
import { defineEventHandler } from "h3";
import { pageIsPublic } from "~~/shared/model";

const queryValidator = z.object({
  ...fetchOptionsValidator.shape,
  type: z.enum(["person", "place", "article", "region"]).optional(),
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  // Require authentication (admin/authorized user only)
  await getUser(event);

  const db = getFirestore("koryta-pl");
  let fsQuery: FirebaseFirestore.Query = db.collection("nodes");

  if (query.type) {
    fsQuery = fsQuery.where("type", "==", query.type);
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
    return { id: doc.id, ...data, visibility: pageIsPublic(data) };
  });

  const nodesRecord: Record<string, unknown> = {};
  for (const node of nodesArray) {
    nodesRecord[node.id] = node;
  }

  return { nodes: nodesRecord, total: countSnap.data().count };
});
