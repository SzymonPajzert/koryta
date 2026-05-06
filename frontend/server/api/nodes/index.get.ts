import { z } from "zod";
import { getFirestore, Filter } from "firebase-admin/firestore";
import { fetchNodes, applyPartiesFilter } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getUser } from "~~/server/utils/auth";
import { pageIsPublic } from "~~/shared/model";
import { defineEventHandler } from "h3";

const queryValidator = z.object({
  type: z.enum(["person", "place", "article", "region"]).optional(),
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  place: z.string().optional(),
  teryt: z.string().optional(),
  krs: z.string().optional(),
  electionLocation: z.string().optional(),

  // Pagination & Sorting parameters
  limit: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

export type Query = z.infer<typeof queryValidator>;

// We wrap the original logic in a cached handler to preserve the caching
// for endpoints that rely on the old behavior (e.g. useEntities).
const cachedHandler = authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const opts = { personParties: query.parties || query.party };

  if (query.type) {
    return { nodes: await fetchNodes(query.type, opts) };
  }

  const [people, places, articles, regions] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("article"),
    fetchNodes("region"),
  ]);

  const nodes = { ...people, ...places, ...articles, ...regions };
  return { nodes };
});

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  // If pagination/sorting is requested, query Firestore directly for uncached results
  if (query.limit || query.sortBy) {
    const user = await getUser(event).catch(() => null);
    const db = getFirestore("koryta-pl");

    let fsQuery: FirebaseFirestore.Query = db.collection("nodes");

    if (query.type) {
      fsQuery = fsQuery.where("type", "==", query.type);
    }

    const partiesToFilter = query.parties || query.party;
    if (partiesToFilter) {
      fsQuery = applyPartiesFilter(fsQuery, partiesToFilter);
    }
    if (query.krs) {
      const places = await db
        .collection("nodes")
        .where("type", "==", "place")
        .where("krsNumber", "==", query.krs)
        .limit(1)
        .get();
      if (!places.empty) {
        const placeId = places.docs[0]?.id;
        const arrayField = user
          ? "stats.edges.all.targetNodeIds"
          : "stats.edges.approved.targetNodeIds";
        fsQuery = fsQuery.where(arrayField, "array-contains", placeId);
      } else {
        return { nodes: {}, total: 0 };
      }
    }
    if (query.teryt) {
      const regions = await db
        .collection("nodes")
        .where("type", "==", "region")
        .where("teryt", "==", query.teryt)
        .limit(1)
        .get();
      if (!regions.empty) {
        const regionId = regions.docs[0]?.id;
        const arrayField = user
          ? "stats.edges.all.targetNodeIds"
          : "stats.edges.approved.targetNodeIds";
        fsQuery = fsQuery.where(arrayField, "array-contains", regionId);
      } else {
        return { nodes: {}, total: 0 };
      }
    }
    if (query.electionLocation) {
      const arrayField = user
        ? "stats.edges.all.electionLocations"
        : "stats.edges.approved.electionLocations";
      fsQuery = fsQuery.where(
        arrayField,
        "array-contains",
        query.electionLocation,
      );
    }

    // For non-authenticated users, only show approved nodes
    if (!user) {
      fsQuery = fsQuery.where("stats.isApproved", "==", true);
    }

    if (query.sortBy) {
      let sortField = query.sortBy;
      if (sortField === "experience") {
        sortField = user
          ? "stats.edges.all.experienceMonths"
          : "stats.edges.approved.experienceMonths";
      } else if (sortField === "notesCount") {
        sortField = "stats.notesCount";
      } else if (sortField === "visibility") {
        sortField = "stats.isApproved";
      } else if (sortField.startsWith("votes.")) {
        sortField = `stats.votes.${sortField.split(".")[1]}`;
      }

      const direction = query.sortDesc === "true" ? "desc" : "asc";
      fsQuery = fsQuery.orderBy(sortField, direction);
    }

    let paginatedQuery = fsQuery;
    if (query.limit) {
      const page = query.page || 1;
      const offset = (page - 1) * query.limit;
      paginatedQuery = paginatedQuery.offset(offset).limit(query.limit);
    }

    // Also return the total count (run in parallel with data fetch)
    const [snapshot, countSnapshot] = await Promise.all([
      paginatedQuery.get(),
      fsQuery.count().get(),
    ]);

    const nodesRecord: Record<string, unknown> = {};
    for (const doc of snapshot.docs) {
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
      const visibility = pageIsPublic(data);
      nodesRecord[doc.id] = { id: doc.id, ...data, visibility };
    }

    const total = countSnapshot.data().count;

    return { nodes: nodesRecord, total };
  }

  // Fallback to the original cached behavior if no limit/sortBy is provided
  return cachedHandler(event);
});
