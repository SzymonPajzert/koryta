import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { fetchNodes } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getUser } from "~~/server/utils/auth";
import { pageIsPublic } from "~~/shared/model";
import { defineEventHandler } from "h3";

const queryValidator = z.object({
  type: z.enum(["person", "place", "article", "region"]).optional(),
  party: z.string().optional(),
  place: z.string().optional(),
  
  // Pagination & Sorting parameters
  limit: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

// We wrap the original logic in a cached handler to preserve the caching
// for endpoints that rely on the old behavior (e.g. useEntities).
const cachedHandler = authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const opts = { personParty: query.party };

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
  const query = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );

  // If pagination/sorting is requested, query Firestore directly for uncached results
  if (query.limit && query.sortBy) {
    const user = await getUser(event).catch(() => null);
    const db = getFirestore("koryta-pl");
    
    let fsQuery: FirebaseFirestore.Query = db.collection("nodes");
    
    if (query.type) {
      fsQuery = fsQuery.where("type", "==", query.type);
    }
    if (query.party) {
      fsQuery = fsQuery.where("parties", "array-contains", query.party);
    }
    
    // For non-authenticated users, only show approved nodes
    if (!user) {
      fsQuery = fsQuery.where("stats.isApproved", "==", true);
    }

    let sortField = query.sortBy;
    if (sortField === "experience") {
      sortField = user 
        ? "stats.edges.all.experienceMonths" 
        : "stats.edges.approved.experienceMonths";
    } else if (sortField === "notesCount") {
      sortField = "stats.notesCount";
    } else if (sortField.startsWith("votes.")) {
      sortField = `stats.votes.${sortField.split(".")[1]}`;
    }

    const direction = query.sortDesc === "true" ? "desc" : "asc";
    fsQuery = fsQuery.orderBy(sortField, direction);

    const page = query.page || 1;
    const offset = (page - 1) * query.limit;
    
    fsQuery = fsQuery.offset(offset).limit(query.limit);
    
    const snapshot = await fsQuery.get();
    
    const nodesRecord: Record<string, any> = {};
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const visibility = pageIsPublic(data);
      nodesRecord[doc.id] = { id: doc.id, ...data, visibility };
    }
    
    // Also return the total count
    const countSnapshot = await fsQuery.count().get();
    const total = countSnapshot.data().count;

    return { nodes: nodesRecord, total };
  }

  // Fallback to the original cached behavior if no limit/sortBy is provided
  return cachedHandler(event);
});
