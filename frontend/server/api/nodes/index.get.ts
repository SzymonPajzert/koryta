import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import {
  fetchNodes,
  applyPartiesFilter,
  fetchOptionsValidator,
  paginate,
} from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getUser } from "~~/server/utils/auth";
import { pageIsPublic } from "~~/shared/model";
import { defineEventHandler } from "h3";

const queryValidator = z.object({
  // We use generic fetch options for pagination
  ...fetchOptionsValidator.shape,

  type: z.enum(["person", "place", "article", "region"]).optional(),
  // TODO: remove party in the future
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  hideVoted: z.enum(["all", "no_votes", "has_votes"]).optional(),

  // Sorting parameters
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

    type Op = {
      applyFs: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query;
      applyMem: (nodes: any[]) => any[];
    };
    const ops: Op[] = [];

    if (query.type) {
      ops.push({
        applyFs: (q) => q.where("type", "==", query.type),
        applyMem: (nodes) => nodes.filter((n) => n.type === query.type),
      });
    }

    const partiesToFilter = query.parties || query.party;
    if (partiesToFilter) {
      ops.push({
        applyFs: (q) => applyPartiesFilter(q, partiesToFilter),
        applyMem: (nodes) => {
          const partiesToSearch = Array.isArray(partiesToFilter)
            ? partiesToFilter
            : [partiesToFilter];
          const hasNone = partiesToSearch.includes("__NONE__");
          const normalParties = partiesToSearch.filter((p) => p !== "__NONE__");
          return nodes.filter((n) => {
            const p = n.parties || [];
            if (hasNone && p.length === 0) return true;
            if (
              normalParties.length > 0 &&
              p.some((party: string) => normalParties.includes(party))
            )
              return true;
            return false;
          });
        },
      });
    }

    if (query.krs) {
      const krsArray = Array.isArray(query.krs) ? query.krs : [query.krs];
      const places: any[] = [];
      for (let i = 0; i < krsArray.length; i += 30) {
        const chunk = krsArray.slice(i, i + 30);
        const chunkPlaces = await db
          .collection("nodes")
          .where("type", "==", "place")
          .where("krsNumber", "in", chunk)
          .get();
        places.push(...chunkPlaces.docs);
      }

      if (places.length > 0) {
        const placeIds = places.map((doc) => doc.id);
        const arrayField = user
          ? "stats.edges.all.targetNodeIds"
          : "stats.edges.approved.targetNodeIds";

        const applyMemOp = (nodes: any[]) =>
          nodes.filter((n) => {
            const arr = user
              ? n.stats?.edges?.all?.targetNodeIds
              : n.stats?.edges?.approved?.targetNodeIds;
            return (
              Array.isArray(arr) &&
              arr.some((id: string) => placeIds.includes(id))
            );
          });

        if (placeIds.length <= 10) {
          ops.push({
            applyFs: (q) => q.where(arrayField, "array-contains-any", placeIds),
            applyMem: applyMemOp,
          });
        } else {
          ops.push({
            applyFs: () => {
              throw new Error("index: array-contains-any limit exceeded");
            },
            applyMem: applyMemOp,
          });
        }
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
        ops.push({
          applyFs: (q) => q.where(arrayField, "array-contains", regionId),
          applyMem: (nodes) =>
            nodes.filter((n) => {
              const arr = user
                ? n.stats?.edges?.all?.targetNodeIds
                : n.stats?.edges?.approved?.targetNodeIds;
              return Array.isArray(arr) && arr.includes(regionId);
            }),
        });
      } else {
        return { nodes: {}, total: 0 };
      }
    }

    if (!user) {
      if (query.visibility === "private") {
        return { nodes: {}, total: 0 };
      }
      ops.push({
        applyFs: (q) => q.where("stats.isApproved", "==", true),
        applyMem: (nodes) => nodes.filter((n) => n.stats?.isApproved === true),
      });
    } else {
      if (query.visibility === "public") {
        ops.push({
          applyFs: (q) => q.where("stats.isApproved", "==", true),
          applyMem: (nodes) =>
            nodes.filter((n) => n.stats?.isApproved === true),
        });
      } else if (query.visibility === "private") {
        ops.push({
          applyFs: (q) => q.where("stats.isApproved", "==", false),
          applyMem: (nodes) =>
            nodes.filter((n) => n.stats?.isApproved === false),
        });
      }
    }

    if (query.hideVoted === "no_votes") {
      ops.push({
        applyFs: (q) => q.where("stats.votes.humanVoted", "==", false),
        applyMem: (nodes) =>
          nodes.filter((n) => n.stats?.votes?.humanVoted === false),
      });
    } else if (query.hideVoted === "has_votes") {
      ops.push({
        applyFs: (q) => q.where("stats.votes.humanVoted", "==", true),
        applyMem: (nodes) =>
          nodes.filter((n) => n.stats?.votes?.humanVoted === true),
      });
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
      ops.push({
        applyFs: (q) => q.orderBy(sortField, direction),
        applyMem: (nodes) => {
          return [...nodes].sort((a, b) => {
            const getVal = (obj: any, path: string) =>
              path.split(".").reduce((o, i) => o?.[i], obj);
            const valA = getVal(a, sortField);
            const valB = getVal(b, sortField);

            if (valA === valB) return 0;
            if (valA === undefined || valA === null)
              return direction === "desc" ? 1 : -1;
            if (valB === undefined || valB === null)
              return direction === "desc" ? -1 : 1;

            const res = valA > valB ? 1 : -1;
            return direction === "desc" ? -res : res;
          });
        },
      });
    }

    let executedSuccessfully = false;
    const fsOps = [...ops];
    const memOps: Op[] = [];
    let snapshot: FirebaseFirestore.QuerySnapshot | null = null;
    let total = 0;

    while (!executedSuccessfully) {
      try {
        let fsQuery: FirebaseFirestore.Query = db.collection("nodes");
        for (const op of fsOps) {
          fsQuery = op.applyFs(fsQuery);
        }

        if (memOps.length === 0) {
          const paginatedQuery = paginate(fsQuery, query);
          const [snap, countSnap] = await Promise.all([
            paginatedQuery.get(),
            fsQuery.count().get(),
          ]);
          snapshot = snap;
          total = countSnap.data().count;
        } else {
          snapshot = await fsQuery.get();
        }
        executedSuccessfully = true;
      } catch (e: any) {
        if (
          e.code === 9 ||
          (e.message && e.message.toLowerCase().includes("index"))
        ) {
          if (fsOps.length === 0) {
            throw e;
          }
          const dropped = fsOps.pop();
          if (dropped) {
            memOps.unshift(dropped);
          }
        } else {
          throw e;
        }
      }
    }

    let nodesArray = snapshot!.docs.map((doc) => {
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

    for (const op of memOps) {
      nodesArray = op.applyMem(nodesArray);
    }

    if (memOps.length > 0) {
      total = nodesArray.length;
      const page = query.page || 1;
      const limit = query.limit || nodesArray.length;
      const offset = (page - 1) * limit;
      nodesArray = nodesArray.slice(offset, offset + limit);
    }

    const nodesRecord: Record<string, unknown> = {};
    for (const node of nodesArray) {
      nodesRecord[node.id] = node;
    }

    return { nodes: nodesRecord, total };
  }

  // Fallback to the original cached behavior if no limit/sortBy is provided
  return cachedHandler(event);
});
